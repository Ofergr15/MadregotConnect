import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaceSession } from '@/lib/academy/coach-tools';
import type { ReadinessInputs } from '@/lib/academy/readiness-board';
import type { ReadinessRead } from '@/lib/academy/readiness-server';

/**
 * The shipped pace suggestion behind the readiness gate (coach-tools-build.ts): a trainee
 * who is very tired, has the 3-morning RHR flag, reported pain this week or felt weak over
 * the last 4 runs is NOT in "מחכה לך" (`pace`) — they are in `paused`, with the reasons.
 * Everyone else keeps the suggestion with `readiness` attached (C2's sentence). A trainee
 * the engine is still learning is never paused on form.
 */

const IDS = ['tired', 'rhr', 'pain', 'feel', 'ok', 'learning'];

vi.mock('@/lib/academy/book-server', () => ({
  loadTrainees: async (_: unknown, ids: string[]) => ids.map(id => ({ id, name: `${id} Trainee`, isAcademy: true, active: true, bandNumber: 4, hasGarmin: true })),
  loadTraineeWeeks: async () => ({}),
}));

// Five reps sessions all 7 s/km faster than planned at a flat HR: a pace-up for everyone.
const faster: PaceSession[] = ['2026-09-20', '2026-09-23', '2026-09-27', '2026-09-30', '2026-10-04']
  .map(date => ({ date, kind: 'reps', plannedSec: 245, actualSec: 238, avgHr: 166 }));
const snoozed = new Set<string>();
vi.mock('@/lib/academy/coach-tools-server', () => ({
  loadTestBasis: async (_: unknown, ids: string[]) => Object.fromEntries(ids.map(id => [id, { testDate: '2026-09-16', thresholdSec: 252 }])),
  loadDecisions: async () => ({
    stored: true,
    rows: [...snoozed].map(id => ({ athleteId: id, kind: 'pace', action: 'snooze', basisTestDate: '2026-09-16', createdAt: new Date().toISOString(), weekStart: null, changes: null })),
  }),
  loadNotes: async () => ({}),
  loadEvidence: async (_: unknown, ids: string[]) => Object.fromEntries(ids.map(id => [id, { weeks: [], paceSessions: faster }])),
}));

const ok: ReadinessInputs = {
  status: { kind: 'ok' }, pmcToday: { fitness: 47, fatigue: 56, form: -9, ramp: 1 }, bandKey: 'maintain', rampWordKey: 'maintaining',
  heavyLastWeek: true, spark: [40, 47], rhr: { range: { lo: 46, hi: 50 }, today: 51, isToday: true, streak: { flag: false, aboveRun: 1 } },
  sleep: { last: 25920, range: { lo: 24000, hi: 28200 } }, pain7: false, feelAvg4: 3, feelFace: 3, effortAvg4: 6.5, feelN: 4,
  raceDays: null, raceName: null, daysSinceRun: 0, prToday: null, gate: { paused: false, reasons: [] },
};
const READS: Record<string, ReadinessInputs> = {
  tired: { ...ok, pmcToday: { ...ok.pmcToday!, form: -32 }, bandKey: 'veryTired', gate: { paused: true, reasons: ['veryTired'] } },
  rhr: { ...ok, rhr: { ...ok.rhr, streak: { flag: true, aboveRun: 3 } }, gate: { paused: true, reasons: ['rhr'] } },
  pain: { ...ok, pain7: true, gate: { paused: true, reasons: ['pain'] } },
  feel: { ...ok, feelAvg4: 1, feelFace: 1, gate: { paused: true, reasons: ['feel'] } },
  ok,
  // Learning: the gate itself never names form (readiness.ts), so a −45 here pauses nothing.
  learning: { ...ok, status: { kind: 'learning', daysLeft: 20, daysSeen: 22 }, pmcToday: null, bandKey: null, gate: { paused: false, reasons: [] } },
};
const loadReadinessInputs = vi.fn(async (_db: unknown, ids: string[], _today: string, _opts?: { write?: boolean }) =>
  Object.fromEntries(ids.map(id => [id, { inputs: READS[id], series: [], rows: [], name: `${id} Trainee`, gender: 'male', isAcademy: true, active: true } satisfies ReadinessRead])));
vi.mock('@/lib/academy/readiness-server', () => ({ loadReadinessInputs: (...a: Parameters<typeof loadReadinessInputs>) => loadReadinessInputs(...a) }));

const { buildCoachTools } = await import('@/lib/academy/coach-tools-build');
const NOW = new Date('2026-10-13T17:15:00Z');

beforeEach(() => {
  loadReadinessInputs.mockClear();
  snoozed.clear();
});

describe('the readiness gate on the pace suggestion', () => {
  it.each([
    ['tired', ['veryTired']], ['rhr', ['rhr']], ['pain', ['pain']], ['feel', ['feel']],
  ])('%s → out of "מחכה לך", listed as paused', async (id, reasons) => {
    const r = await buildCoachTools({} as never, IDS, { now: NOW, withMissedKm: false });
    expect(r.pace.map(p => p.athleteId)).not.toContain(id);
    expect(r.paused).toContainEqual({ athleteId: id, name: `${id} Trainee`, reasons });
  });

  it('an ok trainee keeps the suggestion, with the readiness C2 prints', async () => {
    const r = await buildCoachTools({} as never, IDS, { now: NOW, withMissedKm: false });
    const sug = r.pace.find(p => p.athleteId === 'ok')!;
    expect(sug.kinds[0]).toMatchObject({ kind: 'reps', direction: 'faster' });
    expect(sug.readiness).toEqual({
      form: -9, bandKey: 'maintain', rhrFlag: false, rhrKnown: true, pain: false, feelKey: 'trainee.feel.faces.3', gender: 'male',
    });
  });

  it('a trainee still being learned is never paused on form', async () => {
    const r = await buildCoachTools({} as never, IDS, { now: NOW, withMissedKm: false });
    expect(r.pace.find(p => p.athleteId === 'learning')?.readiness).toMatchObject({ form: null, bandKey: null });
    expect(r.paused?.map(p => p.athleteId)).not.toContain('learning');
  });

  it('reads readiness once, only for the trainees with a suggestion, and passes view-as through', async () => {
    await buildCoachTools({} as never, IDS, { now: NOW, withMissedKm: false, write: false });
    expect(loadReadinessInputs).toHaveBeenCalledTimes(1);
    expect(loadReadinessInputs.mock.calls[0][1].sort()).toEqual([...IDS].sort());
    expect(loadReadinessInputs.mock.calls[0][3]).toEqual({ write: false });
  });

  it('uses readiness the caller already read (C2), reading nothing more', async () => {
    const pre = await loadReadinessInputs({}, ['tired'], '2026-10-13');
    loadReadinessInputs.mockClear();
    const r = await buildCoachTools({} as never, ['tired'], { now: NOW, withMissedKm: false, readiness: pre });
    expect(loadReadinessInputs).not.toHaveBeenCalled();
    expect(r.paused).toEqual([{ athleteId: 'tired', name: 'tired Trainee', reasons: ['veryTired'] }]);
  });

  it('the gate comes before the snooze: a held suggestion is listed as held either way', async () => {
    snoozed.add('pain');
    snoozed.add('ok');
    const r = await buildCoachTools({} as never, IDS, { now: NOW, withMissedKm: false });
    expect(r.paused?.map(p => p.athleteId)).toContain('pain');
    expect(r.pace.map(p => p.athleteId)).not.toContain('ok');
  });
});
