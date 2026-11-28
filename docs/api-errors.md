# API error bodies

Every 4xx/5xx body is

```jsonc
{ "error": "Human text, for people and logs — may be reworded",
  "code":  "stable_machine_code",
  /* optional extra keys a route documents, e.g. "left": 2, "allowed": [...] */ }
```

- **`code` is the contract.** Clients (web and iOS) switch on `code`, never on `error`.
  A code is never renamed, and never reused for a different meaning.
- **`error` is not a contract.** It is free to change wording; it never carries raw
  database or SDK text (`internalErrorBody`, PR #175/#231).
- Source: `src/lib/api-error.ts`. Pinned by `src/__tests__/errorCodeRatchet.test.ts`.

## Catalogue (generic codes)

| code | status | meaning | client action |
|---|---|---|---|
| `bad_request` | 400 | invalid input | fix the request; show a generic error |
| `unauthenticated` | 401 | no bearer token | sign in |
| `session_invalid` | 401 | expired / unknown session | refresh once, then sign in |
| `forbidden` | 403 | signed in, not allowed | show "not allowed" |
| `staff_required` | 403 | staff-only route | hide the staff entry point |
| `pending` | 403 | membership awaiting approval | pending-approval screen |
| `inactive` | 403 | membership not active | inactive screen |
| `view_as_read_only` | 403 | a write while viewing as someone | disable writes in view-as |
| `not_found` | 404 | the thing does not exist (or is not yours) | show empty / gone |
| `conflict` | 409 | state changed under you | reload and retry |
| `payload_too_large` | 413 | body or file too big | shrink |
| `rate_limited` | 429 | too many requests | back off |
| `internal` | 500 | server error (logged) | retry later |
| `unavailable` | 503 | a dependency is down | retry later |
| `auth_unavailable` | 503 | could not verify the session right now — **not** a sign-out | retry, keep the session |
| `maintenance` | 503 | maintenance window | maintenance screen |

**Route codes.** A route may send its own, more specific code (`no_plan`, `table_missing`,
`insufficient_credits`, `wrong-code`, …) when a client needs to tell cases apart. Rules: a
lowercase slug (`CODE_SLUG`), documented in the route's header comment or its
`docs/contracts/*.md` note, and the same stability promise as the catalogue. A new
"migration not applied yet" case should use `migration_pending` (several spellings exist
today: `migration-pending`, `not-migrated`, `unmigrated`, `table_missing` — keep them, they
are read by clients).

## Where `code` comes from today

| Source | Covers |
|---|---|
| `authError()` (`lib/auth-session.ts`) | every 401/403/503 from `requireSession` / `requireAthlete` and the gates built on them |
| `resolveVerifiedCaller` + `requireStaffCaller` / `requireCallerForAthlete` / `requirePackLeader` (`lib/auth/self-or-staff.ts`), `require-approver`, `require-content-staff` | the shared 403s and the maintenance 503 |
| `internalErrorBody()` | the 500s already converted (#175; #231 converts 87 more) |
| `errorBody()` / `apiError()` | new code |
| inline literals in route files | **not yet** — the ratchet counts them (2,158 at the start) and the count may only go down |

## For clients

`errorCodeOf(status, body)` (`lib/api-error.ts`) returns the body's `code` when present and
otherwise the generic code for the status, so a client gets a stable answer from routes
that have not been converted yet. The iOS app should implement the same fallback.

## Writing a new error

```ts
import { apiError, errorBody } from '@/lib/api-error';

return apiError(404, 'Feed item not found');                 // code: not_found
return apiError(403, 'pending', 'pending');                  // a catalogue code
return NextResponse.json(errorBody(401, 'wrong-code', undefined, { left }), { status: 401 });
```
