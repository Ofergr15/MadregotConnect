import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bookOf, bookToQuick, buildStep, insertStep, isOnFeed, mayEditDaySession, maySeeDaySession, moveStep, notifyOnce,
  parseClockText, parsePaceText, parseWorkout, planCoversDay, planLinks, readInput, resolveWorkout, shouldNotify,
  stepsToStore, switchMeasure, totalsOf, validateSteps, EDIT_THRESHOLD_SEC,
} from '@/lib/day-session/model';
import { nudgeField, removeStep, setField, structureName, type BookStep } from '@/lib/academy/book-steps';
import { parseQuickText, type QuickStep } from '@/lib/academy/quick-text';
import { DAY_SESSION_FOR_ALL } from '@/lib/day-session/flag';

// "אימון ליום אחד" (mockup manual-day-workout): the pure rules, then the route's gate.

describe('the typed workout, through the quick-text parser', () => {
  it('reads the mockup line as 6 × 1 km with warmup and cooldown', () => {
    const { steps, title } = parseWorkout('2 קל, 6x1000 מנוחה 90, 2 קל');
    expect(title).toBe('6 × 1 ק״מ');
    expect(steps.map((s) => s.kind)).toEqual(['run', 'reps', 'run']);
    const reps = steps[1];
    expect(reps.kind === 'reps' && reps.count).toBe(6);
    expect(reps.kind === 'reps' && reps.rest?.length).toEqual({ measure: 'time', value: 90 });
    // 2 + 6 + 2 km of running plus the jogs: the "10.5 ק״מ · כ־60 דק׳" line.
    const t = totalsOf(steps);
    expect(t.distanceM).toBeGreaterThanOrEqual(10000);
    expect(t.durationSec).toBeGreaterThan(40 * 60);
  });

  it('nothing understood → no steps and no title', () => {
    expect(parseWorkout('שלום')).toEqual(expect.objectContaining({ steps: [], title: '' }));
  });
});

