import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOnFeed, mayEditDaySession, maySeeDaySession, notifyOnce,
  parsePaceText, parseWorkout, planCoversDay, planLinks, readInput, resolveWorkout, shouldNotify, totalsOf,
} from '@/lib/day-session/model';
import { parseClubText, quickToWorkout, validateWorkoutSteps, MAX_STEPS } from '@/lib/day-session/workout';
import type { QuickStep } from '@/lib/academy/quick-text';
import type { WorkoutStep } from '@/lib/ai/types';
// The route tests below describe the gate with the flag OFF; the flag itself is checked
// from its source, since this mock replaces the module for the whole file.
vi.mock('@/lib/day-session/flag', () => ({ DAY_SESSION_FOR_ALL: false }));

// "אימון ליום אחד" (mockup manual-day-workout): the pure rules, then the route's gate.

describe('the typed workout, through the quick-text parser', () => {
  it('reads the mockup line as 6 × 1 km with warmup and cooldown', () => {
    const { steps, title } = parseWorkout('2 קל, 6x1000 מנוחה 90, 2 קל');
    expect(title).toBe('6 × 1 ק״מ');
    expect(steps.map((s) => s.type)).toEqual(['warmup', 'interval', 'cooldown']);
    const reps = steps[1];
    expect(reps.repeatCount).toBe(6);
    expect(reps.repeatSteps?.map((r) => [r.type, r.durationType, r.durationValue])).toEqual([['interval', 'distance', 1000], ['rest', 'time', 90]]);
    // 2 + 6 + 2 km of running plus the jogs: the "10.5 ק״מ · כ־60 דק׳" line.
    const t = totalsOf(steps);
    expect(t.distanceM).toBeGreaterThanOrEqual(10000);
    expect(t.durationSec).toBeGreaterThan(40 * 60);
  });

  it('nothing understood → no steps and no title', () => {
    expect(parseWorkout('שלום')).toEqual(expect.objectContaining({ steps: [], title: '' }));
  });
});

describe('the club\'s notation: a pace per pack and a range (his message, 2026-10-17)', () => {
  const text = '50 דק׳ 4:40 - 5:15\n15 x\n200 מ׳ 3:15 (3:25) ((3:35))\n100 מ׳ הליכה';
  const { steps, unknown } = parseClubText(text);
  it('understands every word', () => expect(unknown).toEqual([]));
  it('50 minutes at 4:40–5:15, the same for every pack', () => {
    expect(steps[0]).toMatchObject({
      type: 'active', durationType: 'time', durationValue: 3000, targetType: 'pace',
      targetPaceMinPerKm: 280, targetPaceMaxPerKm: 315, group2Pace: { min: 280, max: 315 }, group3Pace: { min: 280, max: 315 },
    });
  });
  it('"15 x" on its own line belongs to the next; ❶ (❷) ((❸)) land on the rep; the walk is the recovery inside', () => {
    const reps = steps[1];
    expect(reps.repeatCount).toBe(15);
    expect(reps.repeatSteps![0]).toMatchObject({
      type: 'interval', durationType: 'distance', durationValue: 200,
      targetPaceMinPerKm: 195, targetPaceMaxPerKm: 195, group2Pace: { min: 205, max: 205 }, group3Pace: { min: 215, max: 215 },
    });
    expect(reps.repeatSteps![1]).toMatchObject({ type: 'rest', durationType: 'distance', durationValue: 100, notes: 'הליכה' });
    expect(steps).toHaveLength(2);
  });
  it('a bare rep followed by a pace is metres; a pack range in brackets is a range', () => {
    const r = parseClubText('3 קל\n6x1000 3:35 (3:50) ((4:05)) מנוחה 90\n2 קל');
    expect(r.unknown).toEqual([]);
    expect(r.steps[1].repeatSteps![0]).toMatchObject({ durationType: 'distance', durationValue: 1000, group2Pace: { min: 230, max: 230 }, group3Pace: { min: 245, max: 245 } });
    const g = parseClubText('8x1000 3:40 (3:45-3:50)').steps[0].repeatSteps![0];
    expect(g.group2Pace).toEqual({ min: 225, max: 230 });
    expect(g.group3Pace).toEqual({ min: 225, max: 230 });
  });
  it('a rep time is not taken for a pace', () => {
    const w = parseClubText('8x400 1:20').steps[0];
    expect(w.targetType).not.toBe('pace');
  });
});

