-- Add role column to athletes table for permission levels
-- Roles: admin, coach, runner, viewer (all stay in athletes table)
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'runner';

-- Migrate existing coaches back to athletes table (if they have an email not already in athletes)
INSERT INTO athletes (coach_id, name, email, status, role)
SELECT
  'a34a0d10-1a1c-4b80-a1ca-e0044aa06232',
  c.name,
  c.email,
  'active',
  c.role
FROM coaches c
WHERE c.email NOT IN (SELECT email FROM athletes WHERE email IS NOT NULL)
  AND c.id != 'a34a0d10-1a1c-4b80-a1ca-e0044aa06232'
ON CONFLICT DO NOTHING;

-- For the head coach, ensure they're in athletes as admin too
INSERT INTO athletes (coach_id, name, email, status, role)
SELECT
  'a34a0d10-1a1c-4b80-a1ca-e0044aa06232',
  c.name,
  c.email,
  'active',
  'admin'
FROM coaches c
WHERE c.id = 'a34a0d10-1a1c-4b80-a1ca-e0044aa06232'
  AND c.email NOT IN (SELECT email FROM athletes WHERE email IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Update role for athletes that already existed but were coaches
UPDATE athletes
SET role = c.role
FROM coaches c
WHERE athletes.email = c.email AND athletes.role = 'runner';
