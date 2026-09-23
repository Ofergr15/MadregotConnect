-- 121: "What's new" — one release a day, with the owner's picks.
-- See src/lib/release-notes.ts. Both tables are read and written only by
-- /api/whats-new with the service role; RLS on with no policies keeps the
-- anon key out.
CREATE TABLE IF NOT EXISTS releases (id bigserial PRIMARY KEY, released_at timestamptz NOT NULL DEFAULT now(), app_version text NOT NULL, note_ids text[] NOT NULL DEFAULT '{}');
CREATE UNIQUE INDEX IF NOT EXISTS releases_app_version_key ON releases(app_version);
CREATE TABLE IF NOT EXISTS release_note_picks (note_id text PRIMARY KEY, featured boolean NOT NULL DEFAULT true, title text, body text, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_note_picks ENABLE ROW LEVEL SECURITY;
