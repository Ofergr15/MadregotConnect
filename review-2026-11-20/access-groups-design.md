# Access groups — user management in ניהול (design, 28.11)

Owner ask (Ofer, 28.11): "ניהול משתמשים שכולל איזה מסכים יש לכל אחד — ושם יש קבוצות
כמו מנהלים וכאלה שאני יכול ליצור שם ולשלוט מהאפליקציה שלי".

Today the launch stages (owners → core runners → Valencia → academy pilot → everyone) are
hand-written SQL (`supabase/ops/launch-stage1-flags.sql`). After this, each stage is a group
the owner creates in the app, with members and a screen set.

## Words

- **קבוצת גישה (access group)** — an owner-made list of people, e.g. "בעלים", "מנהלים",
  "גרעין", "פיילוט אקדמיה", "ולנסיה". Not a pack (`groups` table = דבוקה, the `squad` scope)
  and not a role. A person can be in any number of access groups.
- **מסך (screen)** — a key in `FEATURES` (`src/lib/features/flags.ts`). The app already gates
  every new surface on one.

## Server

### Migration 226 (file only — the owner pastes it)

- `access_groups (id uuid, name text unique, color text '#RRGGBB', created_by, created_at, updated_at)`
- `access_group_members (group_id → access_groups ON DELETE CASCADE, athlete_id → athletes ON DELETE CASCADE, added_by, added_at, PK(group_id, athlete_id))`
- `access_group_audit (id, group_id, action, detail jsonb, actor, actor_name, at)` — create / rename /
  recolor / delete / member_add / member_remove. Screen changes go to the existing
  `feature_enablement_audit` with `scope_type = 'access_group'`.
- `feature_enablements.scope_type` CHECK widened to include `access_group`.
- RLS on, no policies: service-role only, like every other table here.
- Neither new table references a table both already reference twice, so no embed ambiguity
  (`access_group_members → athletes` is the only athletes FK).

### Resolution

`athlete > access_group > squad > academy > role > club > default(off)`.

The task wording was "athlete > group > role > default". The existing ranks keep squad and
academy between them, so access groups slot directly under athlete. An explicit OFF wins at
the same level — this matters now, because a person in two groups can get two answers for
one screen (ON from "גרעין", OFF from "ולנסיה" → off). That rule already exists in
`resolveFeature` for multi-role; it now covers groups too.

`AthleteFacts.accessGroupIds` is read with the athlete. Table missing (226 not pasted) →
`[]`, i.e. behaviour identical to today; it never fails a resolution.

### Endpoints — all admin-only

Gate: `resolveVerifiedCaller` → `isSuperUser || hasRole(admin)`; anything else 403. Same
reasoning as `/api/admin/notifications`: the club has a `Test Coach` fixture account, and a
group decides who sees management screens. Writes refused while `viewingAsBy`. Identity of the
actor is the JWT, never the body. 503 `migration_pending` while 226 is unapplied.

| Method | Path | Body | |
|---|---|---|---|
| GET | `/api/admin/access-groups` | — | groups with member count + screens map |
| POST | `/api/admin/access-groups` | `{name, color}` | create |
| GET | `/api/admin/access-groups/{id}` | — | group, members (id, name, avatar, role), screens |
| PATCH | `/api/admin/access-groups/{id}` | `{name?, color?}` | rename / recolor |
| DELETE | `/api/admin/access-groups/{id}` | — | delete; also deletes its `feature_enablements` rows |
| POST | `/api/admin/access-groups/{id}/members` | `{athleteIds: []}` | add (max 300 per call) |
| DELETE | `/api/admin/access-groups/{id}/members?athleteId=` | — | remove |
| PUT | `/api/admin/access-groups/{id}/screens` | `{feature, enabled: true\|false\|null}` | null = clear |
| GET | `/api/admin/users?q=` | — | search: id, name, avatar, role, group ids |
| GET | `/api/admin/users/{id}/screens` | — | role, groups, every screen with `enabled` + `source` |

Personal override: the existing `PUT /api/features/{key}/enablements` with
`scopeType: 'athlete'` (admins may already write any scope). No new write path.

`source` is `{ scopeType, scopeId, label }` where label is the group name / role / "אישי" /
"ברירת מחדל", so the user page can say *why* a screen is on.

Deleting a group deletes its enablement rows in the same request (otherwise orphaned rows
would revive if a group with the same id ever reappeared — it can't, uuids, but orphans
also clutter the rollout screen's audit).

### Exposure

New: an admin can read every member's role + group memberships + effective screen set in one
response. Recorded in CLAUDE.md. Nothing a non-admin can reach changes.

## Native (b27-cand, inside ניהול)

Flag: `native_access_groups` (default off) — server FEATURES + `FeatureCatalog.swift`.

- **משתמשים** — search field on top, list (avatar, name, role chip, group dots). Tap → user
  page: header (name, role), "קבוצות" section (coloured chips, + to add), "מסכים" section
  grouped like the management menu; each row: Hebrew label, source caption ("מקבוצת גרעין",
  "מתפקיד", "אישי", "ברירת מחדל"), toggle. Flipping a toggle writes a personal override;
  a "חזרה לברירת המחדל" swipe clears it.
- **קבוצות** — list (colour dot, name, "N חברים"), + in the toolbar → composer.
- **Composer** (Edit-Alarm pattern): ✕ / ✓ in the nav bar, grouped inset rows — name, colour
  (8 swatches), "חברים" row → member picker, "מסכים" checklist grouped by menu section;
  "מחיקת קבוצה" alone at the bottom, red, confirmation dialog.
- Colour rule: ink for buttons and selected fills; #1525FF only for tappable text;
  each group in its own colour. No gray blocks.
- Break-ui cases: 200 users (lazy list + search), 40-char Hebrew names, group with 0 members
  ("אין חברים עדיין" + add button), person in 6 groups (chips wrap).

## Order

1. This doc. 2. Server PR from origin/main (never merged by me). 3. Mockups in the simulator →
kickoff audit. 4. Wire screens behind the flag.
