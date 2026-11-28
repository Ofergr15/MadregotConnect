import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';
import { clockIn, parseSettingsBody, parseZonedIso, validateRaceSettings } from '@/lib/race-live/settings';

// Task 148: admin race settings — start time + race window per event, validated (poll_to ≥ start + 6:30).

const EVENT = uid();
const resolveVerifiedCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: (r: Request) => resolveVerifiedCaller(r) }));
let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db.client }));
const { GET, PUT } = await import('@/app/api/race-live/[eventId]/settings/route');

const as = (role: string, extra: Record<string, unknown> = {}, denied: Response | null = null) =>
  resolveVerifiedCaller.mockResolvedValue({ denied, caller: { athleteId: uid(), isStaff: role !== 'runner', isSuperUser: false, role, email: 'x', ...extra } });
const ctx = { params: Promise.resolve({ eventId: EVENT }) };
const put = (body: unknown) => PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) as any, ctx);
const get = () => GET(new Request('http://x') as any, ctx);

// Valencia: gun 08:15 CET = 07:15Z = 09:15 Israel.
const VALENCIA = { startAt: '2026-12-06T08:15:00+01:00', pollFrom: '2026-12-06T07:45:00+01:00', pollTo: '2026-12-06T14:45:00+01:00' };

function seed(withColumn = true) {
  db = createMemoryDb({
    schema: {
      events: ['id', 'date', 'name'],
      race_live_config: ['event_id', 'source', 'active', 'poll_from', 'poll_to', 'updated_at', ...(withColumn ? ['race_start_at'] : [])],
    },
    unique: { race_live_config: [['event_id']] },
  });
  db.tables.events.push({ id: EVENT, date: '2026-12-06', name: 'Valencia' });
}
beforeEach(() => { seed(); as('admin'); });

describe('PUT /api/race-live/[eventId]/settings', () => {
  it('admin sets Valencia: stored in UTC, echoed in Israel and Spain time', async () => {
    const res = await put(VALENCIA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, startAt: '2026-12-06T07:15:00.000Z', pollTo: '2026-12-06T13:45:00.000Z' });
    expect(body.local.spain).toEqual({ start: '08:15', pollFrom: '07:45', pollTo: '14:45' });
    expect(body.local.israel).toEqual({ start: '09:15', pollFrom: '08:45', pollTo: '15:45' });
    expect(db.tables.race_live_config).toHaveLength(1);
    expect(db.tables.race_live_config[0]).toMatchObject({ race_start_at: '2026-12-06T07:15:00.000Z', poll_from: '2026-12-06T06:45:00.000Z' });
  });

  it('only the three time columns are written — active stays as it was', async () => {
    db.tables.race_live_config.push({ event_id: EVENT, source: 'manual', active: true, poll_from: null, poll_to: null });
    expect((await put(VALENCIA)).status).toBe(200);
    expect(db.tables.race_live_config[0]).toMatchObject({ active: true, source: 'manual' });
  });

  it('poll_to exactly start + 6:30 is accepted; one minute less is 422', async () => {
    expect((await put({ ...VALENCIA, pollTo: '2026-12-06T14:45:00+01:00' })).status).toBe(200);
    const res = await put({ ...VALENCIA, pollTo: '2026-12-06T14:44:00+01:00' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'poll-to-too-soon' });
  });

  it('a partial update is checked against what is stored: moving the start later breaks the window → 422, nothing written', async () => {
    await put(VALENCIA);
    const res = await put({ startAt: '2026-12-06T09:15:00+01:00' });
    expect(res.status).toBe(422);
    expect(db.tables.race_live_config[0].race_start_at).toBe('2026-12-06T07:15:00.000Z');
  });

  it('a partial update that keeps the rules is merged', async () => {
    await put(VALENCIA);
    const res = await put({ pollTo: '2026-12-06T15:30:00+01:00' });
    expect(res.status).toBe(200);
    expect(db.tables.race_live_config[0]).toMatchObject({ poll_to: '2026-12-06T14:30:00.000Z', race_start_at: '2026-12-06T07:15:00.000Z' });
  });

  it.each([
    ['a zoneless time', { ...VALENCIA, startAt: '2026-12-06T08:15' }, 400, 'bad-time'],
    ['a bare clock', { ...VALENCIA, pollFrom: '07:45' }, 400, 'bad-time'],
    ['garbage', { ...VALENCIA, pollTo: 42 }, 400, 'bad-time'],
    ['pollFrom after the gun', { ...VALENCIA, pollFrom: '2026-12-06T08:20:00+01:00' }, 422, 'poll-from-after-start'],
    ['pollFrom the night before', { ...VALENCIA, pollFrom: '2026-12-05T18:00:00+01:00' }, 422, 'poll-from-too-early'],
    ['pollTo two days later', { ...VALENCIA, pollTo: '2026-12-08T08:15:00+01:00' }, 422, 'poll-to-too-late'],
    ['a start on the wrong date', { startAt: '2026-12-13T08:15:00+01:00', pollFrom: '2026-12-13T07:45:00+01:00', pollTo: '2026-12-13T14:45:00+01:00' }, 422, 'start-not-on-event-date'],
  ])('%s → %i %s', async (_n, body, status, error) => {
    const res = await put(body);
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error);
    expect(db.tables.race_live_config).toHaveLength(0);
  });

  it('a first write missing a field says which', async () => {
    const res = await put({ startAt: VALENCIA.startAt });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'missing', field: 'pollFrom' });
  });

  it('empty body → 400; unknown event → 404', async () => {
    expect((await put({})).status).toBe(400);
    db.tables.events.length = 0;
    expect((await put(VALENCIA)).status).toBe(404);
  });

  it.each(['coach', 'academy_coach', 'runner'])('%s → 403, nothing read or written', async (role) => {
    as(role);
    expect((await put(VALENCIA)).status).toBe(403);
    expect((await get()).status).toBe(403);
    expect(db.log).toHaveLength(0);
  });

  it('a super user who is not role admin may set it', async () => {
    as('coach', { isSuperUser: true });
    expect((await put(VALENCIA)).status).toBe(200);
  });

  it('no verified session → the gate refuses before any query', async () => {
    as('admin', {}, new Response('{}', { status: 401 }));
    expect((await put(VALENCIA)).status).toBe(401);
    expect(db.log).toHaveLength(0);
  });

  it('migration 320 not applied → 503 naming it, nothing written', async () => {
    seed(false);
    const res = await put(VALENCIA);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('320');
    expect(db.tables.race_live_config).toHaveLength(0);
  });
});

