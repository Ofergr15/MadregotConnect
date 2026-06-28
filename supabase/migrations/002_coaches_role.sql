-- Add role column to coaches table to distinguish admin from coach
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'coach';

-- Set the main coach as admin
UPDATE coaches SET role = 'admin' WHERE id = 'a34a0d10-1a1c-4b80-a1ca-e0044aa06232';
