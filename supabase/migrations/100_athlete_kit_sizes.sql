-- Kit sizes beyond the shirt.
--
-- Migration 061 promoted shirt_size out of the academy_intake JSON so every club
-- member could set it from Settings → Personal info. Ordering anything ELSE still
-- meant asking twenty people one at a time in WhatsApp, so the same treatment for
-- the other three garments the club orders: pants, tights and socks.
--
-- Pants and tights share the shirt's XS–XXL list. Socks are sized off the shoe, in
-- the four EU spans the supplier lists — hence a different CHECK. These values are
-- also declared in src/lib/kit-sizes.ts, and src/__tests__/kitSizes.test.ts reads
-- THIS FILE back and compares the two, because a size the form offers and the CHECK
-- rejects is a save that fails at the database.
--
-- Nullable and no backfill: nobody has answered yet. The app treats null as "not
-- set" everywhere (the Personal info rows read "Not set", and the setup score counts
-- them as the unfinished part of the Sizes task, which is how existing members get
-- asked).
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS pants_size TEXT
  CHECK (pants_size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL'));

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS tights_size TEXT
  CHECK (tights_size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL'));

ALTER TABLE athletes ADD COLUMN IF NOT EXISTS socks_size TEXT
  CHECK (socks_size IN ('35-38', '39-42', '43-46', '47+'));