describe('GET /api/race-live/[eventId]/settings', () => {
  it('nothing set → nulls', async () => {
    const body = await (await get()).json();
    expect(body).toMatchObject({ startAt: null, pollFrom: null, pollTo: null });
    expect(body.local.israel.start).toBeNull();
  });
  it('returns what PUT stored', async () => {
    await put(VALENCIA);
    const body = await (await get()).json();
    expect(body.startAt).toBe('2026-12-06T07:15:00.000Z');
    expect(body.local.spain.start).toBe('08:15');
  });
});

describe('pure rules', () => {
  it('parseZonedIso accepts Z and ±hh:mm, refuses zoneless', () => {
    expect(parseZonedIso('2026-12-06T07:15:00Z')).toBe('2026-12-06T07:15:00.000Z');
    expect(parseZonedIso('2026-12-06T09:15+02:00')).toBe('2026-12-06T07:15:00.000Z');
    expect(parseZonedIso('2026-12-06T07:15:00')).toBeNull();
    expect(parseZonedIso('2026-12-06')).toBeNull();
    expect(parseZonedIso('2026-13-40T07:15:00Z')).toBeNull();
  });
  it('null clears a field (and the merged check then reports it missing)', () => {
    const p = parseSettingsBody({ pollTo: null });
    expect(p).toEqual({ patch: { pollTo: null } });
    expect(validateRaceSettings({ startAt: '2026-12-06T07:15:00Z', pollFrom: '2026-12-06T06:45:00Z', pollTo: null }, null)).toEqual({ error: 'missing', field: 'pollTo' });
  });
  it('the event-date check allows the UTC day before (a morning start east of UTC)', () => {
    // 01:00 in Israel on the 6th is 23:00Z on the 5th.
    expect(validateRaceSettings({ startAt: '2026-12-05T23:00:00Z', pollFrom: '2026-12-05T22:30:00Z', pollTo: '2026-12-06T05:30:00Z' }, '2026-12-06')).toBeNull();
  });
  it('clockIn shows Israel and Spain across both zones\' DST', () => {
    // Summer: Israel +3, Spain +2. Winter: +2 / +1.
    expect(clockIn('2026-06-06T06:15:00Z', 'Asia/Jerusalem')).toBe('09:15');
    expect(clockIn('2026-06-06T06:15:00Z', 'Europe/Madrid')).toBe('08:15');
    expect(clockIn('2026-12-06T07:15:00Z', 'Asia/Jerusalem')).toBe('09:15');
    expect(clockIn('2026-12-06T07:15:00Z', 'Europe/Madrid')).toBe('08:15');
  });
});