describe('the gate', () => {
  const superUser = { isSuperUser: true, role: 'runner' };
  const coach = { isSuperUser: false, role: 'coach' };
  const admin = { isSuperUser: false, role: 'admin' };
  const member = { isSuperUser: false, role: 'runner' };

  it('ships ON (opened to the club 2026-10-18)', () => expect(readFileSync(join(__dirname, '../lib/day-session/flag.ts'), 'utf8')).toMatch(/DAY_SESSION_FOR_ALL = true;/));

  it('flag off: the super user alone edits and sees', () => {
    expect(mayEditDaySession(superUser, false)).toBe(true);
    expect(mayEditDaySession(coach, false)).toBe(false);
    expect(mayEditDaySession(admin, false)).toBe(false);
    expect(maySeeDaySession(superUser, false)).toBe(true);
    expect(maySeeDaySession(member, false)).toBe(false);
    expect(maySeeDaySession(coach, false)).toBe(false);
  });

  it('flag on: coaches and admins create, every member sees', () => {
    expect(mayEditDaySession(coach, true)).toBe(true);
    expect(mayEditDaySession(admin, true)).toBe(true);
    expect(mayEditDaySession({ isSuperUser: false, role: 'runner', roles: ['runner', 'coach'] }, true)).toBe(true);
    expect(mayEditDaySession(member, true)).toBe(false);
    expect(maySeeDaySession(member, true)).toBe(true);
    expect(mayEditDaySession(null, true)).toBe(false);
  });
});

describe('the input', () => {
  const ok = { date: '2026-10-18', startTime: '19:00', place: ' הירקון ', quickText: '6x1000', nutrition: [{ when: 'before', text: ' בננה ' }, { when: 'lunch', text: 'x' }, { when: 'after', text: '' }] };
  it('cleans the body', () => {
    const r = readInput(ok);
    expect(typeof r).toBe('object');
    if (typeof r === 'string') return;
    expect(r.place).toBe('הירקון');
    expect(r.nutrition).toEqual([{ when: 'before', text: 'בננה' }]);
    expect(r.publish).toBe(true);
    expect(r.notify).toBe(true);
  });
  it('refuses a bad date, a bad hour, no workout', () => {
    expect(readInput({ ...ok, date: '18/10' })).toMatch(/date/);
    expect(readInput({ ...ok, startTime: '25:00' })).toMatch(/startTime/);
    expect(readInput({ ...ok, quickText: ' ' })).toMatch(/quickText/);
  });
  it('reads a typed pace', () => {
    expect(parsePaceText('3:55')).toBe(235);
    expect(parsePaceText('355')).toBe(235);
    expect(parsePaceText('3.5')).toBe(230);
    expect(parsePaceText('3:75')).toBeNull();
    expect(parsePaceText('')).toBeNull();
  });
});

describe('when the card is on the feed', () => {
  const steps = parseWorkout('2 קל, 6x1000 מנוחה 90, 2 קל').steps;
  const s = { date: '2026-10-18', startTime: '19:00', publishedAt: '2026-10-17T10:00:00Z', steps };
  it('from publishing: all of the day before', () => {
    expect(isOnFeed(s, '2026-10-17', '2026-10-18', 8 * 60)).toBe(true);
  });
  it('on the day until after the workout, then gone', () => {
    expect(isOnFeed(s, '2026-10-18', '2026-10-19', 19 * 60 + 30)).toBe(true);
    expect(isOnFeed(s, '2026-10-18', '2026-10-19', 23 * 60)).toBe(false);
  });
  it('not before publishing, not further out', () => {
    expect(isOnFeed({ ...s, publishedAt: null }, '2026-10-17', '2026-10-18', 600)).toBe(false);
    expect(isOnFeed(s, '2026-10-16', '2026-10-17', 600)).toBe(false);
  });
});

