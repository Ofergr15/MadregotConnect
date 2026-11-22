-- 188 — Academy home (design/academy-prototype BUILD-BRIEF.md): trainee self-reports,
-- coach capacity, academy pause reason.
--
-- Paste into the Supabase SQL editor (NOT production until approved). Safe to re-run.
-- Until applied the app degrades on purpose (src/app/api/academy/hub, self-report, assign):
--   * no self-report table → POST /api/academy/self-report answers 503 migration_pending,
--     the hub shows "asked of you" open and no RPE history;
--   * no academy_capacity → every coach reads DEFAULT_CAPACITY (8, lib/academy/capacity.ts);
--   * no academy_pause_reason → paused trainees (athletes.availability, migration 186) show no reason.
--
-- One FK to athletes per new table (athlete_id) so no embed between the two becomes ambiguous
-- (schemaEmbedAmbiguity.test.ts).

-- 1) The trainee's own report on a workout. The coach's feedback stays in academy_workout_feedback.
create table if not exists academy_trainee_reports (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  workout_date date not null,
  activity_id uuid,
  rpe smallint not null check (rpe between 1 and 10),
  effort text check (effort is null or effort in ('easy', 'right', 'hard', 'too_hard')),
  pain boolean not null default false,
  pain_area text,
  pain_level smallint check (pain_level is null or pain_level between 1 and 10),
  note text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (athlete_id, workout_date)
);
create index if not exists academy_trainee_reports_athlete_idx on academy_trainee_reports (athlete_id, created_at desc);

-- Service role only, like 134/135: no policies → anon/auth keys read nothing.
alter table academy_trainee_reports enable row level security;

-- 2) Per-coach ceiling for the manager's load view and assignment sheet. NULL = default.
alter table athletes add column if not exists academy_capacity integer;
do $$ begin
  alter table athletes add constraint athletes_academy_capacity_check
    check (academy_capacity is null or academy_capacity between 1 and 40);
exception when duplicate_object then null; end $$;

-- 3) Why an academy trainee is paused (injury, reserve duty …). The state itself is
--    athletes.availability = 'paused' (186); this is only the reason the manager sees.
alter table athletes add column if not exists academy_pause_reason text;
