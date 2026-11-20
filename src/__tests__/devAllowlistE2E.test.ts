import { describe, expect, it } from 'vitest';
import { DEV_API_ALLOWLIST, isDevApiRequestAllowed } from '@/lib/dev-api-allowlist';

/** The e2e path (owner go-ahead 2026-11-20): sign-in + U21 submit open on the dev surface; nothing else added. */
const ON = { MC_DEV_API_ALLOWLIST: '1' };
describe('dev allowlist for the native e2e path', () => {
  it('is exactly the seven native routes plus POST /api/u21/register', () => {
    expect(DEV_API_ALLOWLIST.map(([m, p]) => `${m} ${p}`)).toEqual([
      'POST /api/auth/email-code', 'GET /api/dashboard/weekly', 'GET /api/feed', 'POST /api/feed/like',
      'GET /api/athletes/me', 'GET /api/athletes/summary', 'GET /api/activities/details', 'POST /api/u21/register',
    ]);
  });
  it('U21 submit and sign-in pass with the flag; the admin list, academy and content routes stay closed', () => {
    expect(isDevApiRequestAllowed('POST', '/api/u21/register', ON)).toBe(true);
    expect(isDevApiRequestAllowed('POST', '/api/auth/email-code', ON)).toBe(true);
    for (const [m, p] of [['GET', '/api/u21/register'], ['GET', '/api/u21/registrations'], ['POST', '/api/academy/register'],
      ['GET', '/api/events'], ['GET', '/api/club-updates'], ['POST', '/api/device/register'], ['PUT', '/api/athletes/me']])
      expect(isDevApiRequestAllowed(m, p, ON), `${m} ${p}`).toBe(false);
    expect(isDevApiRequestAllowed('POST', '/api/u21/register', {})).toBe(false);
  });
});
