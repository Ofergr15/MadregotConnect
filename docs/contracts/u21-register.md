# POST /api/u21/register — contract for the native client

Pinned by `src/__tests__/u21RegisterContract.test.ts`. Branch-only (not in production).
Public, no auth header. Field rules live in `src/lib/u21/intake.ts` (`U21_FIELDS`,
`validateU21Intake`) — the same rules the web page shows; mirror them client-side.

## Request

```json
{ "track": "basic" | "advanced" | "pro", "answers": { "<fieldKey>": <value>, ... }, "website": "" }
```

- `answers` must be a JSON object. Value types by field type:
  `checkbox` → boolean · `checkboxes` → string[] · everything else (text, email, tel, date,
  number, textarea, radio, yesno) → **string**. `weeklyKm` is a numeric *string* (`"15"`, ≤ 300).
- `birthDate`: `YYYY-MM-DD`; age must be 16–21 on the day of submit.
- `yesno` fields send `"yes"` / `"no"`.
- `radio` / `checkboxes` values must be one of the field's Hebrew options, exactly.
- Guardian fields (`guardianName`, `guardianPhone`, `guardianConsent: true`) are required
  **only** when age < 18, and dropped server-side for adults. `frameworkOther` only when
  `framework === "אחר"`.
- Phones: Israeli mobile, `0` + 8–9 digits; spaces and dashes are ignored.
- Strings are trimmed; any string > 2000 chars fails. Unknown keys are silently dropped.
- `website` is a honeypot: send it empty or omit it.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ "ok": true, "status": "pending_review" }` | Stored. Identical whether or not a red-flag answer was "yes", and for a honeypot hit. |
| 400 | `{ "error": "Invalid body" }` | Body is not a JSON object. |
| 400 | `{ "error": "validation", "errors": { "<field>": "<Hebrew message>" } }` | Any rule failed. **All** failing fields at once; `track` and `answers` are possible keys. Nothing stored. |
| 429 | `{ "error": "Too many attempts" }` | > 10 requests / minute / IP (per server instance). |
| 500 | `{ "error": "Could not save" }` or `{ "error": "Server error" }` | Never contains DB text. |
| 503 | `{ "error": "Service unavailable" }` | Env guard: the server is not wired to the one approved dev Supabase project. Checked **before** everything else. |

## Must-know for the client

1. **Duplicate protection (since 2026-11-20):** the same email + track within 10 minutes stores
   no second row and answers the same 200 — also for two submits fired at once (serialized per
   instance; across instances once migration 183 is applied). An email already holding 3 stored
   submits in the last hour (any track) also gets the same 200 and stores nothing. Still lock the
   send button after the first tap; a different track, or the same one after 10 minutes, is a new
   registration. See `public-route-abuse.md`.
2. **INTENTIONAL: 503 from the env guard.** Production and every environment other than the
   one approved dev Supabase project answer 503 `{ "error": "Service unavailable" }` on purpose
   (this route stores minors' details). It is not an outage and not a bug: show a neutral
   "not available yet" state, don't retry in a loop, and don't report it as a failure.
3. Use the `errors` keys to place messages on fields; the messages are Hebrew and display-ready.
4. Synthetic data only until the guardian/medical flow is approved.

## Admin list: GET /api/u21/registrations

Pinned by `src/__tests__/trackAReadContract.test.ts` and `u21RegistrationsRoute.test.ts`.
`Authorization: Bearer <Supabase access token>`; **admin or super user only**.

| Status | Body |
|---|---|
| 200 | `{ "data": [Row], "ready": true }` — newest first, max 500 |
| 200 | `{ "data": [], "ready": false }` — migration 180 not applied |
| 401 | `{ "error": "..." }` — no/invalid session |
| 403 | `{ "error": "forbidden" }` — signed in, not admin (a coach gets this too) |
| 500 | `{ "error": "Could not load" }` / `{ "error": "Server error" }` |
| 503 | `{ "error": "Service unavailable" }` — env guard, checked before auth (intentional, as above) |

`Row` has exactly: `id, first_name, last_name, age_band, track, red_flag, status, created_at`
(snake_case). No contact, guardian, birth date, medical answers or intake — by design.
