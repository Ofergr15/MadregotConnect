-- 099 · Pages granted to ONE member, on top of what their role grants.
--
-- role_tab_permissions is a role×tab table, so it has no row for a person: the
-- only way to give one runner one extra page was to give it to all 17, or to
-- invent a role for them. The two membership flags (is_core_runner, is_academy)
-- are the existing escape hatch and they work precisely because they are
-- ADDITIVE — they union onto the role's list and can never take a tab away.
-- This table is the general case of the same idea.
--
-- DELIBERATELY NO `enabled boolean`. A grant is the presence of a row, so there
-- is no way to write "deny this member a page their role gives everyone" — that
-- would be a second source of truth free to disagree with the matrix, and the
-- state it creates ("why does Ron alone not have the program?") is invisible on
-- every screen except this one. To take a page away you change the role, the
-- flag, or the matrix. Revoking a GRANT is just deleting its row.
--
-- Applied by hand in the Supabase SQL editor (this project has no DDL
-- connection), so every reader of it must tolerate the table not existing yet.

create table if not exists athlete_tab_grants (
  -- on delete cascade: a grant is meaningless without the member, and removing
  -- someone from the club must not leave rows that re-grant a recycled uuid.
  athlete_id uuid not null references athletes(id) on delete cascade,
  -- A tab id from ALL_NAV_ITEMS in src/lib/nav-items.ts. Not a foreign key —
  -- the tab list lives in code, and a stale row for a page that no longer
  -- exists is inert (resolveNavItems filters by the code list, so an unknown
  -- tab resolves to nothing rather than to a broken nav entry).
  tab text not null,
  created_at timestamptz not null default now(),
  -- Who granted it. Free text, matching how the rest of this schema records an
  -- acting admin, and the only trace of intent this table can hold.
  created_by text,
  -- One grant per member per tab, and the reason the writer can upsert.
  primary key (athlete_id, tab)
);

comment on table athlete_tab_grants is
  'Additive per-member page grants, unioned onto role_tab_permissions by resolveNavItems. A row grants; there is no deny.';
