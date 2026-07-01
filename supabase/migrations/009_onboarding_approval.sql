-- Add onboarding status tracking and approval system

-- Onboarding status: tracks where user is in the signup flow
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'pending';
-- Values: 'pending', 'google_authed', 'garmin_authed', 'garmin_failed', 'active'

-- Approval: users must be approved by admin before full access
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false;

-- Track when approval happened
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS approved_by TEXT;

-- Track onboarding timestamps
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS google_authed_at TIMESTAMPTZ;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS garmin_authed_at TIMESTAMPTZ;

-- Update existing active athletes to be approved
UPDATE athletes SET approved = true, onboarding_status = 'active' WHERE status = 'active';
