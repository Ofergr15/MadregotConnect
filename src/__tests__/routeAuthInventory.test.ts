import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, relative, sep } from 'path';

/**
 * Holds docs/route-auth-inventory.md and the code together: every route under
 * app/api either gates on a verified identity (Supabase JWT through
 * lib/auth/self-or-staff.ts or a wrapper over it, CRON_SECRET, a device token, a
 * signed URL) or is on the public allowlist below with a reason in the doc.
 *
 * A new route that copy-pastes an unauthenticated body fails here until someone
 * either gates it or decides, in review, that it is public.
 */

const API = fileURLToPath(new URL('../app/api', import.meta.url));
const DOC = fileURLToPath(new URL('../../docs/route-auth-inventory.md', import.meta.url));

// route (relative to app/api) -> kind. Reasons live in the doc.
const PUBLIC_ROUTES = new Map<string, string>([
  ['version', 'public'],
  ['ping', 'public'],
  ['config', 'public'],
  ['badges', 'public'],
  ['client-log', 'public'],
  ['push/receipt', 'endpoint-as-credential'],
  ['garmin/sso-callback', 'oauth-callback'],
  ['garmin/sso-callback/app', 'oauth-callback'],
  ['public/signup', 'public-form'],
  ['public/signup/status', 'public-form'],
  ['public/manifest', 'public'],
  ['public/groups', 'public'],
  ['public/qr', 'public'],
  ['public/current-plan', 'public'],
  ['public/stats', 'public'],
  ['academy/register', 'public-form'],
  ['auth/claim-login', 'login'],
  ['auth/athlete-login', 'login'],
  ['auth/sign-out', 'login'],
  ['auth/claim-member/confirm', 'login'],
  ['features/public', 'public'],
  ['join/groups', 'token-scoped'],
  ['join/phone-link', 'token-scoped'],
  ['release/approved', 'public'],
  ['store/products', 'public'],
  ['dev/auth-log', 'dev-only'],
  ['dev/strava-athletes', 'dev-only'],
  ['device/token', 'device-pairing'],
  ['native/auth/refresh', 'login'],
  ['events/[id]/forecast', 'public'],
  ['photos/browse/img', 'signed-url'],
  ['photos/browse/video', 'signed-url'],
  ['auth/email-code', 'login'],
  ['auth/silent-session', 'login'],
  ['admin/login', 'login'],
  ['u21/register', 'public-form'],
]);

// Any of these in the source means the route resolves identity server-side.
const GATED = /\bdenied\b|CRON_SECRET|requireDevice|requireAthlete|requireSession|resolveVerifiedCaller|verifyRequest|loadPain|WEBHOOK_SECRET|Gate\(|authError/;

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return routes(p);
    return e.name === 'route.ts' ? [relative(API, dir).split(sep).join('/')] : [];
  });
}

describe('route auth inventory', () => {
  const all = routes(API);

  it('the gate pattern recognises a gated route and not a bare one', () => {
    expect('const { denied, caller } = await resolveVerifiedCaller(request);').toMatch(GATED);
    expect("const { email } = await request.json(); db.from('athletes').eq('email', email)").not.toMatch(GATED);
  });

  it('every route is gated or explicitly public', () => {
    const ungated = all.filter(
      (r) => !PUBLIC_ROUTES.has(r) && !GATED.test(readFileSync(join(API, r, 'route.ts'), 'utf8')),
    );
    expect(ungated).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    const known = new Set(all);
    expect([...PUBLIC_ROUTES.keys()].filter((r) => !known.has(r))).toEqual([]);
  });

  it('every allowlisted route is documented in docs/route-auth-inventory.md', () => {
    const doc = readFileSync(DOC, 'utf8');
    expect([...PUBLIC_ROUTES.keys()].filter((r) => !doc.includes('`/api/' + r + '`'))).toEqual([]);
  });

  it('no route reads caller identity from a body/query email field without a gate', () => {
    const TRUSTS = /(searchParams\.get\(\s*['"](coach_id|approverEmail|requesterEmail|callerEmail)['"])|body\.(approverEmail|requesterEmail|callerEmail)\b/;
    const offenders = all.filter((r) => {
      const s = readFileSync(join(API, r, 'route.ts'), 'utf8');
      return TRUSTS.test(s) && !GATED.test(s);
    });
    expect(offenders).toEqual([]);
  });
});
