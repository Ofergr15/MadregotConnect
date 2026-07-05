-- Create storage bucket for program plan PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('program-plans', 'program-plans', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public read access for program plans"
ON storage.objects FOR SELECT
USING (bucket_id = 'program-plans');

-- Allow authenticated uploads (admin only in practice via API)
CREATE POLICY "Service role upload for program plans"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'program-plans');

CREATE POLICY "Service role update for program plans"
ON storage.objects FOR UPDATE
USING (bucket_id = 'program-plans');
