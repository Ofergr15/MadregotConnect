-- Weekly rollover (PRD): mark past program weeks archived so only the current
-- week shows as active. Rows are already keyed by week_start_date (one per week),
-- so this is an explicit flag for clarity/history rather than deletion — nothing
-- is ever removed. The Saturday 20:00 rollover sets archived=true on weeks whose
-- week_start_date is before the new current week.
ALTER TABLE program_weeks ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
