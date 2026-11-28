// Task 153: scheduled messages / polls for the native "Edit Alarm"-style composer + the dry-run sender.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextOccurrence, readComposer, repeatLabelHe, toRow, type ComposerItem } from '@/lib/scheduled-composer/model';

const G = '11111111-1111-4111-8111-111111111111';
const base = { titleHe: 'אימון מחר', sendTime: '07:00', repeatDays: [0, 2], audienceType: 'group', audienceId: G };
const item = (o: Partial<ComposerItem> = {}): ComposerItem => {
  const r = readComposer({ ...base, ...o });
  if ('errors' in r) throw new Error(r.errors.join('; '));
  return r.item;
};

describe('readComposer', () => {
  it('defaults: a message, normal importance, push on, enabled; days sorted and unique', () => {
    expect(item({ repeatDays: [2, 0, 2] })).toEqual({
      kind: 'message', titleHe: 'אימון מחר', bodyHe: null, pollOptionsHe: null, audienceType: 'group', audienceId: G,
      sendTime: '07:00', repeatDays: [0, 2], onceDate: null, importance: 'normal', push: true, enabled: true,
    });
  });
  it('reports every problem at once', () => {
    const r = readComposer({ titleHe: '', sendTime: '7:00', repeatDays: [7], audienceType: 'group', importance: 'urgent', push: 'yes' });
    expect('errors' in r && r.errors).toEqual(expect.arrayContaining([
      'titleHe is required', 'sendTime must be HH:MM', 'repeatDays must be days 0 (Sunday) to 6 (Saturday)',
      'audienceId is required for group', 'importance must be normal or high', 'push must be a boolean',
    ]));
  });
  it('a one-off needs a date; a poll needs 2–8 distinct options', () => {
    expect(readComposer({ ...base, repeatDays: [] })).toHaveProperty('errors');
    expect(readComposer({ ...base, repeatDays: [], onceDate: '2026-12-04' })).toHaveProperty('item');
    expect(readComposer({ ...base, kind: 'poll', pollOptionsHe: ['כן'] })).toHaveProperty('errors');
    expect(readComposer({ ...base, kind: 'poll', pollOptionsHe: ['כן', 'כן'] })).toHaveProperty('errors');
    expect((readComposer({ ...base, kind: 'poll', pollOptionsHe: [' כן ', 'לא', ''] }) as { item: ComposerItem }).item.pollOptionsHe).toEqual(['כן', 'לא']);
  });
  it('an edit merges onto the stored item and is validated whole', () => {
    const stored = item();
    expect((readComposer({ enabled: false }, stored) as { item: ComposerItem }).item).toEqual({ ...stored, enabled: false });
    expect(readComposer({ audienceType: 'athlete' }, { ...stored, audienceId: null })).toHaveProperty('errors');
  });
});

describe('nextOccurrence — Israel wall clock', () => {
  it('the next repeat day at the send time', () => {
    // Fri 2026-11-27 10:00 Israel (UTC+2) → Sunday 29.11 07:00 Israel = 05:00Z
    expect(nextOccurrence(item(), Date.parse('2026-11-27T08:00:00Z'))).toBe('2026-11-29T05:00:00.000Z');
  });
  it('later today if the time has not come yet; next week if it is the only day and it has', () => {
    expect(nextOccurrence(item({ repeatDays: [0] }), Date.parse('2026-11-29T04:00:00Z'))).toBe('2026-11-29T05:00:00.000Z');
    expect(nextOccurrence(item({ repeatDays: [0] }), Date.parse('2026-11-29T05:00:00Z'))).toBe('2026-12-06T05:00:00.000Z');
  });
  it('stays 07:00 across the October clock change (summer UTC+3 → winter UTC+2)', () => {
    // Israel 2026: DST ends Sunday 25.10. Friday 23.10 07:00 is 04:00Z; Friday 30.10 07:00 is 05:00Z.
    expect(nextOccurrence(item({ repeatDays: [5] }), Date.parse('2026-10-22T12:00:00Z'))).toBe('2026-10-23T04:00:00.000Z');
    expect(nextOccurrence(item({ repeatDays: [5] }), Date.parse('2026-10-23T04:00:00Z'))).toBe('2026-10-30T05:00:00.000Z');
  });
  it('a one-off: its moment, then nothing; disabled: nothing', () => {
    const once = item({ repeatDays: [], onceDate: '2026-12-04' });
    expect(nextOccurrence(once, Date.parse('2026-12-01T00:00:00Z'))).toBe('2026-12-04T05:00:00.000Z');
    expect(nextOccurrence(once, Date.parse('2026-12-04T05:00:00Z'))).toBeNull();
    expect(nextOccurrence(item({ enabled: false }), 0)).toBeNull();
  });
  it('toRow carries the next run', () => {
    expect(toRow(item(), Date.parse('2026-11-27T08:00:00Z')).next_run_at).toBe('2026-11-29T05:00:00.000Z');
  });
});

