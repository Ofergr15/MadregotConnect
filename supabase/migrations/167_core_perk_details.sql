-- 167: "הגרעין שלי" (mockup ~/.cache/madregot/core-perks, Ofer 2026-10-21). Each perk gets
-- a status line the admin keeps current ("הגיפטקארדים סופקו השבוע", "דרופ בקרוב"), where
-- it's redeemed (a map), and how to reach them (WhatsApp / website). No counting.
--   status_he    the one line under the perk
--   status_tone  'now' (green) | 'soon' (blue) | 'tbd' (grey)
--   where_he     a line on where to redeem ("מימוש בחנויות HOKA: מנדרין והדרך")
--   locations    [{ "name": "...", "query": "address or place, for the map" }]
--   whatsapp     international digits, e.g. 972549478223
--   website      https://...
-- Paste as one block; safe to run twice.
ALTER TABLE club_perks ADD COLUMN IF NOT EXISTS status_he TEXT;
ALTER TABLE club_perks ADD COLUMN IF NOT EXISTS status_tone TEXT CHECK (status_tone IN ('now','soon','tbd'));
ALTER TABLE club_perks ADD COLUMN IF NOT EXISTS where_he TEXT;
ALTER TABLE club_perks ADD COLUMN IF NOT EXISTS locations JSONB;
ALTER TABLE club_perks ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE club_perks ADD COLUMN IF NOT EXISTS website TEXT;

-- What Ofer gave for the core perks, 2026-10-21.
UPDATE club_perks SET title_he = 'גיפטקארד נעליים', status_he = 'הגיפטקארדים סופקו השבוע', status_tone = 'now',
  where_he = 'מימוש בחנויות HOKA: מנדרין והדרך',
  locations = '[{"name":"HOKA מנדרין","query":"HOKA מנדרין"},{"name":"HOKA הדרך","query":"HOKA הדרך"}]'
  WHERE sponsor_name = 'HOKA' AND tier = 'core_runner';
UPDATE club_perks SET status_he = 'טיפול אחד בחודש', status_tone = 'now', where_he = 'הסניף ברחוב המקצוע 5',
  whatsapp = '972549478223', locations = '[{"name":"PhysyoutLV · המקצוע 5","query":"רחוב המקצוע 5"}]'
  WHERE sponsor_name = 'PhysyoutLV' AND tier = 'core_runner';
UPDATE club_perks SET status_he = 'מנוי שנתי', status_tone = 'now' WHERE sponsor_name = 'LIFT' AND tier = 'core_runner';
UPDATE club_perks SET title_he = '₪600 לרבעון בתזונת ספורט',
  description_he = '₪200 לחודש, בהזמנה מרוכזת אחת לרבעון — GU, PowerBar, SaltStick.',
  status_he = 'ההזמנה יוצאת בתחילת נובמבר', status_tone = 'soon'
  WHERE sponsor_name = 'Podium' AND tier = 'core_runner';
UPDATE club_perks SET status_he = 'דרופ בקרוב', status_tone = 'soon' WHERE sponsor_name = 'SAYSKY' AND tier = 'core_runner';
UPDATE club_perks SET status_he = 'פרטים בקרוב', status_tone = 'tbd' WHERE sponsor_name = 'וולנס' AND tier = 'core_runner';
NOTIFY pgrst, 'reload schema';
