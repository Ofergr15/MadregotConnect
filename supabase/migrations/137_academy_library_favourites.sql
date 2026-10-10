-- The workout book v3's ❤ chip: a coach's favourite entries.
--
-- One row per (coach, entry). A coach may favourite any entry they can see, the canon
-- included, so this is not a column on the entry: a favourite belongs to the reader.
-- CASCADE both ways, because a favourite of a deleted entry, or of a coach who left, is
-- nobody's.
--
-- OPTIONAL. Without it, GET /api/academy/library answers `favouritesStored: false` and the
-- client keeps favourites on the device; nothing else depends on it.
--
-- NOTE for PostgREST: this table relates athletes to academy_workout_library a second way
-- (many-to-many), so a bare `athletes(name)` embed from the library becomes ambiguous
-- (PGRST201). The library route embeds `athletes!owner_id(name)` for that reason.
--
-- Locked like every table since 134: RLS on, nothing for anon/authenticated, service role
-- only through the API.

CREATE TABLE IF NOT EXISTS academy_library_favourites (
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES academy_workout_library(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_library_favourites_entry
  ON academy_library_favourites(entry_id);
ALTER TABLE academy_library_favourites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE academy_library_favourites FROM anon, authenticated;
GRANT ALL ON TABLE academy_library_favourites TO service_role;
