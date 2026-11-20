# Staff write routes — authorization as found in code (H10.2)

Pinned by `src/__tests__/staffWriteAuthz.test.ts`: every deny below is asserted with
its status AND with zero insert/update/upsert/delete reaching Supabase.
Recorded 2026-11-20 from the code as it stands; this is a description, not a policy.

`allow` = passes the gate. `401` = no bearer session. `403` = wrong role.
`super_user` = a `runner` row with `is_super_user` (also `canApprove`).
`approver` = a `runner` row with `is_approver` only.

| Route | none | runner | core_runner | viewer | coach | academy_coach | admin | super_user | approver |
|---|---|---|---|---|---|---|---|---|---|
| POST /api/events | 401 | 403 | 403 | 403 | allow | allow | allow | 403 | 403 |
| PATCH /api/events/[id] | 401 | 403 | 403 | 403 | allow | allow | allow | 403 | 403 |
| DELETE /api/events/[id] | 401 | 403 | 403 | 403 | allow | allow | allow | 403 | 403 |
| PUT /api/admin/club-updates | 401 | 403 | 403 | 403 | 403 | 403 | allow | allow | 403 |
| POST /api/admin/surveys | 401 | 403¹ | 403¹ | 403¹ | 403¹ | 403¹ | 403¹ | allow | allow |
| POST /api/club-updates | 401 | 403² | 403² | 403² | 403² | 403² | allow | allow | 403² |
| PATCH /api/club-updates/[id] | 401 | 403² | 403² | 403² | 403² | 403² | allow | allow | 403² |
| DELETE /api/club-updates/[id] | 401 | 403² | 403² | 403² | 403² | 403² | allow | allow | 403² |
| POST /api/club-updates/[id]/react | 401 | allow³ | allow³ | allow³ | allow³ | allow³ | allow | allow | allow³ |

¹ unless the caller has a content grant for `surveys` (see F1).
² with the feature on and the caller NOT on `writerIds`. A listed writer may POST and may
  PATCH/DELETE only their own update (`mayEdit`).
³ only while `club_updates.enabled` is true; with the feature off every non-admin gets 403.

/api/admin/surveys has only GET (approver) and POST; no PATCH/DELETE exist.
/api/admin/club-updates has GET (admin) and PUT.

## Gates

| Route | Gate | Where |
|---|---|---|
| events POST | `requireSession` → `auth.user.isStaff` | `src/app/api/events/route.ts:62-64` |
| events/[id] PATCH | same | `src/app/api/events/[id]/route.ts:57-59` |
| events/[id] DELETE | same | `src/app/api/events/[id]/route.ts:107-109` |
| `isStaff` itself | `STAFF_ROLES` (`admin`,`coach`,`academy_coach`) or a held staff role (`academy_manager` too); not `isSuperUser` | `src/lib/auth-session.ts:288`, `src/lib/constants.ts:38` |
| admin/club-updates PUT | `clubUpdatesCaller` → `access.admin` | `src/app/api/admin/club-updates/route.ts:30` |
| `access.admin` | `isSuperUser \|\| hasRole('admin')` | `src/lib/club-updates/access.ts:17` |
| admin/surveys POST | `publishGate(..., u => u.canApprove)`, then content grant level | `src/app/api/admin/surveys/route.ts:66`, `src/lib/access/publish-gate.ts:25-26` |
| club-updates POST | `access.canWrite && athleteId` | `src/app/api/club-updates/route.ts:38` |
| club-updates/[id] PATCH / DELETE | `mayEdit(access, athleteId, author)` | `src/app/api/club-updates/[id]/route.ts:20`, `:59` |
| club-updates/[id]/react POST | `access.canRead && athleteId` | `src/app/api/club-updates/[id]/react/route.ts:13` |
| `canWrite`/`canRead`/`mayEdit` | `accessFor` / `mayEdit` | `src/lib/club-updates/model.ts:72-79` |

## Findings (reported, not fixed)

- **F1 — surveys: a non-staff role can cause writes via a content grant.** `publishGate`
  ignores the caller's role (`levelsFor({ role: 'runner' }, grant)`): a runner with a
  level-3 `surveys` grant publishes outright; with level 2 the request is stored as a draft
  (`addDraft`, a DB write) and the owner is pushed, answered 202. Grant-driven by design,
  but it means "staff" is not the boundary here.
- **F2 — surveys: role `admin` alone cannot publish.** The legacy rule is `canApprove`
  only, so an admin/coach without `is_approver` (and no grant) gets 403. Inconsistent with
  the other admin writes; a native admin area should expect it.
- **F3 — events: super user is not staff.** `isStaff` reads roles only, so a super-user
  flag on a `runner` row gets 403 on events while it is admin for club-updates.
- **F4 — club-updates: writes are list-driven, not role-driven.** Any runner on
  `writerIds` may post and edit/delete their own updates; `coach`/`academy_coach` may not
  unless listed. React is a member write (any role) while the feature is on — by design.

## Resolved 2026-11-20 (owner approval)
- F2: `POST /api/admin/surveys` now also allows the admin role (`admin/surveys/route.ts:66`). A coach still needs the approver flag.
- F3: events POST/PATCH/DELETE now also allow a super user (`isStaff || isSuperUser`).
- F1 and F4 left as designed: content grants and the club-updates writer list are deliberate delegation.
