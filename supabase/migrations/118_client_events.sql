-- 118 — client_events: the browser's own account of what went wrong.
--
-- WHY THERE HAS TO BE A TABLE AT ALL:
--
--   Five of the eleven detectors in lib/bugs/detectors.ts could not be written,
--   because nothing on the server knows what happened in the browser. A chunk
--   that 404s after a deploy, a page that renders empty, a form somebody filled
--   in and lost, a phone that keeps opening an old build — every one of those is
--   invisible from here, and the athlete's version of the report is "it didn't
--   work". This is the smallest table that makes those five answerable, and it
--   was written AFTER the first five detectors had run for a while, which is why
--   it has app_version on it and not the half-dozen fields the design guessed at.
--
-- WHY THESE COLUMNS AND NO OTHERS:
--
--   kind        One of five, each one existing because a detector reads it:
--               error → client_error, api_error → server_error, blank →
--               blank_screen, form_abandon → dropped_form, boot → stuck_version.
--               A kind nothing detects is data collected for its own sake.
--
--   route       The path, with the query string REMOVED before it is ever sent.
--               A query string is the one part of a URL that carries tokens and
--               invite ids, and /join/x?token=… on a bug board is a credential on
--               a bug board. The path's own ids are kept: that is how you find
--               out a page only breaks for one person.
--
--   message     An error string, truncated. No form VALUES are ever recorded —
--               form_abandon says that a form was abandoned, not what was in it.
--               Anything else and the bug board quietly accumulates the club's
--               private data.
--
--   app_version The CLIENT's version, the only field taken from the browser.
--               stuck_version exists precisely because the client is on an older
--               build than the server, so stamping the server's version here
--               would erase the only signal there is. Shape-checked on the way in.
--
--   athlete_id  From the SESSION, never from the body. The client cannot report
--               an event as somebody else. ON DELETE SET NULL, because removing a
--               member must not fail on a debugging table, and a finding whose
--               athletes have left still describes something real.
--
-- WHAT IS NOT HERE: no user agent, no screen size, no stack trace. Each of those
-- is a thing somebody would have to justify keeping about 25 named people, and
-- none of the five detectors needs one to name who was affected.
--
-- RETENTION: rows are written by athletes and read only by the nightly pass over
-- the last seven days. Anything older is dead weight on a debugging table, so the
-- delete below is part of the migration rather than a promise to add it later.
-- Re-running this file is safe and is how the sweep gets re-applied by hand.
--
-- Purely additive, and every reader degrades when it is missing: until this is
-- applied the five detectors report "not checked" rather than "found nothing",
-- and the reporter's POST fails silently without the app noticing.
--
-- Run in the Supabase SQL editor, as one block.

CREATE TABLE IF NOT EXISTS client_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES athletes(id) ON DELETE SET NULL,
  kind text NOT NULL,
  route text,
  message text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_events_created_idx ON client_events(created_at DESC);
CREATE INDEX IF NOT EXISTS client_events_kind_created_idx ON client_events(kind, created_at DESC);

DELETE FROM client_events WHERE created_at < now() - interval '30 days';

COMMENT ON TABLE client_events IS
  'What the browser reports about its own failures. Read only by the nightly detector pass; five of the eleven detectors have no other source.';
COMMENT ON COLUMN client_events.kind IS
  'error, api_error, blank, form_abandon or boot. Each one exists because a detector reads it.';
COMMENT ON COLUMN client_events.route IS
  'The path, with the query string stripped client-side before sending — a query string carries tokens and invite ids.';
COMMENT ON COLUMN client_events.message IS
  'An error string, truncated. Never a form value: form_abandon records that a form was abandoned, not its contents.';
COMMENT ON COLUMN client_events.app_version IS
  'The CLIENT build. The only field taken from the browser, because stuck_version is the question of whether it differs from the server.';
COMMENT ON COLUMN client_events.athlete_id IS
  'From the session, never from the request body.';