describe('repeatLabelHe', () => {
  it.each([[[], 'לא חוזר'], [[0, 1, 2, 3, 4, 5, 6], 'כל יום'], [[4, 0, 1, 2, 3], 'ימי חול'], [[5, 6], 'סוף שבוע'], [[2], 'כל יום ג׳'], [[0, 2, 4], 'א׳ ג׳ ה׳']])('%j → %s', (d, l) => {
    expect(repeatLabelHe(d as number[])).toBe(l);
  });
});

// ── The dry-run sender, on fixture tables ─────────────────────────────────────
type R = { data: unknown; error: unknown; count?: number };
let tables: Record<string, R> = {};
const ops: Array<{ t: string; op: string; arg?: unknown; filters: string[] }> = [];
class Q implements PromiseLike<R> {
  private rec: { t: string; op: string; arg?: unknown; filters: string[] };
  constructor(private t: string) { this.rec = { t, op: 'select', filters: [] }; ops.push(this.rec); }
  select() { return this; } order() { return this; } limit() { return this; } in() { return this; } or() { return this; } maybeSingle() { return this; } single() { return this; }
  eq(c: string, v: unknown) { this.rec.filters.push(`${c}=${v}`); return this; } lte(c: string, v: unknown) { this.rec.filters.push(`${c}<=${v}`); return this; }
  update(arg: unknown) { this.rec.op = 'update'; this.rec.arg = arg; return this; }
  insert(arg: unknown) { this.rec.op = 'insert'; this.rec.arg = arg; return this; }
  upsert(arg: unknown) { this.rec.op = 'upsert'; this.rec.arg = arg; return this; }
  delete() { this.rec.op = 'delete'; return this; }
  then<A = R, B = never>(ok?: ((v: R) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    const key = `${this.t}:${this.rec.op}`;
    return Promise.resolve(tables[key] ?? tables[this.t] ?? { data: [], error: null }).then(ok, bad);
  }
}
const fakeDb = { from: (t: string) => new Q(t) };
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeDb }));
vi.mock('@/lib/cron-pause', () => ({ cronPaused: async () => false }));
const sendPush = vi.fn();
vi.mock('@/lib/push', () => ({ sendPush: (...a: unknown[]) => sendPush(...a), notifyAthlete: (...a: unknown[]) => sendPush(...a), resolveAudience: (...a: unknown[]) => sendPush(...a) }));
const requireStaffCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaffCaller: (r: Request) => requireStaffCaller(r) }));

const due = { id: 'i1', kind: 'message', title_he: 'x', body_he: null, poll_options_he: null, audience_type: 'group', audience_id: G, send_time: '07:00', repeat_days: [0], once_date: null, importance: 'normal', push: true, enabled: true, next_run_at: '2026-11-29T05:00:00.000Z' };

beforeEach(() => {
  ops.length = 0; sendPush.mockReset();
  tables = {
    'scheduled_composer_items:select': { data: [due], error: null },
    'scheduled_composer_items:update': { data: [{ id: 'i1' }], error: null },
    athletes: { data: [{ id: 'a' }, { id: 'b' }], error: null },
    push_subscriptions: { data: null, error: null, count: 3 },
  };
});

