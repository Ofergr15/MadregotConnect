# Native contract bundle

Each note is backed by tests that run the real route handlers against a fake database
(only auth and the database are faked). If a route's shape changes, its test fails.

| Surface | Note | Tests |
|---|---|---|
| U21 questionnaire submit + admin list | `u21-register.md` | `u21RegisterContract.test.ts`, `trackAReadContract.test.ts` |
| U21 field list (what `answers` must hold) | `u21-fields.md` | `u21FieldSpecContract.test.ts` |
| Academy form: submit, prefill, open/closed check | `academy-register.md` | `academyRegisterContract.test.ts`, `trackAReadContract.test.ts` |
| Valencia tab: events, club updates, surveys | (findings in the 2026-11-20 report) | `valenciaContract.test.ts` |

## Not built on the server (no contract possible yet)

- **U21 registration status** for the applicant: nothing returns "where is my submission".
  The submit answers `pending_review` and that is all.
- **U21 profile**: no route.
- **Gateway entry**: `/u21?track=<id>` is a web link (`src/lib/u21/entry.ts`), not an API.
  The native gateway needs no server call; preselect a track with the ids above.
- **Event-linked club updates**: updates carry `topicId` only. No route filters by event or
  topic, or reads `club_update_topics`.

Each of these needs a product decision before it can be built.
