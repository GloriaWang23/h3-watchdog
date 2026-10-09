import { EmailMessage } from 'cloudflare:email'

// Every 5 minutes: run the H3 Studio watchdog (which scales the RunPod endpoint to 0 when a
// worker bills with no work) and email what it reports. The watchdog returns each
// alert-worthy incident once (its notifiedAt cursor), so one incident is one email.

const KIND_ZH = {
  IDLE_BURN: '空转计费，已强制停止 worker',
  STUCK: '任务卡死，已强制停止 worker',
  STALL: '排队停滞',
  HOLD: '熔断保持（多次异常，暂停自动恢复）',
  ERROR: '看门狗检查出错',
}
const OUTAGE_REPEAT_MS = 2 * 60 * 60 * 1000

// Plain-text UTF-8 mail through the Email Routing send_email binding (no third party).
const b64 = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)))
const wrap76 = (str) => str.replace(/.{76}/g, '$&\r\n')

async function sendMail(env, subject, text) {
  const raw = [
    `From: H3 =?UTF-8?B?${b64('看门狗')}?= <${env.ALERT_FROM}>`,
    `To: <${env.ALERT_TO}>`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${env.ALERT_FROM.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text)),
  ].join('\r\n')
  await env.MAIL.send(new EmailMessage(env.ALERT_FROM, env.ALERT_TO, raw))
}

const stamp = (d = new Date()) => d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })

async function callWatchdog(env) {
  let last
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(env.WATCHDOG_URL, {
        headers: { Authorization: `Bearer ${env.WATCHDOG_SECRET}`, 'x-watchdog-source': 'cloudflare' },
        signal: AbortSignal.timeout(25000),
      })
      if (r.ok) return await r.json()
      last = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      if (r.status === 401) break // a wrong secret will not fix itself
    } catch (e) {
      last = e
    }
    await new Promise((res) => setTimeout(res, 5000))
  }
  throw last
}

export async function run(env) {
  // `wrangler kv key put --binding STATE testMail 1` -> the next run mails a test message.
  if (await env.STATE.get('testMail')) {
    await env.STATE.delete('testMail')
    await sendMail(env, `[H3 看门狗] 测试邮件 · ${stamp()}`, '这是一封测试邮件：Cloudflare 定时任务（每 5 分钟）已能通过 agentmailserver.com 给你发告警。\n\n之后只有出现空转被强制停止、任务卡死、熔断、看门狗出错，或看门狗本身无法运行时才会发邮件。')
  }
  let out
  try {
    out = await callWatchdog(env)
  } catch (e) {
    const prev = Number((await env.STATE.get('outageMailedAt')) ?? 0)
    if (Date.now() - prev > OUTAGE_REPEAT_MS) {
      await sendMail(
        env,
        `[H3 看门狗] 无法执行检查 · ${stamp()}`,
        `看门狗接口调用失败，本次没有检查 RunPod 计费状态。\n\n错误：${e.message}\n接口：${env.WATCHDOG_URL}\n\n可能原因：网站故障、密钥失效。故障持续期间每 2 小时提醒一次，恢复后会再发一封。\nRunPod 控制台：${env.CONSOLE_URL}`,
      )
      await env.STATE.put('outageMailedAt', String(Date.now()))
    }
    throw e
  }
  if (await env.STATE.get('outageMailedAt')) {
    await sendMail(env, `[H3 看门狗] 已恢复正常 · ${stamp()}`, `看门狗接口恢复正常，检查已继续。\n本次结论：${out.state?.lastCheck?.verdict ?? '—'}`)
    await env.STATE.delete('outageMailedAt')
  }
  const alerts = out.alerts ?? []
  if (alerts.length) {
    const s = out.snapshot ?? {}
    const lines = alerts.map((a) => `• ${stamp(new Date(a.at))}  ${KIND_ZH[a.kind] ?? a.kind}\n  ${a.detail ?? ''}`)
    await sendMail(
      env,
      `[H3 看门狗] ${KIND_ZH[alerts[0].kind] ?? alerts[0].kind}${alerts.length > 1 ? ` 等 ${alerts.length} 条` : ''} · ${stamp()}`,
      `${lines.join('\n\n')}\n\n当前状态：运行中 worker ${s.running ?? '—'}，排队 ${s.queued ?? '—'}，执行中 ${s.inProgress ?? '—'}，估算花费 $${s.spendPerHr ?? '—'}/h\n看门狗结论：${out.state?.lastCheck?.verdict ?? '—'}\n\n工作台：https://h3-studio-eight.vercel.app\nRunPod 控制台：${env.CONSOLE_URL}`,
    )
  }
  return { verdict: out.state?.lastCheck?.verdict, alerts: alerts.length }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env).then((r) => console.log('watchdog', JSON.stringify(r))))
  },
}