describe('dryRunDueComposerItems', () => {
  it('records the due occurrence, moves it a week on, and sends nothing', async () => {
    const { dryRunDueComposerItems } = await import('@/lib/scheduled-composer/server');
    const r = await dryRunDueComposerItems(fakeDb as never, new Date('2026-11-29T05:00:30Z'));
    expect(r).toMatchObject({ due: 1, sent: 0, recorded: [{ id: 'i1', occurrenceAt: due.next_run_at, audience: 2, pushDevices: 3, nextRunAt: '2026-12-06T05:00:00.000Z' }] });
    const claim = ops.find((o) => o.op === 'update')!;
    expect(claim.filters).toEqual(['id=i1', `next_run_at=${due.next_run_at}`]);   // conditional: one tick wins
    expect(ops.find((o) => o.op === 'upsert')?.arg).toMatchObject({ item_id: 'i1', occurrence_at: due.next_run_at, audience_count: 2 });
    expect(sendPush).not.toHaveBeenCalled();
  });
  it('another tick already claimed it: nothing recorded', async () => {
    tables['scheduled_composer_items:update'] = { data: [], error: null };
    const { dryRunDueComposerItems } = await import('@/lib/scheduled-composer/server');
    expect((await dryRunDueComposerItems(fakeDb as never, new Date('2026-11-29T05:00:30Z'))).recorded).toEqual([]);
    expect(ops.some((o) => o.op === 'upsert')).toBe(false);
  });
  it('no table yet (327 not pasted): says so, does nothing', async () => {
    tables['scheduled_composer_items:select'] = { data: null, error: { code: '42P01', message: 'relation "scheduled_composer_items" does not exist' } };
    const { dryRunDueComposerItems } = await import('@/lib/scheduled-composer/server');
    expect(await dryRunDueComposerItems(fakeDb as never)).toMatchObject({ missingTable: true, due: 0 });
  });
  it('the cron needs CRON_SECRET and checks cronPaused first', async () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/cron/scheduled-composer/route.ts'), 'utf8');
    expect(src).toMatch(/async function run\(request: NextRequest\) \{\n\s+if \(await cronPaused\(\)\) return NextResponse\.json\(\{ paused: true \}\);/);
    process.env.CRON_SECRET = 's3';
    const { GET } = await import('@/app/api/cron/scheduled-composer/route');
    expect((await GET(new Request('http://x/api/cron/scheduled-composer') as never)).status).toBe(401);
    expect((await GET(new Request('http://x', { headers: { authorization: 'Bearer s3' } }) as never)).status).toBe(200);
  });
});

describe('/api/admin/scheduled-composer', () => {
  const approver = { denied: null, caller: { athleteId: 'm1', email: 'm@x', role: 'coach', canApprove: true, isStaff: true, isSuperUser: false } };
  const coach = { denied: null, caller: { athleteId: 'c1', email: 'c@x', role: 'coach', canApprove: false, isStaff: true, isSuperUser: false } };
  const post = async (body: unknown) => (await import('@/app/api/admin/scheduled-composer/route')).POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }));

  it('an approver creates one, with its next time and the creator recorded', async () => {
    requireStaffCaller.mockResolvedValue(approver);
    tables['scheduled_composer_items:insert'] = { data: { ...due, id: 'new' }, error: null };
    const res = await post(base);
    expect(res.status).toBe(201);
    const ins = ops.find((o) => o.op === 'insert')!.arg as Record<string, unknown>;
    expect(ins).toMatchObject({ send_time: '07:00', repeat_days: [0, 2], push: true, importance: 'normal', created_by_athlete_id: 'm1' });
    expect(typeof ins.next_run_at).toBe('string');
    expect((await res.json()).item.repeatLabelHe).toBe('כל יום א׳');
  });
  it('a coach may read but not write; bad input is 400; a past one-off is 400', async () => {
    requireStaffCaller.mockResolvedValue(coach);
    expect((await post(base)).status).toBe(403);
    const { GET } = await import('@/app/api/admin/scheduled-composer/route');
    expect((await GET(new Request('http://x'))).status).toBe(200);
    requireStaffCaller.mockResolvedValue(approver);
    expect((await post({ ...base, sendTime: '25:00' })).status).toBe(400);
    expect((await post({ ...base, repeatDays: [], onceDate: '2020-01-01' })).status).toBe(400);
  });
  it('409 without migration 327', async () => {
    requireStaffCaller.mockResolvedValue(approver);
    tables['scheduled_composer_items:insert'] = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.scheduled_composer_items' in the schema cache" } };
    expect((await post(base)).status).toBe(409);
  });
  it('PATCH { enabled: false } is the switch: next time cleared', async () => {
    requireStaffCaller.mockResolvedValue(approver);
    tables['scheduled_composer_items:select'] = { data: due, error: null };
    tables['scheduled_composer_items:update'] = { data: { ...due, enabled: false, next_run_at: null }, error: null };
    const { PATCH } = await import('@/app/api/admin/scheduled-composer/[id]/route');
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ enabled: false }) }), { params: Promise.resolve({ id: G }) });
    expect(res.status).toBe(200);
    expect(ops.find((o) => o.op === 'update')!.arg).toMatchObject({ enabled: false, next_run_at: null });
  });
});

describe('migration 327', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/327_scheduled_composer.sql'), 'utf8');
  it('is idempotent and is its own table, not scheduled_notifications (which the real sender reads)', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS scheduled_composer_items/);
    expect(sql).toMatch(/UNIQUE \(item_id, occurrence_at\)/);
    expect(sql).not.toMatch(/ALTER TABLE scheduled_notifications/);
  });
});
