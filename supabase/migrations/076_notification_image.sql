-- Lets the admin Notification Center compose an image alongside a broadcast
-- (both the OS push notification's icon/expanded banner and the compose
-- preview) — previously text-only.
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Same recipe as perk-images/store-product-images: public read, writes only
-- through the service-role admin API route.
INSERT INTO storage.buckets (id, name, public)
VALUES ('notification-images', 'notification-images', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read access for notification images') THEN
    CREATE POLICY "Public read access for notification images"
      ON storage.objects FOR SELECT USING (bucket_id = 'notification-images');
  END IF;
END $$;
