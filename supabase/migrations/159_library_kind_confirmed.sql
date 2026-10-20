-- 159_library_kind_confirmed.sql
--
-- The workout book filled from the whole history (Ofer, 2026-10-20: "maybe run over all
-- the workouts we put into the app historically?"). The fill writes every session the
-- history holds in one go, but the TYPE of each one must be a person's choice, never the
-- import's guess ("only that way it is labelled truthfully"). `kind` is NOT NULL, so the
-- guess is stored there and this column says it is only a guess: false until a manager
-- classifies the entry. Every existing row was written with a chosen type, so the default
-- is true.
--
-- `import_key` is the structure the entry was imported under (book-import importKeyOf), so
-- re-running the fill never brings back a session a coach has since edited.

ALTER TABLE academy_workout_library ADD COLUMN IF NOT EXISTS kind_confirmed BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE academy_workout_library ADD COLUMN IF NOT EXISTS import_key TEXT;
