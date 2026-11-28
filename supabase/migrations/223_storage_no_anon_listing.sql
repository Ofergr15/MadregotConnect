-- 223_storage_no_anon_listing.sql — PROPOSED by docs/migrations-audit.md (finding A1). NOT applied.
-- Paste by hand in the Supabase SQL editor after the owner approves. Idempotent.
--
-- Every public bucket below still has the original "public read" SELECT policy on
-- storage.objects with no role restriction. A public bucket serves its files by URL
-- WITHOUT any SELECT policy (that is what `public = true` means), so these policies add
-- only one thing: anyone holding the anon key (it ships in the web bundle) can LIST the
-- bucket through the storage API and enumerate every object — including face-crops,
-- which are biometric crops of members' faces, and program-plans (coach PDFs).
--
-- The app never lists these buckets with the anon key (the only .list() is run-chat,
-- server-side, service role, which bypasses RLS). getPublicUrl() links keep working.
--
-- Rollback: re-run the CREATE POLICY statements from 016/028/044/047/059/064/066/076/184.

DROP POLICY IF EXISTS "Public read access for program plans" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for avatars" ON storage.objects;
DROP POLICY IF EXISTS "face-crops: public read" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for feed media" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for store product images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for badge icons" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for perk images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for notification images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for event images" ON storage.objects;

-- VERIFY (expect 0 rows):
--   SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
--    AND cmd = 'SELECT' AND roles @> ARRAY['public']::name[];