describe('the weekly plan wins', () => {
  it('a plan with a run that day hides the day session', () => {
    expect(planCoversDay({ hasPlan: true, sessions: [{ dayOfWeek: 0, kmMax: 12 }] }, 0)).toBe(true);
  });
  it('no plan, a plan without that day, or a rest entry → the day session shows', () => {
    expect(planCoversDay({ hasPlan: false, sessions: [] }, 0)).toBe(false);
    expect(planCoversDay({ hasPlan: true, sessions: [{ dayOfWeek: 2, kmMax: 12 }] }, 0)).toBe(false);
    expect(planCoversDay({ hasPlan: true, sessions: [{ dayOfWeek: 0, kmMax: 0 }] }, 0)).toBe(false);
    expect(planCoversDay(undefined, 0)).toBe(false);
  });
});

describe('the two plan links', () => {
  const W = '2026-10-18';
  it('nothing for the week → both greyed (null)', () => {
    expect(planLinks(W, { hasPlan: false }, [])).toEqual({ weekly: null, nutrition: null });
    expect(planLinks(W, undefined, undefined)).toEqual({ weekly: null, nutrition: null });
  });
  it('another week\'s uploads do not light them', () => {
    expect(planLinks(W, { hasPlan: false }, [{ week_start_date: '2026-10-11', training_pdf_url: 'a', nutrition_pdf_url: 'b' }]))
      .toEqual({ weekly: null, nutrition: null });
  });
  it('a parsed plan and an uploaded nutrition sheet → both live, with the short line', () => {
    const r = planLinks(W, { hasPlan: true, trainingDays: 5, weekTotalMin: 46, weekTotalMax: 50 }, [{ week_start_date: W, training_pdf_url: null, nutrition_pdf_url: 'n.pdf' }]);
    expect(r.weekly).toEqual({ href: `/dashboard/program?week=${W}`, sessions: 5, km: 48 });
    expect(r.nutrition).toEqual({ href: `/dashboard/program?week=${W}&view=nutrition` });
  });
  it('an uploaded training sheet alone lights the weekly link', () => {
    expect(planLinks(W, { hasPlan: false }, [{ week_start_date: W, training_pdf_url: 't.pdf', nutrition_pdf_url: null }]).weekly).not.toBeNull();
  });
});

