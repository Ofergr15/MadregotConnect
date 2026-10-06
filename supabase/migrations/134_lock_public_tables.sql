DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;
DROP POLICY IF EXISTS "Service role upload for program plans" ON storage.objects;
DROP POLICY IF EXISTS "Service role update for program plans" ON storage.objects;
DROP POLICY IF EXISTS "Service role upload for avatars" ON storage.objects;
DROP POLICY IF EXISTS "Service role update for avatars" ON storage.objects;
DROP POLICY IF EXISTS "reference-faces: service all" ON storage.objects;
DROP POLICY IF EXISTS "face-crops: service write" ON storage.objects;
DROP POLICY IF EXISTS "face-crops: service delete" ON storage.objects;
