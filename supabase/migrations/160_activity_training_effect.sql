-- Garmin's Training Effect for each run, saved at sync (Ofer 2026-10-20, the run page's
-- "תוכנית מול ביצוע"): { aerobic, anaerobic, label, load } off the activity list item.
-- Nullable; until this is applied the sync drops the column and the run page shows no card.
alter table athlete_activities add column if not exists training_effect jsonb;