describe('the push, once', () => {
  const published = { publishedAt: '2026-10-17T10:00:00Z', notify: true, notifiedAt: null };
  it('only when published, switched on and not sent', () => {
    expect(shouldNotify(published)).toBe(true);
    expect(shouldNotify({ ...published, publishedAt: null })).toBe(false);
    expect(shouldNotify({ ...published, notify: false })).toBe(false);
    expect(shouldNotify({ ...published, notifiedAt: '2026-10-17T10:00:01Z' })).toBe(false);
  });
  it('two publishes racing: the claim lets one send', async () => {
    let claimed = false;
    const claim = async () => { if (claimed) return false; claimed = true; return true; };
    const send = vi.fn(async () => 3);
    const [a, b] = await Promise.all([notifyOnce(published, { claim, send }), notifyOnce(published, { claim, send })]);
    expect(send).toHaveBeenCalledTimes(1);
    expect([a.sent, b.sent].sort()).toEqual([false, true]);
  });
  it('a re-publish after it was sent does not even try the claim', async () => {
    const claim = vi.fn(async () => true);
    const send = vi.fn(async () => 1);
    await notifyOnce({ ...published, notifiedAt: 'x' }, { claim, send });
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('migration 150', () => {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/150_day_sessions.sql'), 'utf8');
  it('is RLS-on and service_role only, one row per date', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE day_sessions FROM anon, authenticated/);
    expect(sql).toMatch(/GRANT ALL ON TABLE day_sessions TO service_role/);
    expect(sql).toMatch(/session_date DATE NOT NULL UNIQUE/);
    expect(sql).not.toMatch(/REFERENCES/);
  });
});

// ── The route's gate, on the verified session ─────────────────────────────────────────

const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({
  requireSession: (req: Request) => requireSession(req),
  authError: (r: { status: number; error: string }) => new Response(JSON.stringify({ error: r.error }), { status: r.status }),
}));
const server = {
  readDaySession: vi.fn(),
  readUpcoming: vi.fn(),
  saveDaySession: vi.fn(),
  claimNotify: vi.fn(),
  daySessionRecipients: vi.fn(),
  sendDaySessionPush: vi.fn(),
};
vi.mock('@/lib/day-session/server', () => server);
// The watch route hands the delivery to `after`, which needs a live request outside a test.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (p: unknown) => p }));

const session = (over: Record<string, unknown>) => ({ ok: true, user: { athleteId: 'me', isSuperUser: false, role: 'runner', ...over } });
const put = (body: unknown) => new Request('http://x/api/day-session', { method: 'PUT', body: JSON.stringify(body) });
const BODY = { date: '2026-10-18', startTime: '19:00', place: 'הירקון', quickText: '2 קל, 6x1000 מנוחה 90, 2 קל', nutrition: [{ when: 'before', text: 'בננה' }], publish: true, notify: true };

describe('/api/day-session while the flag is off', () => {
  beforeEach(() => {
    requireSession.mockReset();
    Object.values(server).forEach((f) => f.mockReset());
  });

  it('a coach or a member cannot write or open the form', async () => {
    const { PUT, GET } = await import('@/app/api/day-session/route');
    for (const role of ['coach', 'admin', 'runner']) {
      requireSession.mockResolvedValue(session({ role }));
      expect((await PUT(put(BODY))).status).toBe(403);
      expect((await GET(new Request('http://x/api/day-session?date=2026-10-18'))).status).toBe(403);
    }
    expect(server.saveDaySession).not.toHaveBeenCalled();
  });

  it('a member reading the feed gets nothing, without the table being read', async () => {
    const { GET } = await import('@/app/api/day-session/route');
    requireSession.mockResolvedValue(session({ role: 'runner' }));
    const res = await GET(new Request('http://x/api/day-session'));
    expect(await res.json()).toEqual({ setup: true, sessions: [] });
    expect(server.readUpcoming).not.toHaveBeenCalled();
  });

  it('before the migration the write says so (503), and nothing is pushed', async () => {
    const { PUT } = await import('@/app/api/day-session/route');
    requireSession.mockResolvedValue(session({ isSuperUser: true }));
    server.readDaySession.mockResolvedValue({ setup: false, session: null });
    const res = await PUT(put(BODY));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_set_up' });
    expect(server.sendDaySessionPush).not.toHaveBeenCalled();
  });

  it('the super user publishes; the push goes once, to the recipients the server picks', async () => {
    const { PUT } = await import('@/app/api/day-session/route');
    requireSession.mockResolvedValue(session({ isSuperUser: true }));
    server.readDaySession.mockResolvedValue({ setup: true, session: null });
    server.saveDaySession.mockImplementation(async (row: Record<string, unknown>) => ({
      id: 'r1', date: row.session_date, startTime: '19:00', place: 'הירקון', title: row.title, quickText: '', steps: row.steps,
      nutrition: row.nutrition, publishedAt: row.published_at, notify: true, notifiedAt: null, updatedAt: null,
    }));
    server.claimNotify.mockResolvedValueOnce(true).mockResolvedValue(false);
    server.daySessionRecipients.mockResolvedValue(['me']);
    server.sendDaySessionPush.mockResolvedValue(1);

    const first = await (await PUT(put(BODY))).json();
    const second = await (await PUT(put(BODY))).json();
    expect(first.notified).toBe(true);
    expect(second.notified).toBe(false);
    expect(server.sendDaySessionPush).toHaveBeenCalledTimes(1);
    expect(server.daySessionRecipients).toHaveBeenCalledWith('me');
    const row = server.saveDaySession.mock.calls[0][0];
    expect(row.title).toBe('6 × 1 ק״מ');
    expect(row.steps[1].repeatCount).toBe(6);
  });
});

describe('numbers in an LTR isolate', () => {
  it('isolates the structure, not the Hebrew unit', async () => {
    const { numberRuns, isolateNumbers } = await import('@/lib/day-session/model');
    expect(numberRuns('6 × 1 ק״מ')).toEqual([{ ltr: true, text: '6 × 1' }, { ltr: false, text: ' ק״מ' }]);
    expect(numberRuns('טמפו 20 דקות')).toEqual([{ ltr: false, text: 'טמפו ' }, { ltr: true, text: '20' }, { ltr: false, text: ' דקות' }]);
    expect(isolateNumbers('6 × 800 מ׳')).toBe('⁦6 × 800⁩ מ׳');
  });
});

// ── The planner editor's steps ────────────────────────────────────────────────────────

const pace = (p: number) => ({ targetType: 'pace' as const, targetPaceMinPerKm: p, targetPaceMaxPerKm: p, group2Pace: { min: p + 10, max: p + 10 }, group3Pace: { min: p + 20, max: p + 20 } });
const EDITED: WorkoutStep[] = [
  { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'no_target', targetZone: 'easy' },
  {
    order: 2, type: 'interval', durationType: 'distance', durationValue: 1000, ...pace(240), repeatCount: 7,
    repeatSteps: [
      { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, ...pace(240) },
      { order: 2, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: 'הליכה' },
    ],
  },
  { order: 3, type: 'cooldown', durationType: 'time', durationValue: 600, durationMaxValue: 900, targetType: 'no_target' },
];

describe('the planner editor\'s steps, validated', () => {
  it('takes a well-formed list as it is', () => {
    expect(validateWorkoutSteps(EDITED)).toEqual(EDITED);
  });
  it('refuses unknown types, durations and targets', () => {
    expect(validateWorkoutSteps([{ ...EDITED[0], type: 'sprint' }])).toMatch(/type/);
    expect(validateWorkoutSteps([{ ...EDITED[0], durationType: 'laps' }])).toMatch(/durationType/);
    expect(validateWorkoutSteps([{ ...EDITED[0], targetType: 'power' }])).toMatch(/targetType/);
  });
  it('refuses absurd lengths and paces, and a repeat inside a repeat', () => {
    expect(validateWorkoutSteps([{ ...EDITED[0], durationValue: 0 }])).toMatch(/duration/);
    expect(validateWorkoutSteps([{ ...EDITED[0], ...pace(30) }])).toMatch(/pace/);
    expect(validateWorkoutSteps([{ ...EDITED[0], group2Pace: { min: 5000, max: 5000 } }])).toMatch(/pack pace/);
    const nested = { ...EDITED[1], repeatSteps: [EDITED[1]] };
    expect(validateWorkoutSteps([nested])).toMatch(/repeat inside a repeat/);
    expect(validateWorkoutSteps([{ ...EDITED[1], repeatCount: 0 }])).toMatch(/repeat count/);
  });
  it('refuses an empty list, rests only, and too many steps', () => {
    expect(validateWorkoutSteps([])).toMatch(/empty/);
    expect(validateWorkoutSteps([{ order: 1, type: 'rest', durationType: 'time', durationValue: 60, targetType: 'no_target' }])).toMatch(/no running/);
    expect(validateWorkoutSteps(Array.from({ length: MAX_STEPS + 1 }, () => EDITED[0]))).toMatch(/at most/);
  });
  it('readInput: explicit steps make the sentence optional, and a bad step is the 400', () => {
    const r = readInput({ date: '2026-10-18', steps: EDITED });
    expect(typeof r === 'object' && r.steps).toEqual(EDITED);
    expect(readInput({ date: '2026-10-18', steps: [{ ...EDITED[0], durationValue: -1 }] })).toMatch(/duration/);
  });
});

describe('edited steps are stored, not re-parsed', () => {
  it('explicit steps win over the sentence; the title is the coach\'s or the session\'s', () => {
    expect(resolveWorkout({ quickText: '2 קל, 5x1000, 2 קל', steps: EDITED, title: null })).toEqual({ steps: EDITED, title: '7 × 1 ק״מ' });
    expect(resolveWorkout({ quickText: '', steps: EDITED, title: 'ערב קילומטרים' }).title).toBe('ערב קילומטרים');
  });

  it('the route stores the editor\'s steps, keeps the sentence as quick_text, and the notes', async () => {
    const { PUT } = await import('@/app/api/day-session/route');
    requireSession.mockResolvedValue(session({ isSuperUser: true }));
    server.readDaySession.mockResolvedValue({ setup: true, session: null });
    server.saveDaySession.mockImplementation(async (row: Record<string, unknown>) => ({ id: 'r1', publishedAt: null, notify: false, notifiedAt: null, ...row }));
    const res = await PUT(put({ ...BODY, steps: EDITED, title: '', description: 'נפגשים בגשר' }));
    expect(res.status).toBe(200);
    const row = server.saveDaySession.mock.calls.at(-1)![0];
    expect(row.steps).toEqual(EDITED);
    expect(row.quick_text).toBe(BODY.quickText);
    expect(row.title).toBe('7 × 1 ק״מ');
    expect(row.description).toBe('נפגשים בגשר');
  });

  it('the route refuses bad explicit steps with 400 and saves nothing', async () => {
    const { PUT } = await import('@/app/api/day-session/route');
    requireSession.mockResolvedValue(session({ isSuperUser: true }));
    server.saveDaySession.mockClear();
    const res = await PUT(put({ ...BODY, steps: [{ ...EDITED[0], durationValue: 0 }] }));
    expect(res.status).toBe(400);
    expect(server.saveDaySession).not.toHaveBeenCalled();
  });
});

describe('a row saved before the planner shape', () => {
  const OLD: QuickStep[] = [
    { kind: 'run', role: 'warmup', length: { measure: 'distance', value: 2000 }, effort: { kind: 'zone', zone: 'easy' } },
    { kind: 'reps', count: 5, work: { measure: 'distance', value: 1000 }, effort: { kind: 'pace', min: 240, max: 240 }, rest: { length: { measure: 'time', value: 120 }, mode: 'jog' } },
    { kind: 'run', role: 'cooldown', length: { measure: 'distance', value: 2000 }, effort: null },
  ];
  it('reads as planner steps, its one-pace-per-pack laid onto the reps', async () => {
    const { fromRow } = await import('@/lib/day-session/model');
    const s = fromRow({ id: 'r1', session_date: '2026-10-18', title: '5 × 1 ק״מ', quick_text: '', steps: OLD, pack_paces: [null, 235, null], nutrition: [] });
    expect(s.steps.map((x) => x.type)).toEqual(['warmup', 'interval', 'cooldown']);
    const rep = s.steps[1].repeatSteps![0];
    expect([rep.targetPaceMinPerKm, rep.group2Pace?.min, rep.group3Pace?.min]).toEqual([240, 235, 240]);
    expect(s.steps[1].repeatSteps![1]).toMatchObject({ type: 'rest', durationValue: 120, notes: 'ג׳וג' });
    expect(totalsOf(s.steps).distanceM).toBeGreaterThan(9000);
  });
  it('a rest written after reps with none of their own becomes the recovery inside', () => {
    const w = quickToWorkout([
      { kind: 'reps', count: 15, work: { measure: 'distance', value: 200 }, effort: null, rest: null },
      { kind: 'rest', length: { measure: 'distance', value: 100 }, mode: 'walk' },
    ]);
    expect(w).toHaveLength(1);
    expect(w[0].repeatSteps).toHaveLength(2);
  });
  it('a stored planner row is read as it is, and the notes need migration 151', async () => {
    const { fromRow } = await import('@/lib/day-session/model');
    const row = { id: 'r1', session_date: '2026-10-18', title: '7 × 1 ק״מ', quick_text: '2 קל, 5x1000, 2 קל', steps: EDITED, pack_paces: [null, null, null], nutrition: [], description: 'נפגשים בגשר' };
    expect(fromRow(row).steps).toEqual(EDITED);
    expect(fromRow(row).description).toBe('נפגשים בגשר');
    expect(fromRow({ ...row, description: undefined }).description).toBeNull();
  });
});

describe('/api/day-session/watch', () => {
  beforeEach(() => {
    requireSession.mockReset();
    Object.values(server).forEach((f) => f.mockReset());
  });
  it('only the editor sends, never while viewing as somebody', async () => {
    const { POST } = await import('@/app/api/day-session/watch/route');
    const post = (body: unknown) => new Request('http://x/api/day-session/watch', { method: 'POST', body: JSON.stringify(body) });
    for (const role of ['coach', 'admin', 'runner']) {
      requireSession.mockResolvedValue(session({ role }));
      expect((await POST(post({ date: '2026-10-18' }))).status).toBe(403);
    }
    requireSession.mockResolvedValue(session({ isSuperUser: true, viewingAsBy: 'x' }));
    expect((await POST(post({ date: '2026-10-18' }))).status).toBe(403);
    requireSession.mockResolvedValue(session({ isSuperUser: true }));
    expect((await POST(post({ date: 'tomorrow' }))).status).toBe(400);
    server.readDaySession.mockResolvedValue({ setup: true, session: null });
    expect((await POST(post({ date: '2026-10-18' }))).status).toBe(400);
    expect((await POST(post({ date: '2026-10-18', athleteIds: ['a'] }))).status).toBe(404);
    expect(server.daySessionRecipients).not.toHaveBeenCalled();
  });
});

describe('quality session (RSVP) and the watch pick', () => {
  beforeEach(() => {
    requireSession.mockReset();
    Object.values(server).forEach((f) => f.mockReset());
  });
  it('quality is stored as sent; an old row reads as quality', async () => {
    const r = readInput({ date: '2026-10-18', quickText: '6x1000', quality: false });
    expect(typeof r === 'object' && r.quality).toBe(false);
    const { fromRow } = await import('@/lib/day-session/model');
    expect(fromRow({ id: 'r', session_date: '2026-10-18', steps: [] }).quality).toBe(true);
    expect(fromRow({ id: 'r', session_date: '2026-10-18', steps: [], quality: false }).quality).toBe(false);
  });
  it('the watch goes to the coach\'s pick, queued at once, delivered after the answer', async () => {
    const watch = await import('@/lib/day-session/watch');
    const spy = vi.spyOn(watch, 'startDaySessionSend').mockResolvedValue({ queued: 2, skipped: 0, work: Promise.resolve() });
    const { POST } = await import('@/app/api/day-session/watch/route');
    requireSession.mockResolvedValue(session({ isSuperUser: true }));
    server.readDaySession.mockResolvedValue({ setup: true, session: { id: 'r1', date: '2026-10-18', steps: EDITED } });
    const post = (body: unknown) => new Request('http://x/api/day-session/watch', { method: 'POST', body: JSON.stringify(body) });
    const res = await POST(post({ date: '2026-10-18', athleteIds: ['a', 'b', 'a'] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: 2, skipped: 0 });
    expect(spy).toHaveBeenLastCalledWith(expect.anything(), ['a', 'b'], 'me');
    expect((await POST(post({ date: '2026-10-18', athleteIds: [] }))).status).toBe(400);
    spy.mockRestore();
  });
});

describe('the notification text', () => {
  const steps = parseClubText('50 דק׳ 4:40 - 5:15\n15 x\n200 מ׳ 3:15 (3:25) ((3:35))\n100 מ׳ הליכה').steps;
  it('says the session plainly, with no bidi marks (they showed as boxes)', async () => {
    const { defaultPushCopy } = await import('@/lib/day-session/model');
    const c = defaultPushCopy({ date: '2026-10-18', steps, startTime: '19:00', place: 'פארק הירקון', nutrition: [{ when: 'before', text: 'בננה' }] }, '2026-10-18');
    expect(c).toEqual({ title: 'האימון של היום · 19:00', body: '50 דק׳ + 15 × 200 מ׳ · פארק הירקון · ותזונה לאימון' });
    expect(`${c.title}${c.body}`).not.toMatch(/[⁦-⁩]/);
    expect(defaultPushCopy({ date: '2026-10-19', steps, startTime: null, place: null, nutrition: [] }, '2026-10-18').title).toBe('האימון של מחר');
  });
  it('the coach\'s own text wins; the request keeps it short', async () => {
    const r = readInput({ date: '2026-10-18', quickText: '6x1000', pushTitle: ' שלום ', pushBody: 'x'.repeat(500) });
    expect(typeof r === 'object' && r.pushTitle).toBe('שלום');
    expect(typeof r === 'object' && r.pushBody?.length).toBe(180);
    expect(typeof r === 'object' && readInput({ date: '2026-10-18', quickText: '6x1000', pushTitle: '  ' }) && (readInput({ date: '2026-10-18', quickText: '6x1000', pushTitle: '  ' }) as { pushTitle: unknown }).pushTitle).toBeNull();
  });
});

describe('where the send stands, runner by runner', async () => {
  const { runnerState, statusOf, countsOf, reasonText, STALE_MS, INTERRUPTED } = await import('@/lib/day-session/watch-status');
  const t0 = Date.parse('2026-10-18T10:00:00Z');
  const at = (ms: number) => new Date(t0 + ms).toISOString();
  const q = (over: Record<string, unknown> = {}) => ({ athlete_id: 'a', status: 'pending', workout_data: { queued: true }, created_at: at(0), ...over });
  it('queued, then sending, then the queue row goes and the real row says it landed', () => {
    expect(runnerState([q()], t0 + 1000)?.state).toBe('queued');
    expect(runnerState([q({ workout_data: { queued: true, started: true } })], t0 + 1000)?.state).toBe('sending');
    expect(runnerState([{ athlete_id: 'a', status: 'success', garmin_workout_id: 'g1', created_at: at(5000) }], t0 + 6000)).toEqual({ athleteId: 'a', state: 'ok', error: null, at: at(5000) });
  });
  it('a failure keeps Garmin\'s reason; a queue row left behind reads as interrupted, never "בתור" forever', () => {
    expect(runnerState([q({ status: 'failed', error_message: '401 Unauthorized' })], t0)).toMatchObject({ state: 'failed', error: '401 Unauthorized' });
    expect(runnerState([q()], t0 + STALE_MS + 1)).toMatchObject({ state: 'failed', error: INTERRUPTED });
    expect(reasonText('401 Unauthorized')).toMatch(/להתחבר מחדש/);
    expect(reasonText('429 Too Many Requests')).toMatch(/עמוס/);
  });
  it('a re-send in progress shows as on the way, over the earlier success', () => {
    const rows = [{ athlete_id: 'a', status: 'success', created_at: at(0) }, q({ created_at: at(60000) })];
    expect(runnerState(rows, t0 + 61000)?.state).toBe('queued');
  });
  it('Apple waits for the phone; superseded rows are ignored', () => {
    expect(runnerState([{ athlete_id: 'a', status: 'pending', provider: 'apple', created_at: at(0) }], t0)?.state).toBe('waiting');
    expect(runnerState([{ athlete_id: 'a', status: 'pending', provider: 'apple', device_confirmed_at: at(9), created_at: at(0) }], t0)?.state).toBe('ok');
    expect(runnerState([{ athlete_id: 'a', status: 'success', superseded_at: at(1), created_at: at(0) }], t0)).toBeNull();
  });
  it('counts', () => {
    const list = statusOf([q({ athlete_id: 'x' }), { athlete_id: 'y', status: 'success', created_at: at(0) }, q({ athlete_id: 'z', status: 'failed' })], t0);
    expect(countsOf(list)).toEqual({ ok: 1, waiting: 0, failed: 1, onTheWay: 1, total: 3 });
  });
});
