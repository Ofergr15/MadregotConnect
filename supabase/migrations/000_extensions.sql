-- Required by early migrations that use uuid_generate_v4() / gen_random_uuid().
-- On Supabase, extensions live in the `extensions` schema; expose a public wrapper
-- so unqualified uuid_generate_v4() works during db push.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.uuid_generate_v4()
RETURNS uuid
LANGUAGE sql
VOLATILE
AS $$ SELECT extensions.uuid_generate_v4(); $$;
