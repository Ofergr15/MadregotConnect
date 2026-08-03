-- Notification Center: web-push subscriptions + admin-composed scheduled notifications.

-- One row per device (an athlete may install on multiple devices).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_athlete ON push_subscriptions(athlete_id);

-- Admin-composed notifications: one-time (now / scheduled) or recurring.
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL DEFAULT 'custom',        -- 'custom' | 'training_before' | 'training_after'
  title_he TEXT NOT NULL,
  body_he TEXT NOT NULL,
  title_en TEXT,
  body_en TEXT,
  url TEXT NOT NULL DEFAULT '/dashboard',      -- deep link on click
  audience_type TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'group' | 'athlete'
  audience_id UUID,                            -- group_id or athlete_id (null for 'all')
  schedule_type TEXT NOT NULL DEFAULT 'now',   -- 'now' | 'once_at' | 'recurring'
  scheduled_at TIMESTAMPTZ,                     -- for 'once_at'
  recur_interval INT,                          -- e.g. 2
  recur_unit TEXT,                             -- 'day' | 'week'
  next_run_at TIMESTAMPTZ,                      -- driver column for the scanner
  status TEXT NOT NULL DEFAULT 'scheduled',    -- 'draft' | 'scheduled' | 'sent' | 'cancelled'
  last_sent_at TIMESTAMPTZ,
  sent_count INT NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_due
  ON scheduled_notifications(status, next_run_at);
