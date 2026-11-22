import { DEV_SUPABASE_REF, supabaseRef } from '@/lib/dev-api-allowlist';

type Env = Record<string, string | undefined>;

/**
 * BUILD-BRIEF gap 1 — the TestFlight blocker. Dev has no email provider, so a build
 * pointed at dev can never receive a sign-in code. This is the "test values only"
 * escape: a FIXED code, for SEEDED test addresses, on the DEV project only.
 *
 * All four must hold, and none of them is the flag alone:
 *   • not a production deployment (VERCEL_ENV !== 'production')
 *   • the database is the dev Supabase project (by ref — an env var can't fake prod into it)
 *   • DEV_FIXED_LOGIN_CODE is exactly six digits
 *   • the address is listed in DEV_FIXED_LOGIN_EMAILS
 *
 * Everything else about the code is unchanged: it is still hashed, still expires,
 * still burns after 5 tries, still limited to 3 sends per 15 minutes.
 */
export function devFixedCodeFor(email: string, env: Env = process.env): string | null {
  if (env.VERCEL_ENV === 'production') return null;
  if (supabaseRef(env) !== DEV_SUPABASE_REF) return null;
  const code = env.DEV_FIXED_LOGIN_CODE?.trim() ?? '';
  if (!/^\d{6}$/.test(code)) return null;
  const allowed = (env.DEV_FIXED_LOGIN_EMAILS || '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase()) ? code : null;
}
