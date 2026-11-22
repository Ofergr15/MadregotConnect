import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

// Native Strava connect completes in the OAuth callback (a redirect to madregot://, no JSON),
// so the "sync started" flag travels as a query param. Parity with the Garmin native routes.
const h = vi.hoisted(() => ({ after: vi.fn(), sync: vi.fn() }));
vi.mock('next/server', async (orig) => ({ ...(await orig<any>()), after: h.after }));
vi.mock('@/app/api/strava/sync-activities/route', () => ({ runStravaSyncRequest: h.sync }));

import { afterStravaConnect } from '@/lib/data-sources/after-connect';

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.clearAllMocks();
  h.sync.mockResolvedValue(new Response('{}'));
  h.after.mockImplementation((fn: () => unknown) => { void fn(); });
});

describe('afterStravaConnect', () => {
  it('starts the athlete’s Strava sync after the response and reports syncStarted', async () => {
    expect(afterStravaConnect('ath-1')).toEqual({ syncStarted: true });
    await flush();
    expect(h.sync).toHaveBeenCalledTimes(1);
    const body = await (h.sync.mock.calls[0][0] as Request).json();
    expect(body).toEqual({ athleteId: 'ath-1' });
  });

  it('a throwing sync is swallowed', async () => {
    h.sync.mockRejectedValue(new Error('boom'));
    expect(afterStravaConnect('ath-1').syncStarted).toBe(true);
    await flush();
  });

  it('reports syncStarted false when it cannot schedule', () => {
    h.after.mockImplementation(() => { throw new Error('no ctx'); });
    expect(afterStravaConnect('ath-1')).toEqual({ syncStarted: false });
  });
});

describe('callback wiring', () => {
  const src = readFileSync('src/app/api/strava/callback/route.ts', 'utf8');
  it('the app link branch starts the sync for the signed-state athlete and flags the redirect', () => {
    expect(src).toMatch(/afterStravaConnect\(linkAthleteId\)/);
    expect(src).toMatch(/result=connected&syncStarted=\$\{syncStarted \? 1 : 0\}/);
  });
  it('the error redirects carry no flag', () => {
    expect(src).not.toMatch(/result=error&syncStarted/);
  });
});
