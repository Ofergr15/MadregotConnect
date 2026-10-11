import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/academy/month — the month board (trainee-experience-v2 screen 3). What only the
 * route can get wrong: who may read it, that it grades every week the month touches and
 * nothing outside the month, that the race flag sits on the characterization's date, and
 * that the summary counts the grid it returns.
 */

const TRAINEE = 'trainee-1';
const COACH = 'coach-1';
const STRANGER = 'stranger-1';

const caller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ requireCallerForAthlete: () => caller() }));
vi.mock('@/lib/academy/pairing-server', () => ({
  mayCoach: async (c: { athleteId: string }, id: string) => c.athleteId === id || (c.athleteId === COACH && id === TRAINEE),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));

vi.mock('@/lib/academy/book-server', () => ({ loadPlanBasis: async () => null, loadThresholds: async () => ({ [TRAINEE]: 252 }) }));

let race: string | null = null;
vi.mock('@/lib/academy/load-server', () => ({ loadRaceDate: async () => race }));

// Sessions by date: completed + km, or missed (actual null). Dates after "today" are planned.
let plan: Record<string, { km: number; ran: number | null }> = {};
const asked: string[] = [];
vi.mock('@/lib/academy/report', () => ({
  computeAcademyWeekAdherence: async ({ weekStart }: { weekStart: string }) => {
    asked.push(weekStart);
    const end = new Date(`${weekStart}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const weekEnd = end.toISOString().slice(0, 10);
    const workouts = Object.entries(plan)
      .filter(([d]) => d >= weekStart && d <= weekEnd)
      .map(([date, s]) => ({
        date,
        completed: s.ran != null,
        distance: { plannedMin: s.km * 1000, plannedMax: s.km * 1000, actual: s.ran != null ? s.ran * 1000 : null },
        duration: { planned: s.km * 330, actual: s.ran != null ? s.ran * 330 : null, estimated: true },
      }));
    return { weekStart, weekEnd, tolerances: {}, athletes: [{ athleteId: TRAINEE, name: 'Shahar', week: { workouts } }] };
  },
}));

// "Today" is pinned by the clock: Tuesday 13 October 2026, 06:43 in Israel.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-13T03:43:00Z'));

const { GET } = await import('@/app/api/academy/month/route');
const get = (q: string) => GET(new Request(`http://x/api/academy/month?${q}`));

const as = (athleteId: string) => caller.mockResolvedValue({ denied: null, caller: { athleteId, isStaff: athleteId !== TRAINEE } });
const oct = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;

beforeEach(() => {
  as(TRAINEE);
  race = null;
  asked.length = 0;
  // The mockup's October: on plan 1,3,4,5,8,10,11 · a bit off 6 (13.4 of 10) and 12 (6.2 of 8) ·
  // missed 2 · today 13 and the rest planned. A September day in the first week is graded too
  // (it is in the week) but is not October's.
  plan = {
    '2026-09-29': { km: 10, ran: 10 },
    [oct(1)]: { km: 15, ran: 15.2 }, [oct(2)]: { km: 8, ran: null }, [oct(3)]: { km: 16, ran: 16 },
    [oct(4)]: { km: 10, ran: 10.2 }, [oct(5)]: { km: 8, ran: 8 }, [oct(6)]: { km: 10, ran: 13.4 },
    [oct(8)]: { km: 16, ran: 15.8 }, [oct(10)]: { km: 32, ran: 32.1 }, [oct(11)]: { km: 10, ran: 10.1 },
    [oct(12)]: { km: 8, ran: 6.2 }, [oct(13)]: { km: 10.3, ran: null }, [oct(15)]: { km: 10.5, ran: null },
    [oct(17)]: { km: 16, ran: null }, [oct(31)]: { km: 16, ran: null },
  };
});

describe('the request', () => {
  it('needs an athlete, and a month in YYYY-MM', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get(`athleteId=${TRAINEE}&month=2026-13`)).status).toBe(400);
    expect((await get(`athleteId=${TRAINEE}&month=october`)).status).toBe(400);
  });
  it('is 403 for a stranger, 200 for the trainee and the coach', async () => {
    as(STRANGER);
    expect((await get(`athleteId=${TRAINEE}`)).status).toBe(403);
    as(COACH);
    expect((await get(`athleteId=${TRAINEE}`)).status).toBe(200);
    as(TRAINEE);
    expect((await get(`athleteId=${TRAINEE}`)).status).toBe(200);
  });
});

describe('the month', () => {
  it('defaults to this month and grades every Sunday week it touches', async () => {
    const body = await (await get(`athleteId=${TRAINEE}`)).json();
    expect(body.month).toBe('2026-10');
    expect(body.today).toBe('2026-10-13');
    expect(asked.sort()).toEqual(['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  });

  it('colours each day by the week board\'s grading; September is not drawn', async () => {
    const { days } = await (await get(`athleteId=${TRAINEE}&month=2026-10`)).json();
    expect(days).toHaveLength(31);
    expect(days[0].date).toBe('2026-10-01');
    const colour = (d: number) => days[d - 1].color;
    expect([1, 3, 4, 5, 8, 10, 11].map(colour)).toEqual(Array(7).fill('green'));
    expect([6, 12].map(colour)).toEqual(['yellow', 'yellow']);
    expect(colour(2)).toBe('red');
    expect([13, 15, 17, 31].map(colour)).toEqual(['grey', 'grey', 'grey', 'grey']);
    expect([7, 9, 14, 16].map(colour)).toEqual([null, null, null, null]);
    expect(days.filter((d: { today: boolean }) => d.today).map((d: { date: string }) => d.date)).toEqual(['2026-10-13']);
  });

  it('the summary counts exactly the grid: 9 of 10, 127 km, 7 · 2 · 1', async () => {
    const { days, summary } = await (await get(`athleteId=${TRAINEE}&month=2026-10`)).json();
    expect(summary).toEqual({ done: 9, planned: 10, km: 127, onPlan: 7, bitOff: 2, farOff: 0, missed: 1 });
    const colours = days.map((d: { color: string | null }) => d.color);
    expect(colours.filter((c: string | null) => c === 'green').length).toBe(summary.onPlan);
    expect(colours.filter((c: string | null) => c === 'yellow').length).toBe(summary.bitOff);
    expect(colours.filter((c: string | null) => c === 'red').length).toBe(summary.missed);
    expect(colours.filter((c: string | null) => c && c !== 'grey').length).toBe(summary.planned);
  });

  it('🏁 only on the real race day', async () => {
    let { days } = await (await get(`athleteId=${TRAINEE}&month=2026-10`)).json();
    expect(days.some((d: { race: boolean }) => d.race)).toBe(false);
    race = '2026-10-31';
    ({ days } = await (await get(`athleteId=${TRAINEE}&month=2026-10`)).json());
    expect(days.filter((d: { race: boolean }) => d.race).map((d: { date: string }) => d.date)).toEqual(['2026-10-31']);
  });
});
