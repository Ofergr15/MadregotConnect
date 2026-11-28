/**
 * Seeded race-day answers for the race-live Playwright smoke (round 6, task 174). One race,
 * five runners, one in each state the viewer can draw (lib/race-live/viewer.ts):
 *
 *   finished       — chip finish time
 *   fresh GPS      — a position 40 s old
 *   stale GPS      — a position 6 min old → "לא מעודכן (לפני 6 דק׳)"
 *   last split     — no GPS, last official split at 25K
 *   not started    — nothing yet
 *
 * Every time is relative to SEED_NOW, which the spec pins as the page clock. Nothing here
 * reaches a database: the browser's requests are fulfilled in the test.
 */
export const SEED_NOW = new Date('2026-12-06T09:30:00Z'); // race morning, 10:30 in Valencia
export const ME_ID = '00000000-0000-4000-8000-0000000000b1';
export const EVENT_ID = '00000000-0000-4000-8000-00000000e001';
const FIXTURE_REF = 'race-fixture';
export const FIXTURE_SUPABASE_URL = `https://${FIXTURE_REF}.supabase.co`;

const ago = (sec: number) => new Date(SEED_NOW.getTime() - sec * 1000).toISOString();
const runner = (n: number, name: string, rest: Record<string, unknown>) => ({
  athleteId: n === 1 ? ME_ID : `00000000-0000-4000-8000-0000000000c${n}`,
  name, avatarUrl: null, bib: String(20_000 + n), isSelf: n === 1,
  state: 'running', splits: [], lastPoint: null, lastSec: null, predictedSec: null, position: null,
  ...rest,
});

export const RUNNERS = [
  runner(1, 'Noa Levin', { state: 'finished', lastPoint: 'finish', lastSec: 3 * 3600 + 12 * 60 + 5, splits: [{ point: 'start', elapsedSec: 0 }, { point: 'finish', elapsedSec: 11525 }] }),
  runner(2, 'Itai Golan', { position: { distanceM: 23_400, elapsedSec: 6730, at: ago(40) }, lastPoint: '20k', lastSec: 5760, predictedSec: 12_100 }),
  runner(3, 'Dana Peretz', { position: { distanceM: 18_100, elapsedSec: 6200, at: ago(6 * 60) }, lastPoint: '15k', lastSec: 5100, predictedSec: 14_300 }),
  runner(4, 'Yarden Avni', { lastPoint: '25k', lastSec: 7293, predictedSec: 12_600 }),
  runner(5, 'Omer Barak', { state: 'not_started' }),
];

export const EVENT = {
  id: EVENT_ID, kind: 'race', name: 'Seed City Marathon', description: null, date: '2026-12-06', end_date: null,
  start_time: '08:15', location: 'Valencia', lat: 39.4561, lng: -0.3545, waze_url: null, distances: ['42.2'],
  race_class: null, website: null, agenda: null, gear: null, faqs: null, capacity: null, status: 'published',
};

export const ME = {
  role: 'runner', roles: ['runner'], membership: 'active', isAcademy: false, academyOnly: false,
  isSuper: false, canApprove: false, isCoreRunner: false, qualitySession: false, isClubManager: false, contentLevels: {},
};

/** A session the Supabase client accepts offline (it only decodes the JWT, never verifies it). */
export function seededSession(): { key: string; value: string } {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.parse('2030-01-01T00:00:00Z') / 1000);
  const email = 'runner1@example.test';
  const user = { id: ME_ID, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2025-01-01T00:00:00Z' };
  const access_token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: `${FIXTURE_SUPABASE_URL}/auth/v1`, sub: ME_ID, aud: 'authenticated', role: 'authenticated', email, exp })}.fake`;
  return { key: `sb-${FIXTURE_REF}-auth-token`, value: JSON.stringify({ access_token, refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user }) };
}
