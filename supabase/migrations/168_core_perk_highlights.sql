-- 168: the perk sheet in "הגרעין שלי" v2 (mockup ~/.cache/madregot/core-perks-v2, Ofer 10-21):
--   highlights  the big numbers ("3 זוגות תחרות") — [{ "n": "3", "label": "זוגות תחרות" }]
--   how_he      "איך זה עובד" — one step per line
-- Paste as one block; safe to run twice.
ALTER TABLE club_perks ADD COLUMN IF NOT EXISTS highlights JSONB;
ALTER TABLE club_perks ADD COLUMN IF NOT EXISTS how_he TEXT;

UPDATE club_perks SET
  highlights = jsonb_build_array(
    jsonb_build_object('n', '3', 'label', 'זוגות תחרות'),
    jsonb_build_object('n', '6', 'label', 'זוגות אימון'),
    jsonb_build_object('n', '2', 'label', 'התאוששות')),
  how_he = E'מגיעים לאחת החנויות עם הגיפטקארד\nבוחרים נעליים מהמכסה של השנה\nכל אחד מחליט איך לחלק'
WHERE sponsor_name = 'HOKA' AND tier = 'core_runner';

UPDATE club_perks SET
  how_he = E'שולחים הודעה בוואטסאפ לסניף\nאומרים שאתם מהגרעין של מדרגות'
WHERE sponsor_name = 'PhysyoutLV' AND tier = 'core_runner';

UPDATE club_perks SET
  highlights = jsonb_build_array(
    jsonb_build_object('n', '₪200', 'label', 'לחודש'),
    jsonb_build_object('n', '₪600', 'label', 'בהזמנה לרבעון'))
WHERE sponsor_name = 'Podium' AND tier = 'core_runner';

-- Short titles for the cards, and Wellness until 30.11 (Ofer, 10-21).
UPDATE club_perks SET title_he = 'טיפול פיזיו חינם',
  locations = jsonb_build_array(jsonb_build_object('name', 'PhysyoutLV', 'query', 'רחוב המקצוע 5'))
WHERE sponsor_name = 'PhysyoutLV' AND tier = 'core_runner';
UPDATE club_perks SET title_he = 'מנוי לחדר כושר' WHERE sponsor_name = 'LIFT' AND tier = 'core_runner';
UPDATE club_perks SET title_he = 'ביגוד גרעין' WHERE sponsor_name = 'SAYSKY' AND tier = 'core_runner';
UPDATE club_perks SET title_he = 'מתחמי התאוששות', status_he = 'בתוקף עד 30.11', status_tone = 'now'
WHERE sponsor_name = 'וולנס' AND tier = 'core_runner';

NOTIFY pgrst, 'reload schema';
