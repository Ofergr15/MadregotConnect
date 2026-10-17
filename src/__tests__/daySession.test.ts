import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOnFeed, mayEditDaySession, maySeeDaySession, notifyOnce, parsePaceText, parseWorkout, planCoversDay,
  planLinks, readInput, shouldNotify, totalsOf,
} from '@/lib/day-session/model';
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

describe('migration 149', () => {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/149_day_sessions.sql'), 'utf8');
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
