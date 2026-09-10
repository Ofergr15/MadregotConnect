-- 099 — Who receives each management alert, as data instead of code.
--
-- The recipient list for staff alerts (bug reports, pain flags, store orders,
-- sign-ups, the health checks) was compiled into staffRecipientIds(). It was
-- narrowed twice in two days, each time by a deploy, and each time the only way
-- to find out it was wrong was to count pushes on a real phone. This table makes
-- the rule visible and editable from Control Room → התראות.
--
-- One row per (kind, role). Roles are deliberately limited to the staff-ish ones
-- by the app (see src/lib/notifications/routing.ts): routing a private pain
-- report to `runner` would fan it out to the whole club.
--
-- The seed below REPRODUCES THE BEHAVIOUR IN CODE AS OF 2026-09-10 EXACTLY, so
-- applying this migration changes nothing on its own:
--   • the six notifyStaff kinds → admin only (the 2026-09-09 narrowing)
--   • program_week_missing → admin + coach, which is what APPROVER_EMAILS
--     resolved to for the accounts that could actually receive it (yairgb =
--     coach, madregot.club = admin; grosfeldofer is role='runner' and is the
--     duplicate this whole change exists to stop)
--
-- Safe to re-run.

create table if not exists notification_routing (
  kind text not null,
  role text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (kind, role)
);

comment on table notification_routing is
  'Which roles receive each management notification kind. Edited from Control Room → התראות; read by recipientsForKind() in src/lib/notifications/routing.ts. A kind with no rows here falls back to the hardcoded admin-only list.';

-- Every (kind, role) pair gets a row, including the false ones: the admin screen
-- shows a full grid, and a missing row would be indistinguishable from an
-- unconfigured kind (which is what makes a sender fall back to admin-only).
insert into notification_routing (kind, role, enabled) values
  ('problem_report',          'admin',         true),
  ('problem_report',          'coach',         false),
  ('problem_report',          'academy_coach', false),
  ('feedback_alert',          'admin',         true),
  ('feedback_alert',          'coach',         false),
  ('feedback_alert',          'academy_coach', false),
  ('signup_request',          'admin',         true),
  ('signup_request',          'coach',         false),
  ('signup_request',          'academy_coach', false),
  ('store_order',             'admin',         true),
  ('store_order',             'coach',         false),
  ('store_order',             'academy_coach', false),
  ('workout_delivery_failed', 'admin',         true),
  ('workout_delivery_failed', 'coach',         false),
  ('workout_delivery_failed', 'academy_coach', false),
  ('program_week_missing',    'admin',         true),
  ('program_week_missing',    'coach',         true),
  ('program_week_missing',    'academy_coach', false),
  ('sync_stalled',            'admin',         true),
  ('sync_stalled',            'coach',         false),
  ('sync_stalled',            'academy_coach', false)
on conflict (kind, role) do nothing;
