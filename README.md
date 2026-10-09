# h3-watchdog

Scheduled triggers for the H3 Studio billing watchdog (`/api/watchdog`).

| Trigger | Interval | Alerts |
|---|---|---|
| **Cloudflare Worker** `h3-watchdog` (`cloudflare/`) — primary | every 5 min (reliable) | emails each new incident to the QQ inbox from `watchdog@agentmailserver.com` (Email Routing); also mails once if the watchdog cannot be reached, then every 2 h, and on recovery |
| GitHub Actions (`.github/workflows/`) — fallback | scheduled every 5 min, but GitHub fires it only every few hours | a failed run when it gets an incident first, so GitHub emails the repo owner |

Each incident is handed out once (the watchdog's `notifiedAt` cursor), to whichever caller asks first.

### Cloudflare Worker

```bash
cd cloudflare
npx wrangler@3 deploy                                   # cron */5 * * * *
npx wrangler@3 secret put WATCHDOG_SECRET               # = Vercel WATCHDOG_SECRET_CF
npx wrangler@3 kv key put --binding STATE testMail 1    # next run sends a test mail
npx wrangler@3 tail h3-watchdog                         # live logs
```

### GitHub Actions

- Repository variable `WATCHDOG_URL`: `https://h3-studio-eight.vercel.app/api/watchdog`
- Repository secret `WATCHDOG_SECRET`: same value as the Vercel env var `WATCHDOG_SECRET`

The watchdog scales the RunPod endpoint to 0 workers when a worker keeps running (billed)
with nothing queued or in progress beyond idle timeout + 2 min, or when a job stays in
progress with nothing finishing for more than 17 min (900 s job cap + 2 min), then restores it once the workers are gone.

Trigger a run manually: `gh workflow run billing-watchdog.yml --repo GloriaWang23/h3-watchdog`
