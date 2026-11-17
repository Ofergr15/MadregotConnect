-- 177: a podium product can be "temporarily unavailable" (shown greyed, not orderable),
-- separate from `hidden`, which takes it off the runners' list altogether.
ALTER TABLE podium_products ADD COLUMN IF NOT EXISTS unavailable boolean NOT NULL DEFAULT false;

-- Nov 2026: Podium can't supply Powerbar this round.
UPDATE podium_products SET unavailable = true WHERE name ILIKE '%powerbar%';
