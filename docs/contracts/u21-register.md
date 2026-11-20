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

1. **No duplicate protection on the server.** Two identical submits store two rows and
   both return 200. The client must lock the send button after the first tap and not
   auto-retry a request that may have reached the server.
2. **503 is the normal answer from production and from any non-approved environment**,
   by design — not an outage. Show a neutral "not available" state.
3. Use the `errors` keys to place messages on fields; the messages are Hebrew and display-ready.
4. Synthetic data only until the guardian/medical flow is approved.
