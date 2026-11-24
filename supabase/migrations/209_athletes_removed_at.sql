-- 209: when a member left the club, for "מדרגות במספרים" monthly joined / left / retention
-- (GET /api/admin/club-numbers?window=…). Set by softRemove (lib/admin/purge-athlete).
-- Idempotent; safe to paste twice. Until it is applied the route falls back to status only.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

-- Rows already removed get a best-effort date so they count as left rather than as members.
UPDATE athletes SET removed_at = COALESCE(last_seen_at, created_at)
 WHERE status = 'removed' AND removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_athletes_removed_at ON athletes (removed_at) WHERE removed_at IS NOT NULL;
