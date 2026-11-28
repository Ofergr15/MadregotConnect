# Race-day dry run (Valencia, 2026-12-06)

A rehearsal of race morning's phone-position traffic: **25 runners post their position every
20 s (±3 s) for 4 h** while **10 viewers poll the board every 30 s**. The run reports errors (5xx /
network), rate-limit hits (429), other rejections by error code, latency (p50 / p95 / max) per
endpoint, and how far each runner's stored track drifts from the distance their phone measured.

The scenario lives in `src/lib/race-live/dryrun.ts` and runs two ways:

| how | what it exercises | latency numbers |
|---|---|---|
| `npx vitest run src/__tests__/raceDayDryrun.test.ts` | the REAL `POST …/position` and `GET /api/race-live/{eventId}` handlers against the in-memory DB, a full 4 h on a fake clock in ~1 s | not meaningful (in-memory) |
| `npx tsx ./scripts/race-day-dryrun.mts …` | a LOCAL dev server over HTTP with seeded data, real time | real (local) |

The runner model mirrors the phone app: counters from the runner's own start (corrals spread over
10 min), paces 4:00–6:30 /km, GPS measuring 1 % long, a runner who crosses the line sends that point
and stops sharing, and **3 phones restart mid-race**: 180 s offline, then `resume: true` with counters
from 0, adding the server-returned base from then on. `--double-send <p>` adds retries 1 s after a
post — those SHOULD be 429 and are counted apart from unexpected 429s.

PASS = no errors, no unexpected 429, no other 4xx, every intended double send was a 429.

## In-process result (main, 2026-11-28)

```
Race-day dry run: 25 runners every 20±3s for 4.00 h, 10 viewers every 30s, 3 phone restarts, seed 6122026
POST    n=15865  statuses={"200":15865}
BOARD   n=4800  statuses={"200":4800}
errors (5xx/network): 0
rate-limit hits (429): unexpected 0, intended double-sends 0/0
rejected (other 4xx): {}
max track error: 0 m (restarted phones: 703 m — the offline stretch)
RESULT: PASS
```

What it shows:
- Every one of ~15.9K posts lands at a 20 s cadence; the 8 s limit never trips on a healthy phone.
  A cadence under 8 s does trip it (a test proves the run then FAILs).
- The board serves all 4,800 reads with all 25 runners on it.
- A continuously sharing phone's track equals its own distance (0 m error).
- **A restarted phone loses the distance it ran while off** (≈ offline time × pace, 703 m here for
  3 min): the resumed session counts from where the phone came back, and the server adds that to
  where the track stood. The track never jumps back to 0, but it reads short by the gap until the next
  official split. See the owner question below.

## Over HTTP against a local server

**Local only.** The script refuses any host other than `localhost` / `127.0.0.1`. Never point it at
production or a preview: it writes `race_positions` rows and hammers the board.

1. `npm run dev` against the LOCAL Supabase (not the prod `.env.local`).
2. Seed one event with (SQL editor of the local project, or the seed script once #233 lands):
   - a `race_live_config` row: `active = true`, `poll_from` ≤ now, `poll_to` ≥ now + the run length;
   - 25 runners: an `athletes` row + a `race_entries` row (`live_opt_out = false`) each, and
     `race_live_phone` on for each (athlete enablement);
   - 10 viewers: `race_live` on + a `race_map_viewers` row each.
3. Sign each user in against the local project and put their access tokens in a file:
   `{ "runners": ["<jwt>", …25], "viewers": ["<jwt>", …10] }` (keep it out of git, e.g. under `tmp/`).
4. Run:
   ```
   npx tsx ./scripts/race-day-dryrun.mts --event <eventId> --tokens tmp/dryrun-tokens.json \
     --minutes 240 [--runners 25 --viewers 10 --cadence 20 --restarts 3 --double-send 0.05 --json tmp/dryrun.json]
   ```
   Real time: the server stamps the window and the 8 s limit on its own clock, so 4 h takes 4 h.
   `--minutes 15` is a fair short rehearsal. Exit code 0 = PASS, 1 = FAIL, 2 = bad arguments.

Reading a FAIL: `rejected` keys are the route's error codes; the table in
`docs/live-tracking-race-day.md` ("During the race: what a 4xx means") says what each one means.
Tokens expire after an hour on default Supabase settings — for a 4 h run raise the local JWT expiry
or expect 401s in `rejected` after the first hour.
