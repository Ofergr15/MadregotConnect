import { describe, expect, it } from 'vitest';
import { DEV_API_ALLOWLIST, isDevApiRequestAllowed } from '@/lib/dev-api-allowlist';

/** The e2e path (owner go-ahead 2026-11-20): sign-in + U21 submit open on the dev surface; nothing else added. */
const ON = { MC_DEV_API_ALLOWLIST: '1' };
describe('dev allowlist for the native e2e path', () => {
  it('is exactly the seven native routes plus POST /api/u21/register', () => {
    expect(DEV_API_ALLOWLIST.map(([m, p]) => `${m} ${p}`)).toEqual([
      'POST /api/auth/email-code', 'GET /api/dashboard/weekly', 'GET /api/feed', 'POST /api/feed/like',
      'GET /api/athletes/me', 'GET /api/athletes/summary', 'GET /api/activities/details', 'POST /api/u21/register',
      'GET /api/notifications/inbox', 'GET /api/notifications/unread', 'POST /api/notifications/seen',
      'GET /api/events', 'GET /api/events/:id', 'GET /api/events/:id/forecast', 'GET /api/club-updates', 'GET /api/club-updates/topics',
      'GET /api/surveys/open', 'GET /api/surveys/:id', 'POST /api/surveys/:id/respond',
    ]);
  });
  it('U21 submit and sign-in pass with the flag; the admin list, academy and content routes stay closed', () => {
    expect(isDevApiRequestAllowed('POST', '/api/u21/register', ON)).toBe(true);
    expect(isDevApiRequestAllowed('POST', '/api/auth/email-code', ON)).toBe(true);
    for (const [m, p] of [['GET', '/api/u21/register'], ['GET', '/api/u21/registrations'], ['POST', '/api/academy/register'],
      ['POST', '/api/device/register'], ['PUT', '/api/athletes/me']])
      expect(isDevApiRequestAllowed(m, p, ON), `${m} ${p}`).toBe(false);
    expect(isDevApiRequestAllowed('POST', '/api/u21/register', {})).toBe(false);
  });
});

describe('path templates', () => {
  const U = '3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  it(':id matches exactly one UUID segment', () => {
    expect(isDevApiRequestAllowed('GET', `/api/events/${U}`, ON)).toBe(true);
    expect(isDevApiRequestAllowed('GET', `/api/events/${U}/forecast`, ON)).toBe(true);
    expect(isDevApiRequestAllowed('POST', `/api/surveys/${U}/respond`, ON)).toBe(true);
    for (const p of ['/api/events/not-a-uuid', `/api/events/${U}/registrations`, `/api/events/${U}/register`, `/api/events/${U}/x/forecast`, '/api/events//forecast'])
      expect(isDevApiRequestAllowed('GET', p, ON), p).toBe(false);
    expect(isDevApiRequestAllowed('POST', '/api/events', ON)).toBe(false);
    expect(isDevApiRequestAllowed('PATCH', `/api/events/${U}`, ON)).toBe(false);
    expect(isDevApiRequestAllowed('POST', '/api/club-updates', ON)).toBe(false);
    expect(isDevApiRequestAllowed('GET', '/api/notifications/approvals', ON)).toBe(false);
  });
});
