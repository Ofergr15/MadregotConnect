# POST /api/academy/register — contract for the native client

Pinned by `src/__tests__/academyRegisterContract.test.ts` (plus the existing
`academyRegister*.test.ts`). Public, no auth header. In production today.

## Request

```json
{
  "name": "First Last",          // required, must contain at least one letter
  "email": "a@b.com",            // required (format NOT checked server-side)
  "phone": "0501234567",         // optional
  "intake": { ... },             // optional object: every other form answer
  "inviteToken": "<hex>",        // optional: from a coach's personal link (?i=)
  "src": "instagram",            // optional attribution tag
  "website": ""                  // honeypot: send empty or omit
}
```

The web form (`src/app/academy-register/page.tsx`) sends `firstName`, `lastName` and every
remaining answer inside `intake`, and `name = "<firstName> <lastName>"`. **The server does not
validate `intake` at all** — keys, types and "required" answers are stored exactly as sent
(a non-object becomes `null`). All field validation (required answers, options, sizes,
conditional fields such as `medicalDetails` / `hearAboutOther`) must happen in the client,
mirroring the web form's field list.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ "success": true }` | New applicant, re-submit, existing member (row untouched), or honeypot hit — deliberately indistinguishable. |
| 200 | `{ "success": true, "letIn": true \| false }` | Card imported from the academy's file: `letIn` says whether confirming let them in. |
| 200 | `{ "success": true, "alreadyIn": true }` | Card already accepted: details saved, nobody mailed. Show "you're already in". |
| 400 | `{ "error": "Name and email are required" }` | Missing/blank `name` or `email`. |
| 400 | `{ "error": "Please write your name", "code": "no-letters" }` | `name` has no letters. |
| 403 | `{ "error": "Academy registration is currently closed.", "message": "ההרשמה לאקדמיה סגורה כרגע." }` | Manager closed registration and no live invite token. Show `message`. |
| 429 | `{ "error": "Too many attempts, try again in a minute" }` | > 5 / minute per IP+email, or > 40 / minute per IP. |
| 500 | `{ "error": "<message>" }` | **May contain raw server/DB text** — show a generic message, never this string. |

## Double submit

- A still-pending application is updated in place (same row, same invite token) — no second
  account. Once accepted, a re-submit refreshes only `name`, `phone`, `intake`.
- Mails and staff push for the same card go out **once per 10 minutes**
  (`FORM_RESEND_WINDOW_MS`); atomic only after migration 178, best effort before.
- The client should still lock the button after the first tap (the web form does).

## Must-know for the client

1. **No environment guard.** Unlike U21, this route writes the real `athletes` table and sends
   real emails (applicant + staff) and a real staff push on whatever server it points at.
   Never exercise it from a build pointed at production with test data.
2. **INTENTIONAL: one uniform 200.** A new applicant, a re-submit, an address that already
   belongs to a club member (whose row is left untouched), and a honeypot hit all answer
   `{ "success": true }`. This is anti-enumeration: the public form must not reveal whose
   address is on the roster. Don't try to infer membership from it, and don't ask the server
   to differ. Only `letIn` / `alreadyIn` vary, and only for the holder of that card.

## Prefill: GET /api/academy/register?i=<token>

Pinned by `src/__tests__/trackAReadContract.test.ts`. Public; the token (32 lowercase hex,
from the coach's personal link) is the credential. Always 200:

```json
{ "prefill": { "name": "", "email": "", "phone": "", "existing": false } }
{ "prefill": { ..., "existing": true, "imported": true, "fields": { "<key>": "<value>" } } }
{ "prefill": null }
```

- Missing values come back as `""`, never `null`.
- `existing: true` = someone already training with the club updating details.
  `imported` + `fields` appear only for a card opened from the academy's file.
- `null` for no token, a malformed token, an unknown or expired invite (older than the invite TTL),
  or any server error — open the form empty.
- Note: an **archived** card whose invite is still inside the TTL still returns its prefill
  (`archived_at` is read but not checked here; the POST's closed-door check does check it).
