/**
 * Fail-closed API allowlist for the dev deployment the native iOS app talks to.
 *
 * Most API routes are not authenticated (CLAUDE.md, "Security posture"): 88 of 372 have
 * no gate, 58 of those accept writes. A dev deployment a phone can reach must not expose
 * them, and must not depend on someone remembering to set a flag.
 *
 * So whether a request is on the DEV SURFACE is decided from facts a misconfigured env
 * var cannot erase — the Supabase project the deployment talks to, or the branch it was
 * built from — never from the flag itself:
 *   - VERCEL_ENV=production          → never the dev surface (production is untouched)
 *   - not on Vercel (local next dev) → never the dev surface (untouched)
 *   - otherwise: dev Supabase ref, or the dev branch → dev surface
 * On the dev surface every /api request is 404 unless MC_DEV_API_ALLOWLIST=1 AND the
 * exact method + path is one of the routes the native app calls (each authenticates the
 * caller itself, or is sign-in, or is the env-guarded public U21 submit). Flag unset there → everything 404s.
 *
 * Not an auth boundary on its own; exposing that deployment is a separate decision.
 */

export const DEV_API_ALLOWLIST_FLAG = 'MC_DEV_API_ALLOWLIST';
/** Same pin as lib/u21/env-guard.ts: the MadregotConnect-dev Supabase project. */
export const DEV_SUPABASE_REF = 'rtcgklespcwvxashhamh';
export const DEV_BRANCH = 'u21-personal-coach';

/** Exact method + path; no prefixes, no trailing-slash variants; query strings ignored. */
export const DEV_API_ALLOWLIST: ReadonlyArray<readonly [string, string]> = [
  ['POST', '/api/auth/email-code'],     // sign-in send + verify — public by design
  ['GET', '/api/dashboard/weekly'],     // weekly plan + Today — requireMember
  ['GET', '/api/feed'],                 // feed — requireSession
  ['POST', '/api/feed/like'],           // claps — requireAthlete
  ['GET', '/api/athletes/me'],          // profile — self-or-staff; PUT stays closed
  ['GET', '/api/athletes/summary'],     // profile stats — self-or-staff
  ['GET', '/api/activities/details'],   // run detail — requireMember, hidden fields masked
  // U21 questionnaire submit (owner go-ahead 2026-11-20, e2e path). Public by design, like the
  // web /u21 form: no auth, its own env guard (pinned to this dev project, 503 elsewhere),
  // per-IP rate limit, honeypot, validated fields, stores pending_review only — no mail, no push.
  ['POST', '/api/u21/register'],
];

type Env = Record<string, string | undefined>;

export function supabaseRef(env: Env = process.env): string | null {
  try {
    return new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

export function isDevSurface(env: Env = process.env): boolean {
  if (env.VERCEL_ENV === 'production') return false; // production: never
  if (!env.VERCEL) return false;                      // local next dev: untouched
  return supabaseRef(env) === DEV_SUPABASE_REF || env.VERCEL_GIT_COMMIT_REF === DEV_BRANCH;
}

/** On the dev surface: may this API request through? (Callers check isDevSurface first.) */
export function isDevApiRequestAllowed(method: string, pathname: string, env: Env = process.env): boolean {
  return env[DEV_API_ALLOWLIST_FLAG] === '1'
    && DEV_API_ALLOWLIST.some(([m, p]) => m === method && p === pathname);
}