describe('the gate', () => {
  const superUser = { isSuperUser: true, role: 'runner' };
  const coach = { isSuperUser: false, role: 'coach' };
  const admin = { isSuperUser: false, role: 'admin' };
  const member = { isSuperUser: false, role: 'runner' };

  it('ships OFF', () => expect(DAY_SESSION_FOR_ALL).toBe(false));

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
  const ok = { date: '2026-10-18', startTime: '19:00', place: ' הירקון ', quickText: '6x1000', packPaces: [215, '235', 'x'], nutrition: [{ when: 'before', text: ' בננה ' }, { when: 'lunch', text: 'x' }, { when: 'after', text: '' }] };
  it('cleans the body', () => {
    const r = readInput(ok);
    expect(typeof r).toBe('object');
    if (typeof r === 'string') return;
    expect(r.place).toBe('הירקון');
    expect(r.packPaces).toEqual([215, 235, null]);
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

const session = (over: Record<string, unknown>) => ({ ok: true, user: { athleteId: 'me', isSuperUser: false, role: 'runner', ...over } });
const put = (body: unknown) => new Request('http://x/api/day-session', { method: 'PUT', body: JSON.stringify(body) });
const BODY = { date: '2026-10-18', startTime: '19:00', place: 'הירקון', quickText: '2 קל, 6x1000 מנוחה 90, 2 קל', packPaces: [null, 235, null], nutrition: [{ when: 'before', text: 'בננה' }], publish: true, notify: true };

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
      packPaces: row.pack_paces, nutrition: row.nutrition, publishedAt: row.published_at, notify: true, notifiedAt: null, updatedAt: null,
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
    expect(row.pack_paces).toEqual([null, 235, null]);
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

// ── The editor: explicit steps ────────────────────────────────────────────────────────

const MANUAL: QuickStep[] = [
  { kind: 'run', role: 'warmup', length: { measure: 'distance', value: 2000 }, effort: { kind: 'zone', zone: 'easy' } },
  { kind: 'reps', count: 5, work: { measure: 'distance', value: 1000 }, effort: { kind: 'pace', min: 240, max: 240 }, rest: null },
  { kind: 'rest', length: { measure: 'time', value: 120 }, mode: null },
  { kind: 'run', role: 'cooldown', length: { measure: 'distance', value: 2000 }, effort: { kind: 'zone', zone: 'easy' } },
];

describe('explicit steps, validated', () => {
  it('takes a well-formed list as it is', () => {
    expect(validateSteps(MANUAL)).toEqual(MANUAL);
  });
  it('refuses unknown kinds, roles, zones and rest modes', () => {
    expect(validateSteps([{ kind: 'swim', length: { measure: 'distance', value: 400 } }])).toMatch(/unknown kind/);
    expect(validateSteps([{ ...MANUAL[0], role: 'sprint' }])).toMatch(/role/);
    expect(validateSteps([{ ...MANUAL[0], effort: { kind: 'zone', zone: 'turbo' } }])).toMatch(/pace/);
    expect(validateSteps([MANUAL[0], { ...MANUAL[2], mode: 'swim' }])).toMatch(/rest mode/);
  });
  it('refuses zero, negative, fractional and absurd lengths and counts', () => {
    const run = (value: number, measure = 'distance') => [{ ...MANUAL[0], length: { measure, value } }];
    expect(validateSteps(run(0))).toMatch(/length/);
    expect(validateSteps(run(-2000))).toMatch(/length/);
    expect(validateSteps(run(50))).toMatch(/length/);
    expect(validateSteps(run(1500.5))).toMatch(/length/);
    expect(validateSteps(run(100000))).toMatch(/length/);
    expect(validateSteps(run(5, 'time'))).toMatch(/length/);
    expect(validateSteps(run(7 * 3600, 'time'))).toMatch(/length/);
    expect(validateSteps(run(600, 'furlongs'))).toMatch(/length/);
    expect(validateSteps([{ ...MANUAL[1], count: 0 }])).toMatch(/count/);
    expect(validateSteps([{ ...MANUAL[1], count: 51 }])).toMatch(/count/);
    expect(validateSteps([{ ...MANUAL[1], count: 2.5 }])).toMatch(/count/);
    expect(validateSteps([{ ...MANUAL[1], rest: { length: { measure: 'time', value: 0 }, mode: 'jog' } }])).toMatch(/recovery/);
  });
  it('refuses insane paces (the book\'s 2:30–15:00) and a reversed range', () => {
    const at = (min: number, max: number) => [{ ...MANUAL[1], effort: { kind: 'pace', min, max } }];
    expect(validateSteps(at(100, 100))).toMatch(/pace/);
    expect(validateSteps(at(1000, 1000))).toMatch(/pace/);
    expect(validateSteps(at(250, 240))).toMatch(/pace/);
    expect(validateSteps(at(240, 250))).not.toBeTypeOf('string');
  });
  it('refuses an empty list, a list of rests only, and more than 30 steps', () => {
    expect(validateSteps([])).toMatch(/empty/);
    expect(validateSteps('2 קל')).toMatch(/list/);
    expect(validateSteps([MANUAL[2]])).toMatch(/no running/);
    expect(validateSteps(Array.from({ length: 31 }, () => MANUAL[0]))).toMatch(/30/);
  });
  it('readInput: explicit steps make the sentence optional, and a bad step is the 400', () => {
    const base = { date: '2026-10-18', packPaces: [], nutrition: [] };
    const r = readInput({ ...base, steps: MANUAL, title: '  ', description: ' נפגשים בגשר ' });
    expect(typeof r).toBe('object');
    if (typeof r === 'string') return;
    expect(r.steps).toEqual(MANUAL);
    expect(r.quickText).toBe('');
    expect(r.title).toBeNull();
    expect(r.description).toBe('נפגשים בגשר');
    expect(readInput({ ...base, steps: [{ kind: 'reps', count: 5, work: { measure: 'distance', value: -1 } }] })).toMatch(/step 1/);
    expect(readInput({ ...base })).toMatch(/quickText/);
  });
});

describe('edited steps are stored, not re-parsed', () => {
  it('explicit steps win over the sentence; the title is the coach\'s or the structure\'s', () => {
    const edited: QuickStep[] = [{ ...MANUAL[1], count: 8 } as QuickStep];
    const r = resolveWorkout({ quickText: '2 קל, 6x1000 מנוחה 90, 2 קל', steps: edited, title: null });
    expect(r.steps).toBe(edited);
    expect(r.title).toBe('8 × 1 ק״מ');
    expect(resolveWorkout({ quickText: '', steps: edited, title: 'אימון הגשר' }).title).toBe('אימון הגשר');
    // Without steps it is today's parse.
    expect(resolveWorkout({ quickText: '2 קל, 6x1000 מנוחה 90, 2 קל', steps: null, title: null }).title).toBe('6 × 1 ק״מ');
  });

  it('sentence → edit (reps 6 → 7, the pace 4:05 → 4:00) → the stored steps are the edit', () => {
    const parsed = parseQuickText('2 קל, 6x1000 ב-4:05 מנוחה 2:00, 2 קל').steps;
    let book = bookOf(parsed);
    const reps = book.findIndex((s) => s.kind === 'reps');
    book = nudgeField(book, { step: reps, field: 'count' }, 1, EDIT_THRESHOLD_SEC);
    book = setField(book, { step: reps, field: 'pace' }, 240, EDIT_THRESHOLD_SEC);
    const stored = stepsToStore(book, parsed);
    const r = stored[reps];
    expect(r.kind === 'reps' && r.count).toBe(7);
    expect(r.kind === 'reps' && r.effort).toEqual({ kind: 'pace', min: 240, max: 240 });
    // Everything the coach did not touch is as parsed (the easy runs stay words).
    expect(stored[0]).toEqual(parsed[0]);
    expect(stored[stored.length - 1]).toEqual(parsed[parsed.length - 1]);
    expect(r.kind === 'reps' && r.rest).toEqual({ length: { measure: 'time', value: 120 }, mode: null });
    expect(validateSteps(stored)).toEqual(stored);
  });

  it('an edit that changed nothing sends the parse as it was', () => {
    const parsed = parseQuickText('2 קל, 5x1000 ב-4:05 מנוחה 2:00, 2 קל').steps;
    expect(stepsToStore(bookOf(parsed), parsed)).toBe(parsed);
  });

  it('typed paces survive the round trip to the second', () => {
    for (const pace of [180, 205, 235, 245, 260, 300, 345, 420]) {
      const q: QuickStep[] = [{ kind: 'reps', count: 5, work: { measure: 'distance', value: 1000 }, effort: { kind: 'pace', min: pace, max: pace }, rest: null }];
      expect(bookToQuick(bookOf(q))).toEqual(q);
    }
    const range: QuickStep[] = [{ kind: 'run', role: 'main', length: { measure: 'time', value: 1200 }, effort: { kind: 'pace', min: 240, max: 260 } }];
    const back = bookToQuick(bookOf(range))[0];
    expect(back.kind === 'run' && back.effort).toEqual({ kind: 'pace', min: 240, max: 260 });
  });

  it('the route stores the editor\'s steps, keeps the sentence as quick_text, and the notes', async () => {
    const { PUT } = await import('@/app/api/day-session/route');
    requireSession.mockResolvedValue(session({ isSuperUser: true }));
    server.readDaySession.mockResolvedValue({ setup: true, session: null });
    server.saveDaySession.mockImplementation(async (row: Record<string, unknown>) => ({ id: 'r1', publishedAt: null, notify: false, notifiedAt: null, ...row }));
    const edited: QuickStep[] = [MANUAL[0], { ...MANUAL[1], count: 7 } as QuickStep, MANUAL[3]];
    const res = await PUT(put({ ...BODY, steps: edited, title: '', description: 'נפגשים בגשר' }));
    expect(res.status).toBe(200);
    const row = server.saveDaySession.mock.calls.at(-1)![0];
    expect(row.steps).toEqual(edited);
    expect(row.quick_text).toBe(BODY.quickText);
    expect(row.title).toBe('7 × 1 ק״מ');
    expect(row.description).toBe('נפגשים בגשר');
  });

  it('the route refuses bad explicit steps with 400 and saves nothing', async () => {
    const { PUT } = await import('@/app/api/day-session/route');
    requireSession.mockResolvedValue(session({ isSuperUser: true }));
    server.saveDaySession.mockClear();
    const res = await PUT(put({ ...BODY, steps: [{ kind: 'reps', count: 5, work: { measure: 'distance', value: 0 }, effort: null, rest: null }] }));
    expect(res.status).toBe(400);
    expect(server.saveDaySession).not.toHaveBeenCalled();
  });
});

describe('manual, from an empty list', () => {
  it('warmup 2 km, 5 × 1000 at 4:00, rest 2:00, cooldown 2 km — in that order whatever order they are added', () => {
    let steps: BookStep[] = [];
    const add = (spec: Parameters<typeof buildStep>[0]) => { const s = buildStep(spec); expect(s).not.toBeNull(); steps = insertStep(steps, s!); };
    add({ kind: 'cooldown', measure: 'distance', value: 2000, pace: null });
    add({ kind: 'reps', measure: 'distance', value: 1000, pace: 240, count: 5, restSec: null });
    add({ kind: 'rest', measure: 'time', value: 120, pace: null });
    add({ kind: 'warmup', measure: 'distance', value: 2000, pace: null });
    const stored = bookToQuick(steps);
    expect(stored).toEqual(MANUAL);
    expect(validateSteps(stored)).toEqual(MANUAL);
    expect(structureName(steps)).toBe('5 × 1 ק״מ');
    const r = resolveWorkout({ quickText: '', steps: stored, title: null });
    expect(r.title).toBe('5 × 1 ק״מ');
    expect(totalsOf(stored).distanceM).toBe(9000);
  });
  it('a step out of the book\'s range is not built', () => {
    expect(buildStep({ kind: 'run', measure: 'distance', value: 0, pace: null })).toBeNull();
    expect(buildStep({ kind: 'reps', measure: 'distance', value: 400, pace: 240, count: 0 })).toBeNull();
    expect(buildStep({ kind: 'reps', measure: 'distance', value: 400, pace: 100, count: 5 })).toBeNull();
    expect(buildStep({ kind: 'warmup', measure: 'time', value: 5, pace: null })).toBeNull();
  });
  it('move, delete, distance ⇄ time', () => {
    const steps = bookOf(MANUAL);
    expect(moveStep(steps, 2, -1).map((s) => s.kind)).toEqual(['run', 'rest', 'reps', 'run']);
    expect(moveStep(steps, 0, -1)).toBe(steps);
    expect(removeStep(steps, 2).map((s) => s.kind)).toEqual(['run', 'reps', 'run']);
    const timed = switchMeasure(steps, 0)[0];
    expect(timed.kind === 'run' && timed.length).toEqual({ measure: 'time', value: 600 });
    expect(validateSteps(bookToQuick(switchMeasure(steps, 1)))).not.toBeTypeOf('string');
  });
  it('reads the clock fields', () => {
    expect(parseClockText('2:00')).toBe(120);
    expect(parseClockText('2')).toBe(120);
    expect(parseClockText('1:30')).toBe(90);
    expect(parseClockText('1:75')).toBeNull();
    expect(parseClockText('x')).toBeNull();
  });
});

describe('editing a published day', () => {
  it('loads the STORED steps, not a re-parse of the sentence', async () => {
    const { fromRow } = await import('@/lib/day-session/model');
    const storedSteps: QuickStep[] = [MANUAL[0], { ...MANUAL[1], count: 7 } as QuickStep, MANUAL[3]];
    const row = { id: 'r1', session_date: '2026-10-18', title: '7 × 1 ק״מ', quick_text: '2 קל, 5x1000 ב-4:00, 2 קל', steps: storedSteps, pack_paces: [null, null, null], nutrition: [], description: 'נפגשים בגשר' };
    const s = fromRow(row);
    expect(s.steps).toEqual(storedSteps);
    expect(s.description).toBe('נפגשים בגשר');
    // What the editor opens with is the stored workout (7 reps), the sentence says 5.
    const editor = bookOf(s.steps);
    expect(editor[1].kind === 'reps' && editor[1].count).toBe(7);
    // Saving it unchanged sends the stored steps back exactly.
    expect(stepsToStore(editor, s.steps)).toBe(s.steps);
    // Before migration 151 the row has no description.
    expect(fromRow({ ...row, description: undefined }).description).toBeNull();
  });
});
