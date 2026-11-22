import { describe, expect, it } from 'vitest';
import { DEV_API_ALLOWLIST, DEV_SUPABASE_REF, isDevApiRequestAllowed } from '@/lib/dev-api-allowlist';

/**
 * The U21 e2e path on main's dev allowlist (pattern list, `*` = one segment; see devApiAllowlist.test.ts
 * for the list as a whole): sign-in + the U21 submit are open; U21's admin reads and registration stay closed.
 */
const ON = { MC_DEV_API_ALLOWLIST: '1', NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_SUPABASE_REF}.supabase.co` };
describe('dev allowlist for the native e2e path', () => {
  it('includes POST /api/u21/register and the event forecast, once each', () => {
    const keys = DEV_API_ALLOWLIST.map(([m, p]) => `${m} ${p}`);
    expect(keys.filter((k) => k === 'POST /api/u21/register')).toHaveLength(1);
    expect(keys.filter((k) => k === 'GET /api/events/*/forecast')).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('U21 submit and sign-in pass with the flag; U21 admin reads and registration stay closed', () => {
    expect(isDevApiRequestAllowed('POST', '/api/u21/register', ON)).toBe(true);
    expect(isDevApiRequestAllowed('POST', '/api/auth/email-code', ON)).toBe(true);
    for (const [m, p] of [['GET', '/api/u21/register'], ['GET', '/api/u21/registrations'], ['POST', '/api/public/signup'], ['GET', '/api/public/groups']])
      expect(isDevApiRequestAllowed(m, p, ON), `${m} ${p}`).toBe(false);
    expect(isDevApiRequestAllowed('POST', '/api/u21/register', {})).toBe(false);
  });
});

describe('path patterns', () => {
  const U = '3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  it('* matches exactly one non-empty segment', () => {
    expect(isDevApiRequestAllowed('GET', `/api/events/${U}/forecast`, ON)).toBe(true);
    for (const p of [`/api/events/${U}/x/forecast`, '/api/events//forecast'])
      expect(isDevApiRequestAllowed('GET', p, ON), p).toBe(false);
    expect(isDevApiRequestAllowed('POST', `/api/events/${U}/forecast`, ON)).toBe(false); // method-exact
  });
});
