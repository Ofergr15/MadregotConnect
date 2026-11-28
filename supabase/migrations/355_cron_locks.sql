-- 355_cron_locks.sql — cron overlap lock (task 193). FILE ONLY, not applied.
-- Paste by hand. Idempotent: safe to run twice.
--
-- Why a lease row and not a bare session advisory lock: every Supabase call goes
-- through PostgREST, which runs each request in its own transaction on a pooled
-- connection. A session-level pg_advisory_lock taken in one request would stay on
-- whichever pooled connection served it (never released by us, or released by an
-- unrelated request), and pg_advisory_xact_lock is gone the moment the RPC returns.
-- So the advisory lock serialises the ACQUIRE (two ticks racing in the same instant
-- cannot both see the lease free), and the lease row holds it for the run. The row
-- carries an expiry, so a run the platform kills mid-way frees the lock by itself.
--
-- Until this is applied the app FAILS OPEN (src/lib/cron/lock.ts): the rpc errors
-- with 42883 and the sync runs exactly as it does today.

CREATE TABLE IF NOT EXISTS public.cron_locks (
  name        text        PRIMARY KEY,
  holder      text        NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

-- Service role only: RLS on with no policies.
ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.cron_lock_acquire(p_name text, p_holder text, p_ttl_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 1 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'cron_lock_acquire: ttl % out of range 1..3600', p_ttl_seconds;
  END IF;
  -- Held until this transaction ends: concurrent acquires for the same name queue here.
  PERFORM pg_advisory_xact_lock(hashtext('cron_lock:' || p_name));
  DELETE FROM public.cron_locks WHERE name = p_name AND expires_at <= now();
  INSERT INTO public.cron_locks (name, holder, expires_at)
    VALUES (p_name, p_holder, now() + make_interval(secs => p_ttl_seconds))
    ON CONFLICT (name) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.cron_lock_release(p_name text, p_holder text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  -- Only the holder can release: a run that outlived its lease must not free the
  -- lock a newer run has since taken.
  DELETE FROM public.cron_locks WHERE name = p_name AND holder = p_holder;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_lock_acquire(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_lock_release(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_lock_acquire(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_lock_release(text, text) TO service_role;
