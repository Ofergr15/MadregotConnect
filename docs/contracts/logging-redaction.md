# Logging redaction audit: auth and registration (branch `u21-personal-coach`)

| Path | Logs | Verdict |
|---|---|---|
| `auth/email-code` (`route.ts:66-205`) | Fixed messages; `mail.code/reason`; error objects on failure | No code, hash, token or address logged. The code is never logged |
| `lib/auth/synthetic-session.ts:89-110` | Supabase error **messages** only | No tokens |
| `strava/callback` (`[auth-debug]`, `:105-644`) | Booleans (`hasAccessToken`, `hasCode`), internal ids, query **keys**, user agent | No token values. Internal athlete ids are fine in server logs |
| `auth/claim-login:57,69` | Error objects | No session values |
| `academy/register:72-291` | Error messages / objects | DB errors may echo row values; low risk today (no unique index on emails) |
| `u21/register:79,84` | **Whole DB error object** | **To fix:** with a unique index (proposed migration 183), Postgres puts `Key (email)=(…)` in `detail`, putting a minor's email in logs. Log only `error.code` |

Rule going forward: log error `code`/`message`, never the raw error object, on routes that write personal data.
