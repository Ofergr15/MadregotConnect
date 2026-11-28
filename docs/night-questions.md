# Night-run owner questions

Each entry: task, question, and the safe default the PR shipped with.

## Task 102 — response trimming
- The native app's source isn't in this repo (only an old `ios/` on `u21-native`), so I couldn't confirm which fields it reads on the default shapes. **Default chosen:** every default response is byte-for-byte unchanged except `calories` added to `activities?shape=list`; the web moved to opt-in narrow shapes (`activities?shape=list`, `club/records?view=buckets`). If you send me the native app's field list for `/api/activities` (default shape) and `/api/club/records`, the defaults can be trimmed too — staff `GET /api/activities` without `shape` is still ~290 KB on the seeded club, mostly `laps`/`splits`.
- `/dashboard/activities` (the week screen) still asks for the default shape: its expanded card paints splits from the row before `/api/activities/details` answers. Switch it to `shape=list` and accept a short splits pop-in (−~60% on that screen)? **Default:** left as is.
