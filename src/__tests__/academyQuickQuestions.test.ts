import { describe, it, expect, vi, beforeEach } from 'vitest';

// The trainee's own "4 questions" (migration plan t5): /api/academy/characterization/self.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const pushes: Array<{ athleteId: string; kind: string }> = [];
let me: string | null = 'shahar';

class Q {
  private f: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'upsert' = 'select';
  private payload: Row | null = null;
  constructor(private t: string) {}
  select() { return this; }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this; }
  upsert(row: Row) { this.op = 'upsert'; this.payload = row; return this; }
  eq(c: string, v: unknown) { this.f.push((r) => (c === 'coach_id' && this.t === 'athletes') || r[c] === v); return this; }
  gte() { return this; }
  lt() { return this; }
  limit() { return this; }
  private run() {
    const t = (db[this.t] ||= []);
    if (this.op === 'insert') { const row = { id: `new-${t.length}`, ...this.payload }; t.push(row); return { data: row, error: null }; }
    if (this.op === 'upsert') {
      const i = t.findIndex((r) => r.candidate_id === this.payload!.candidate_id);
      if (i >= 0) Object.assign(t[i], this.payload); else t.push({ ...this.payload });
      return { data: null, error: null };
    }
    return { data: t.filter((r) => this.f.every((g) => g(r))).map((r) => ({ ...r })), error: null };
  }
  maybeSingle() { const r = this.run(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }); }
  single() { return this.maybeSingle(); }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.run()).then(res, rej); }
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => new Q(t) }) }));
vi.mock('@/lib/constants', async (orig) => ({ ...(await orig<object>()), COACH_ID: 'club' }));
vi.mock('@/lib/push', () => ({ notifyAthlete: async (o: { athleteId: string; kind: string }) => { pushes.push(o); return { subscriptions: 0, delivered: 0 }; } }));
vi.mock('@/lib/academy/trainee-coaches', async (orig) => ({ ...(await orig<object>()), coachIdsOf: async () => ['eldar', 'sahar'] }));
vi.mock('@/lib/auth/self-or-staff', async (orig) => ({
  ...(await orig<object>()),
  resolveVerifiedCaller: async () => ({ denied: null, caller: { athleteId: me, email: 'me@x.co', role: 'runner', roles: ['runner'], isStaff: false, isSuperUser: false } }),
}));

const route = await import('@/app/api/academy/characterization/self/route');
const put = (b: unknown) => route.PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(b) }));
const get = () => route.GET(new Request('http://x'));

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  pushes.length = 0;
  me = 'shahar';
  db.athletes = [
    { id: 'shahar', name: 'Shahar Glazner', is_academy: true, academy_coach_id: 'eldar' },
    { id: 'plain', name: 'Plain', is_academy: false },
  ];
  db.athlete_activities = [{ athlete_id: 'shahar', distance: 160000, start_time: '2026-10-01T06:00:00' }];
});

describe('the four questions, answered by the trainee', () => {
  it('a member who is not in the academy cannot use it', async () => {
    me = 'plain';
    expect((await get()).status).toBe(404);
  });
  it('before answering: not answered, with a weekly-km suggestion from their own runs', async () => {
    const body = await (await get()).json();
    expect(body.answered).toBe(false);
    expect(body.suggestedWeeklyKm).toBe(40);
  });
  it('needs the days and the km', async () => {
    expect((await put({ availableDays: [], weeklyKm: 40 })).status).toBe(400);
    expect((await put({ availableDays: [0, 2], weeklyKm: '' })).status).toBe(400);
  });
  it('writes onto a card that says "existing" when they had none, and tells their coaches', async () => {
    const res = await put({ availableDays: [6, 0, 2, 2, 9], weeklyKm: '47.5', limitations: '  ברך ימין ' });
    expect(res.status).toBe(200);
    const card = db.academy_candidates[0];
    expect(card).toMatchObject({ source: 'existing', athlete_id: 'shahar' });
    expect(db.academy_characterizations[0]).toMatchObject({ candidate_id: card.id, available_days: [0, 2, 6], weekly_km: 47.5, limitations: 'ברך ימין' });
    expect(pushes.map((p) => [p.athleteId, p.kind])).toEqual([['eldar', 'academy_questions_answered'], ['sahar', 'academy_questions_answered']]);
    expect((await (await get()).json()).answered).toBe(true);
  });
  it('uses the card they already have, keeping what the call recorded', async () => {
    db.academy_candidates = [{ id: 'c1', athlete_id: 'shahar', source: 'instagram' }];
    db.academy_characterizations = [{ candidate_id: 'c1', goal_type: 'full', fit: 'yes' }];
    await put({ availableDays: [1], weeklyKm: 30 });
    expect(db.academy_candidates).toHaveLength(1);
    expect(db.academy_characterizations[0]).toMatchObject({ goal_type: 'full', fit: 'yes', available_days: [1], weekly_km: 30 });
  });
});
