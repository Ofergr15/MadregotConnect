-- Move super-user and approver rights off email literals and onto the athlete row.
--
-- WHY: a Strava-only signup has no email to give, so the app mints a synthetic
-- one (`strava_<id>@strava.madregot.local`, `stravaAuthEmail`). Every
-- privilege check that compares an address against a hardcoded literal —
-- isSuperUser, canApprove, canGrantAdmin — then silently returns false, while
-- role-based checks (isStaff) keep passing. The account looks like an admin and
-- is neither a super-user nor an approver. Ofer's own account has been in
-- exactly that state since he signed in through Strava: `role='admin'`, but no
-- view-as switcher, no Approve button, and `PUT /api/practice-videos` refuses
-- him. Any future Strava signup inherits the same problem.
--
-- WHY NOT the obvious data fix: writing his real address onto the athletes row
-- would lock him out completely. `requireSession` resolves the athlete strictly
-- by `.eq('email', <JWT email>)`; the JWT would still carry the synthetic
-- address, match nothing, fall through to `coaches`, and 403 "No membership
-- found" on every authenticated route. There is no middleware to catch that.
--
-- WHY NOT `role = 'admin'`: it is not narrow. Seven active athletes hold that
-- role today, including the club's designer. Super-user is one person and
-- approver is three, so deriving from role would widen a 1-person capability to
-- 7 and hand view-as-anyone plus broadcast-to-the-whole-club along with it.
-- Explicit flags keep the current boundary exactly where it is while making it
-- expressible for an account that has no usable email.
--
-- The email allowlists in src/lib/constants.ts stay as a fallback, so this
-- migration only ever adds access and can be applied before or after the code.

alter table athletes
  add column if not exists is_super_user boolean not null default false,
  add column if not exists is_approver   boolean not null default false;

comment on column athletes.is_super_user is
  'May "view as" any member (read-only preview). Replaces the SUPER_USER_EMAIL literal, which cannot express a Strava-only account. Keep this to as few rows as possible.';
comment on column athletes.is_approver is
  'May approve registrations and send club-wide broadcasts/surveys. Replaces the APPROVER_EMAILS literal.';

-- Seed from the literals that are authoritative today, so applying this changes
-- nobody's access. Matched on the athletes row's own email.
update athletes set is_approver = true
 where lower(btrim(email)) in ('yairgb@gmail.com', 'grosfeldofer@gmail.com', 'madregot.club@gmail.com');

update athletes set is_super_user = true
 where lower(btrim(email)) = 'grosfeldofer@gmail.com';

-- And the row this migration exists for: Ofer's live, active, Strava-authed
-- account, whose email is synthetic and therefore matches neither list above.
-- Keyed on the address rather than the id so it is self-describing, and scoped
-- to `active` so the empty `status='invited'` stub holding his real address is
-- left alone.
update athletes
   set is_super_user = true, is_approver = true
 where email = 'strava_106828158@strava.madregot.local'
   and status = 'active';

-- Partial indexes: both flags are read on the hottest path in the app (every
-- authenticated request resolves the athlete row) and are true for a handful of
-- rows, so index only those.
create index if not exists athletes_is_super_user_idx on athletes (id) where is_super_user;
create index if not exists athletes_is_approver_idx   on athletes (id) where is_approver;
