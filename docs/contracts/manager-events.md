# Manager: create / edit events (contract for the native client)

## Create: `POST /api/events`
- `Authorization: Bearer <session.access_token>`. No session → `401`. Signed in but not staff or super-user → `403`.
  Both refuse before any write or send.
- Body: `{ kind, name, date, location, ...optional, notify? }` — `kind` ∈ `EVENT_KINDS` (`src/lib/events.ts`).
- **`notify`** (since branch `u21-manager-events`):
  - absent or `true` → the original behaviour: one push to the whole club (`resolveAudience('all')`, category `events`).
  - `false` → **silent**: the event is created and nothing is sent (the audience is not even resolved).
    Use it for manager drafts and every synthetic or test event.
  - any other value (`"false"`, `0`, `null`) → `400`, nothing written.
- `200 { event, notified }` — `notified` echoes whether the push path ran (not whether it was delivered).
- The route sends no email and no APNs itself; push is the only channel. Pinned by `eventCreateSilent.test.ts`.

## Edit / delete: `PATCH` / `DELETE /api/events/:id`
Staff or super-user, as above. **Neither sends anything** (no push or email import in the route).
`course_gpx_url` needs migration 181 (`503 { error: "migration 181 not applied" }` before it).

## Not on the dev surface yet
None of these writes is on the dev allowlist (`src/lib/dev-api-allowlist.ts`). Adding them is a coordinator
decision; even then, the dev surface suppresses all push (`f71500c7`, local) as a second guard.

## Capabilities (proposal, not built)
The client needs "may this user manage events / send / approve" without calling `/api/auth/me` (it writes).
Proposed: a new `GET /api/me/capabilities` → `{ isStaff, isSuperUser, canApprove, canPublishMessages }`, read-only,
computed from the same verified session `requireSession` returns. JSON shape to be agreed with the writer.
