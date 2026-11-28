# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 94 — Garmin auth-failure backoff

- **Are the backoff steps right?** Default shipped: a refused credential is retried every tick for the first hour (a blip heals itself), then once an hour, then every 6 hours after a day (288 refused logins/day → 4). A member's own sync and a reconnect always try. No flag: it only ever reduces calls for credentials Garmin already refuses. Say if you want it behind a flag or with different steps.
- **Should the member get a push asking them to reconnect?** Default: no push; the profile already shows the red reconnect state, and /api/athletes/me now also returns `garminReconnect: { needed, since, nextRetryAt }` for the native app.
