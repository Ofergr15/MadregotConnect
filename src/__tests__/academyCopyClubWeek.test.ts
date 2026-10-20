import { beforeEach, describe, expect, it, vi } from 'vitest';

/** "שבוע שלם מהקבוצה": POST /api/academy/copy-week { fromClub } (Ofer, 2026-10-20). */

const TRAINEE = 't1';
let denied = false;
const written: Array<{ athleteId: string; weekStart: string; workouts: Array<{ dayOfWeek: number; description?: string; steps: unknown[] }>; pushDays: number[] }> = [];
let seed: Array<{ dayOfWeek: number; name: string; steps: unknown[] }> = [];
let source: 'test' | 'coach' | undefined = 'coach';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<typeof import('@/lib/utils')>()), israelToday: () => '2026-10-20' }));
vi.mock('@/lib/academy/pairing-server', () => ({
  requireTraineeAccess: async () => (denied ? { denied: new Response('no', { status: 403 }), caller: {} } : { denied: null, caller: { athleteId: 'c', isSuperUser: false } }),
  visibleTraineeIds: async () => null,
}));
vi.mock('@/lib/academy/book-server', () => ({
  allAcademyTraineeIds: async () => [],
  loadTraineeWeeks: async () => ({}),
  loadTrainees: async () => [{ id: TRAINEE, name: 'Roni Gur', isAcademy: true, active: true, bandNumber: 4, bandThresholdSec: null, hasGarmin: true }],
  loadSeniorSeed: async (_s: unknown, _id: string, _w: string, thr: number | null) => (thr ? seed : []),
}));
vi.mock('@/lib/academy/coach-tools-server', async (orig) => ({
  ...(await orig<typeof import('@/lib/academy/coach-tools-server')>()),
  loadTestBasis: async () => ({ [TRAINEE]: { thresholdSec: 247, testDate: '2026-10-20', source } }),
  loadDecisions: async () => ({ stored: true, rows: [] }),
  writeWeek: async (_s: unknown, w: (typeof written)[number]) => { written.push(w); return { athleteId: w.athleteId, weekStart: w.weekStart, status: 'sent' }; },
}));
vi.mock('@/lib/academy/loop-notify', () => ({ notifyPlanSaved: async () => {} }));

const { POST } = await import('@/app/api/academy/copy-week/route');
const post = (body: unknown) => POST(new Request('http://x/api/academy/copy-week', { method: 'POST', body: JSON.stringify(body) }));

const step = { type: 'active', durationType: 'time', durationValue: 2400, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 };

beforeEach(() => {
  denied = false; written.length = 0; source = 'coach';
  seed = [
    { dayOfWeek: 0, name: 'ראשון', steps: [step] },
    { dayOfWeek: 2, name: 'שלישי', steps: [step] },
    { dayOfWeek: 5, name: 'שישי', steps: [step] },
  ];
});

describe('the whole group week for one trainee', () => {
  it('writes the club week as the trainee\'s own and sends only the days still ahead', async () => {
    const res = await post({ fromClub: true, athleteId: TRAINEE, weekStart: '2026-10-18', send: true });
    expect(res.status).toBe(200);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ athleteId: TRAINEE, weekStart: '2026-10-18' });
    expect(written[0].workouts.map(w => w.dayOfWeek)).toEqual([0, 2, 5]);
    // 20.10 is Tuesday: Sunday has passed, Tuesday and Friday go to the watch.
    expect(written[0].pushDays).toEqual([2, 5]);
    const body = await res.json();
    expect(body.results[0].paceBasis).toBe('coach');
  });

  it('without a club week, says so and writes nothing', async () => {
    seed = [];
    const res = await post({ fromClub: true, athleteId: TRAINEE, weekStart: '2026-10-18' });
    expect(res.status).toBe(409);
    expect(written).toHaveLength(0);
  });

  it('only the trainee\'s coach or a manager', async () => {
    denied = true;
    expect((await post({ fromClub: true, athleteId: TRAINEE, weekStart: '2026-10-18' })).status).toBe(403);
  });
});
