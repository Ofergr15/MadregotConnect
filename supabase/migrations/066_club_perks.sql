-- Roadmap #5, Benefits / Discounts. A simple sponsor-perk list — no cart, no
-- checkout (unlike Store): a member just reads how to redeem (a code, a link,
-- or free-text instructions) and does so directly with the sponsor. Ships
-- with placeholder content (product decision: build now, swap in real
-- sponsor deals later) — same shape as Store's "coming soon" pattern.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS club_perks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sponsor_name TEXT NOT NULL,
  title_he TEXT NOT NULL,
  title_en TEXT NOT NULL,
  description_he TEXT,
  description_en TEXT,
  discount_code TEXT,
  redeem_url TEXT,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES athletes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_club_perks_active ON club_perks (active, sort_order);

ALTER TABLE club_perks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages club perks" ON club_perks;
CREATE POLICY "Service role manages club perks"
  ON club_perks FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Same recipe as store-products/badge-icons: public read, writes only through
-- the service-role admin API route.
INSERT INTO storage.buckets (id, name, public)
VALUES ('perk-images', 'perk-images', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read access for perk images') THEN
    CREATE POLICY "Public read access for perk images"
      ON storage.objects FOR SELECT USING (bucket_id = 'perk-images');
  END IF;
END $$;

-- Two clearly-fake placeholder perks so the page isn't empty on first load —
-- swap/delete via the admin Perks Manager once real sponsor deals exist.
INSERT INTO club_perks (sponsor_name, title_he, title_en, description_he, description_en, discount_code, sort_order) VALUES
  ('Example Sports Co. (placeholder)', '15% הנחה על ציוד ריצה', '15% Off Running Gear',
   'זהו פֵּרְק לדוגמה בלבד — עדכנו אותו בפרטי ספונסר אמיתיים דרך ניהול הטבות בהגדרות.',
   'This is a placeholder perk — replace it with a real sponsor deal via Settings > Perks Manager.',
   'MADREGOT15', 0),
  ('Example Cafe (placeholder)', 'קפה חינם אחרי אימון בוקר', 'Free Coffee After Morning Practice',
   'זהו פֵּרְק לדוגמה בלבד — עדכנו אותו בפרטי ספונסר אמיתיים דרך ניהול הטבות בהגדרות.',
   'This is a placeholder perk — replace it with a real sponsor deal via Settings > Perks Manager.',
   NULL, 1)
ON CONFLICT DO NOTHING;
