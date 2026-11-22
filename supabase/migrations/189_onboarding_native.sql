-- 189 — Native sign-in & onboarding (design/onboarding-prototype, BUILD-BRIEF gaps 2–5).
--
-- Paste into the Supabase SQL editor by hand, like every migration here. Safe to
-- re-run. Every route that reads these columns falls back when they are missing:
--   • no status_secret_hash   → /api/public/signup returns no secret, the app says
--                                "we'll email you" and does not poll;
--   • no setup_progress       → /api/auth/me derives the setup from garmin/strava/avatar
--                                only, and POST /api/onboarding/setup answers 503 not-ready;
--   • no group_change_requests → POST /api/onboarding/group-change answers 503 not-ready
--                                and the app falls back to WhatsApp.

-- ── Gap 2: pending status without a session ─────────────────────────────────
-- The applicant's app keeps a random secret (Keychain); only its SHA-256 lives here.
-- It reads ONE row's status and, once, on approval, mints that member's session.
alter table signup_requests add column if not exists status_secret_hash text;
-- When the one-time sign-in on approval was spent. After this the secret only
-- reads status; signing in again is the email code.
alter table signup_requests add column if not exists status_grant_used_at timestamptz;
-- Gap 3: "להודיע לי". There is no APNs sender for an applicant (device-token needs a
-- session), so the opt-in is honest about what exists: the approval email plus polling.
alter table signup_requests add column if not exists notify_opt_in_at timestamptz;

comment on column signup_requests.status_secret_hash is
  'sha256(base64url secret) handed to the applicant once by POST /api/public/signup; keys POST /api/public/signup/status (migration 189).';

-- ── Gap 5: first-run setup progress, server-side so a reinstall resumes ─────
-- { "notifications": "granted"|"denied"|"skipped",
--   "group": "confirmed"|"requested"|"skipped",
--   "watch": "apple"|"skipped", "photo": "skipped",
--   "dismissedAt": iso, "completedAt": iso }
-- Watch connected and photo set are DERIVED (garmin_auth / strava_athlete_id /
-- avatar_url), never stored twice.
alter table athletes add column if not exists setup_progress jsonb not null default '{}'::jsonb;

-- ── Gap 4: a pace-group change asked for during setup ──────────────────────
-- A request, never a switch: the athlete asks, staff decide in the app.
create table if not exists group_change_requests (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  from_group_id uuid,
  to_group_id uuid not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
-- NOTE: from/to/decided_by are deliberately NOT foreign keys. A second
-- `references athletes` (decided_by) or `references groups` would make every
-- unhinted embed between those tables ambiguous (CLAUDE.md: how 125 took the feed
-- down). The ids are validated in the route instead.

-- One open request per athlete: asking again replaces the target, not the queue.
create unique index if not exists group_change_requests_one_open
  on group_change_requests (athlete_id) where status = 'pending';

alter table group_change_requests enable row level security;
-- No policies: service-role only, like signup_requests.

-- Routing for the new staff alert (lib/notifications/routing.ts ROUTED_KINDS).
-- Seeded to match signup_request (who approves a runner decides their pack too).
do $$
begin
  if to_regclass('public.notification_routing') is not null then
    insert into notification_routing (kind, role, enabled) values
      ('group_change_request', 'admin',         true),
      ('group_change_request', 'coach',         true),
      ('group_change_request', 'academy_coach', false)
    on conflict (kind, role) do nothing;
  end if;
end $$;
