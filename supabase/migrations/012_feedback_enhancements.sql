-- Add category, status, and priority columns to feedback table
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
