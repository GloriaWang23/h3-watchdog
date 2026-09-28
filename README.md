# h3-watchdog

Scheduled trigger for the H3 Studio billing watchdog (`/api/watchdog`), every 5 minutes.

- Repository variable `WATCHDOG_URL`: `https://h3-studio-eight.vercel.app/api/watchdog`
- Repository secret `WATCHDOG_SECRET`: same value as the Vercel env var `WATCHDOG_SECRET`

The watchdog scales the RunPod endpoint to 0 workers when a worker keeps running (billed)
with nothing queued or in progress beyond idle timeout + 2 min, or when a job stays in
progress with nothing finishing for more than 32 min, then restores it once the workers are gone.
