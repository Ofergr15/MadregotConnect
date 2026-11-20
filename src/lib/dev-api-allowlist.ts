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
  ['GET', '/api/feed/highlight'],        // feed highlight card — requireSession, own runs only
  // Inbox (V6) — self-or-staff via the JWT (mayActFor); seen stamps only the caller's own row.
  ['GET', '/api/notifications/inbox'],
  ['GET', '/api/notifications/unread'],
  ['POST', '/api/notifications/seen'],
  // Valencia tab — reads only. events + forecast are public reads; club updates use their
  // own member gate; surveys/open resolves the caller from the JWT. `:id` = one UUID segment.
  ['GET', '/api/events'],
  ['GET', '/api/events/:id/forecast'],
  ['GET', '/api/club-updates'],
  ['GET', '/api/surveys/open'],
];

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Exact segment match; `:id` matches exactly one UUID segment, nothing else. */
export function pathMatches(template: string, pathname: string): boolean {
  const t = template.split('/');
  const p = pathname.split('/');
  if (t.length !== p.length) return false;
  return t.every((seg, i) => (seg === ':id' ? UUID_SEGMENT.test(p[i]) : seg === p[i]));
}

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
  // Fail closed on the DATABASE as well as the flag: a deployment of the dev branch that is wired to
  // any other Supabase project (production by mistake) opens nothing — every route 404s. The same
  // pin U21 has (lib/u21/env-guard.ts), now for every allowlisted route.
  return env[DEV_API_ALLOWLIST_FLAG] === '1'
    && supabaseRef(env) === DEV_SUPABASE_REF
    && DEV_API_ALLOWLIST.some(([m, p]) => m === method && pathMatches(p, pathname));
}
