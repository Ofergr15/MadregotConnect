// Night queue #101 — Drive photos v2 (flag photos_drive_v2, default off).
import { describe, it, expect, vi, beforeEach } from 'vitest';

let flagOn = false;
let caller: any = { athleteId: 'staff-1', isStaff: true, isSuperUser: false };
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: async (k: string) => k === 'photos_drive_v2' && flagOn }));
vi.mock('@/lib/auth/self-or-staff', () => ({ resolveVerifiedCaller: async () => ({ denied: null, caller }) }));
vi.mock('@/lib/photos/drive-browse', () => ({
  photosRoot: () => 'root-folder',
  listPhotoFolders: async () => [{ id: 'f1', name: 'שישי 20.11', title: null, date: '2026-11-20', count: 12, videos: 0, covers: [], videoCovers: [] }],
  signedImageUrl: () => 'signed', FULL: 1600, THUMB: 480,
}));
vi.mock('@/lib/photos/mirror', () => ({ mirroredUrls: async () => ({ thumb: {}, full: {}, lqip: {} }) }));

type Row = Record<string, any>;
let tables: Record<string, Row[]>;
function from(table: string) {
  const f: Array<(r: Row) => boolean> = [];
  let upsert: Row | null = null;
  const q: any = {
    select: () => q,
    eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return q; },
    is: (c: string, v: null) => { f.push((r) => (r[c] ?? null) === v); return q; },
    in: (c: string, v: unknown[]) => { f.push((r) => v.includes(r[c])); return q; },
    lte: (c: string, v: string) => { f.push((r) => r[c] <= v); return q; },
    or: () => q, order: () => q,
    upsert: (r: Row) => { upsert = r; return q; },
    then: (ok: any) => {
      if (upsert) { const t = (tables[table] ||= []); const i = t.findIndex((x) => x.key === upsert!.key); if (i >= 0) t[i] = upsert; else t.push(upsert); return ok({ error: null }); }
      return ok({ data: (tables[table] || []).filter((r) => f.every((g) => g(r))), error: null });
    },
  };
  return q;
}
const db: any = { from };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }));
vi.mock('@/lib/constants', async (o) => ({ ...(await o<any>()), COACH_ID: 'coach' }));

const S = await import('@/lib/photos/status');

beforeEach(() => {
  flagOn = false; caller = { athleteId: 'staff-1', isStaff: true, isSuperUser: false };
  tables = {
    app_settings: [{ key: 'photos_mirror', value: 'on' }],
    weekly_plans: [
      { id: 'p-draft', coach_id: 'coach', athlete_id: null, week_start_date: '2026-11-15', status: 'draft', parsed_workouts: { workouts: [{ dayOfWeek: 5, name: 'draft' }] } },
      { id: 'p1', coach_id: 'coach', athlete_id: null, week_start_date: '2026-11-15', status: 'pushed', parsed_workouts: { workouts: [{ dayOfWeek: 5, name: 'שישי ארוך' }] } },
      { id: 'mine', coach_id: 'coach', athlete_id: 'trainee', week_start_date: '2026-11-15', status: 'pushed', parsed_workouts: { workouts: [{ dayOfWeek: 5, name: 'trainee' }] } },
    ],
    events: [
      { id: 'e1', name: 'מרוץ', date: '2026-11-20', end_date: null },
      { id: 'e2', name: 'מחנה', date: '2026-11-19', end_date: '2026-11-21' },
      { id: 'e3', name: 'אחר', date: '2026-11-25', end_date: null },
    ],
  };
});

describe('mirror status', () => {
  it('records a run and reads it back with hours since', async () => {
    await S.recordMirrorRun(db, { at: '2026-11-23T10:00:00Z', ok: true, copied: 40, failed: 1, remaining: 0, warmed: 3 });
    const st = await S.photosStatus(db, Date.parse('2026-11-23T13:00:00Z'));
    expect(st).toMatchObject({ sourceConfigured: true, mirror: { on: true, hoursSince: 3, lastRun: { ok: true, copied: 40, failed: 1 } } });
  });
  it('never ran → null; garbage → null', async () => {
    expect((await S.photosStatus(db)).mirror.lastRun).toBeNull();
    expect(S.parseMirrorRun('{not json')).toBeNull();
    expect(S.parseMirrorRun(JSON.stringify({ ok: true }))).toBeNull();
  });
});

describe('folderSessions', () => {
  it('ties a folder day to the group plan workout (not a draft, not a trainee week) and that day’s events', async () => {
    const m = await S.folderSessions(db, ['2026-11-20', 'bad-date']);
    expect([...m.keys()]).toEqual(['2026-11-20']);
    expect(m.get('2026-11-20')).toEqual({ workout: { name: 'שישי ארוך', planId: 'p1' }, events: [{ id: 'e1', name: 'מרוץ' }, { id: 'e2', name: 'מחנה' }] });
  });
});

describe('album import dedupe', () => {
  it('stable keys give the same path for the same source; default stays random', async () => {
    const { mediaPath, isAlreadyThere } = await import('@/lib/quality-session/album-fetch');
    expect(mediaPath('u1', 'album:https://x/a')).toBe(mediaPath('u1', 'album:https://x/a'));
    expect(mediaPath('u1', 'album:https://x/a')).not.toBe(mediaPath('u1', 'album:https://x/b'));
    expect(mediaPath('u1', null)).not.toBe(mediaPath('u1', null));
    expect(isAlreadyThere({ statusCode: '409', message: 'x' })).toBe(true);
    expect(isAlreadyThere({ message: 'The resource already exists' })).toBe(true);
    expect(isAlreadyThere({ message: 'payload too large' })).toBe(false);
  });
});

describe('GET /api/admin/photos-status', () => {
  const get = async () => { const { GET } = await import('@/app/api/admin/photos-status/route'); const r = await GET(new Request('http://x')); return { status: r.status, body: await r.json() }; };
  it('flag off → 404', async () => { expect((await get()).status).toBe(404); });
  it('a member → 403', async () => { flagOn = true; caller = { athleteId: 'm', isStaff: false, isSuperUser: false }; expect((await get()).status).toBe(403); });
  it('staff with the flag → status + folders with their session', async () => {
    flagOn = true;
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.mirror.on).toBe(true);
    expect(body.folders[0]).toMatchObject({ id: 'f1', date: '2026-11-20', session: { workout: { name: 'שישי ארוך' } } });
  });
});

describe('GET /api/photos/browse', () => {
  const get = async () => { const { GET } = await import('@/app/api/photos/browse/route'); return (await GET(new Request('http://x'))).json(); };
  it('flag off: folders exactly as before (no session key)', async () => {
    const b = await get();
    expect('session' in b.folders[0]).toBe(false);
  });
  it('flag on: each folder carries its day', async () => {
    flagOn = true;
    const b = await get();
    expect(b.folders[0].session.workout.name).toBe('שישי ארוך');
  });
});
