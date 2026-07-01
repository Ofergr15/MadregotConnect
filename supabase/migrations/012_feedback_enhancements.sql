-- Add category, status, priority, admin_notes, and sort_order columns to feedback table
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS sort_order INTEGER;
