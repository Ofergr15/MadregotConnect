-- 186 — The coach screens: who is out (injured / paused), and the coach's own lists.
--
-- Paste into the Supabase SQL editor. Safe to re-run. Until it is applied the app
-- degrades on purpose: every runner reads as `active` and the roster has no lists
-- section (src/lib/coach/roster-server.ts), and writes to either answer 503
-- `migration_pending` rather than pretending to save.
--
-- 1) athletes.availability — set by the runner OR by staff (decision 2026-11-21).
--    `availability_set_by` is derived server-side from the verified caller
--    (PUT /api/athletes/[id]/availability), never from the request body.
alter table athletes add column if not exists availability text not null default 'active';
alter table athletes add column if not exists availability_set_by text;
alter table athletes add column if not exists availability_since timestamptz;

do $$ begin
  alter table athletes add constraint athletes_availability_check
    check (availability in ('active', 'injured', 'paused'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table athletes add constraint athletes_availability_set_by_check
    check (availability_set_by is null or availability_set_by in ('coach', 'self'));
exception when duplicate_object then null; end $$;

-- 2) Custom lists (ולנסיה, …). Staff-only writes. Deliberately ONE foreign key to
--    athletes (athlete_list_members.athlete_id): `created_by` is a bare uuid, so no
--    second athletes relationship appears and no existing embed becomes ambiguous
--    (schemaEmbedAmbiguity.test.ts). Readers hint the embed anyway (athletes!athlete_id).
create table if not exists athlete_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists athlete_list_members (
  list_id uuid not null references athlete_lists(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, athlete_id)
);
create index if not exists athlete_list_members_athlete_idx on athlete_list_members (athlete_id);

-- Service-role only, like the rest of the staff tables: RLS on, no policies.
alter table athlete_lists enable row level security;
alter table athlete_list_members enable row level security;

-- 3) Who hears a runner's own "I'm injured / pausing" (routing.ts → availability_change).
--    A full row per role, as 099 does, so the admin grid shows it.
insert into notification_routing (kind, role, enabled) values
  ('availability_change', 'admin',         true),
  ('availability_change', 'coach',         true),
  ('availability_change', 'academy_coach', false)
on conflict (kind, role) do nothing;
