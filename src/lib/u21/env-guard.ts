/**
 * Fail-closed runtime isolation for the protected U21 preview.
 *
 * The U21 routes write minors' details with the service-role key, so before they
 * touch anything they check that the server is wired to the ONE approved dev
 * Supabase project — pinned, not merely self-consistent: a URL and keys that all
 * agree on some other project (e.g. production) are refused just the same.
 *
 * Keys are decoded, never verified (that is Supabase's job) and never logged or
 * returned; neither is the project ref. A failure reports only which check failed.
 */

export const U21_ALLOWED_PROJECT_REF = 'rtcgklespcwvxashhamh';

export type U21EnvCheck = 'url' | 'service_key' | 'anon_key';
export type U21EnvResult = { ok: true } | { ok: false; check: U21EnvCheck };

type Env = Record<string, string | undefined>;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const CLOUD_HOST = /^([a-z0-9]{20})\.supabase\.co$/;

function jwtClaims(token: string | undefined): { role?: unknown; ref?: unknown } | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => !p)) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

/** ref === null means a loopback (local Supabase) URL: its keys carry no project ref. */
function keyMatches(token: string | undefined, role: string, ref: string | null): boolean {
  const c = jwtClaims(token);
  if (!c || c.role !== role) return false;
  return ref === null || c.ref === ref;
}

export function checkU21ServerEnv(env: Env = process.env, allowedRef: string = U21_ALLOWED_PROJECT_REF): U21EnvResult {
  let url: URL;
  try {
    url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  } catch {
    return { ok: false, check: 'url' };
  }

  let ref: string | null;
  if (LOOPBACK.has(url.hostname)) {
    // A local Supabase is fine on a developer machine and never on Vercel.
    if (env.VERCEL) return { ok: false, check: 'url' };
    ref = null;
  } else {
    const m = url.protocol === 'https:' ? CLOUD_HOST.exec(url.hostname) : null;
    if (!m || m[1] !== allowedRef || url.port !== '') return { ok: false, check: 'url' };
    ref = m[1];
  }

  if (!keyMatches(env.SUPABASE_SERVICE_ROLE_KEY, 'service_role', ref)) return { ok: false, check: 'service_key' };
  if (!keyMatches(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'anon', ref)) return { ok: false, check: 'anon_key' };
  return { ok: true };
}

/** First step of every U21 route: a 503 with a generic body when the env is not the approved one. */
export function assertU21ServerEnv(): { denied: Response | null } {
  const r = checkU21ServerEnv();
  if (r.ok) return { denied: null };
  console.error('u21 env guard: refused', r.check);
  return { denied: Response.json({ error: 'Service unavailable' }, { status: 503 }) };
}
