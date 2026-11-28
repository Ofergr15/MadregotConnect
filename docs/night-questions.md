# Night-run owner questions

Each entry: task, question, and the safe default the PR shipped with.

## Task 102 — response trimming
- The native app's source isn't in this repo (only an old `ios/` on `u21-native`), so I couldn't confirm which fields it reads on the default shapes. **Default chosen:** every default response is byte-for-byte unchanged except `calories` added to `activities?shape=list`; the web moved to opt-in narrow shapes (`activities?shape=list`, `club/records?view=buckets`). If you send me the native app's field list for `/api/activities` (default shape) and `/api/club/records`, the defaults can be trimmed too. **Decided (28.11): yes, but only from an exact field list pulled from the iPhone code** — until then the defaults stay untouched. Staff `GET /api/activities` without `shape` is still ~290 KB on the seeded club, mostly `laps`/`splits`.
- `/dashboard/activities` (the week screen) still asks for the default shape: its expanded card paints splits from the row before `/api/activities/details` answers. Switch it to `shape=list` and accept a short splits pop-in (−~60% on that screen)? **Default:** left as is. **Decided (28.11): switched.** The week screen asks for `shape=list` (`max_hr` + `location_name` added to the list shape, since its collapsed card draws them); the expanded card holds a splits skeleton until `/api/activities/details` answers.
