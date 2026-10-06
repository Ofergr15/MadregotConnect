-- Onboarding v2: the public form asks a name and, optionally, a phone, so the
-- entry queue can say who is waiting and the approver can send the join link on
-- WhatsApp straight to them. Kept on the request only, never copied onto
-- athletes (the roster name is Latin-only and /join asks for it).
ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS phone TEXT;
