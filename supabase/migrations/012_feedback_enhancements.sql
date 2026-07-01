-- Add category, status, priority, admin_notes, sort_order, and image_url columns to feedback table
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS image_url TEXT;
