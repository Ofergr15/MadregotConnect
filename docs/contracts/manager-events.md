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

## Capabilities: `GET /api/me/capabilities` (built on `u21-manager-events`, local)
Bearer session. `401` without one. Read-only: two `app_settings` reads, no write, push or mail. Never call `/api/auth/me` for this.
```json
{
  "viewingAs": false,
  "events":      { "manage": true },
  "messages":    "publish",
  "clubUpdates": { "read": true, "write": true, "admin": false },
  "people":      { "read": true, "admin": false },
  "approve":     false,
  "viewAs":      false
}
```
| Field | Same gate as | Server rule |
|---|---|---|
| `events.manage` | POST/PATCH/DELETE `/api/events` | `isStaff \|\| isSuperUser` |
| `messages` (`"publish"`/`"draft"`/`"none"`) | `/api/admin/publish/message` (publishGate) | `canApprove` or content grant `messages` ≥ 3 → publish; grant = 2 → draft (a 202 draft awaiting approval); else none. The role floor does NOT count here, as in publishGate |
| `clubUpdates.*` | `lib/club-updates/access` | `accessFor(config, athleteId, admin)` |
| `people.read` | GET `/api/admin/people`, `/api/admin/users` | `isStaff \|\| isSuperUser` |
| `people.admin` | `/api/admin/roles`, `/api/admin/people/delete` | `isSuperUser \|\| hasRole('admin')` |
| `approve` | `/api/admin/approve`, `/api/admin/registrations/approve` | `canApprove` |
| `viewAs` | `/api/admin/view-as` | `mayViewAs` (real session only) |

- Unknown or missing role → everything false (not staff).
- **View-as**: the answer is the viewed person's, `viewingAs: true`, and every write flag is false (the server refuses
  writes in view-as with `view_as_read_only`). Only `clubUpdates.read` and `people.read` can stay true.
- A UI hint, never the security boundary: each route re-checks. Grants are cached up to 60 s per server instance,
  so a revoked grant can still read `true` for up to a minute (the route itself uses the same cache).
- Pinned by `meCapabilities.test.ts`.
