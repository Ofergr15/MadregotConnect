# Review: migrations 200, 182, 183 (all written, NONE applied)

| | 181 `events.course_gpx_url` | 182 `athletes.is_test_account` | 183 `u21_registrations.dedupe_key` |
|---|---|---|---|
| Re-runnable | yes (`ADD COLUMN IF NOT EXISTS`) | yes | yes (`IF NOT EXISTS` on column and both indexes) |
| Lock / cost | metadata-only (nullable, no default) | metadata-only on PG 11+ (constant default `false`) | brief lock while two indexes build; table is small. `CONCURRENTLY` not used (cannot run inside the SQL editor's transaction) |
| Fails on existing data? | no | no | no: the unique index is partial on `dedupe_key IS NOT NULL`, and every existing row is NULL |
| Order | any | any | **after 180** (table must exist) |
| Code before it's applied | POST works without the field; PATCH with it → 503 naming 181 | fails open: nobody is a test account | insert retried without the key; in-instance dedupe still holds |
| New relationships (embed ambiguity, CLAUDE.md) | none | none | none |
| RLS | inherits the table's (all tables locked by 134) | same | same |
| Rollback | `ALTER TABLE events DROP COLUMN IF EXISTS course_gpx_url;` (loses map links) | `ALTER TABLE athletes DROP COLUMN IF EXISTS is_test_account;` (loses flags; code falls back to "nobody is a test account") | `DROP INDEX IF EXISTS u21_registrations_email_created_idx; DROP INDEX IF EXISTS u21_registrations_dedupe_key_uidx; ALTER TABLE u21_registrations DROP COLUMN IF EXISTS dedupe_key;` |
| Destructive? | no | no | no |

Verdict: all three are safe to paste in any environment where the prerequisite exists; none changes existing rows.
Applying is an explicit-approval step.
