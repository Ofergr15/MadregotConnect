import { describe, expect, it } from 'vitest';
import type { ParsedWorkout } from '@/lib/ai/types';
import { dayCards, type DayCardsInput } from '@/lib/academy/day-cards';
import { plannedLoad, plannedTotals } from '@/lib/academy/load';

/**
 * lib/academy/day-cards.ts — the planned day as the card the home draws, shared by
 * /api/academy/today and the morning reminder. Whose plan (own row over the club's,
 * never another trainee's), whose paces (a club week restated from its lane), optional
 * sessions never the main one, and rest days with no card at all.
 */

const ME = 'me';
const WEEK = '2026-10-11'; // Sunday
const TUE = '2026-10-13';
const WED = '2026-10-14';
const pace = (sec: number) => ({ targetType: 'pace' as const, targetPaceMinPerKm: sec, targetPaceMaxPerKm: sec });
const reps = (day: number, repSec: number, extra: Partial<ParsedWorkout> = {}): ParsedWorkout => ({
  dayOfWeek: day, name: 'שלישי',
  steps: [
    { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, ...pace(340) },
    {
      order: 2, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 5,
      repeatSteps: [
        { order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, ...pace(repSec) },
        { order: 2, type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' },
      ],
    },
    { order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, ...pace(340) },
  ],
  ...extra,
});
const LANES = { 1: 230, 2: 250, 3: 270, 4: 290 } as const;
const TEST = [{ date: '2026-09-16', thresholdSec: 252 }];

const input = (planRows: DayCardsInput['planRows'], over: Partial<DayCardsInput> = {}): DayCardsInput => ({
  dates: [TUE, WED],
  athleteId: ME,
  groupId: null,
  planRows,
  groupNames: new Map(),
  laneRefs: LANES,
  tests: TEST,
  onWatch: new Set([TUE]),
  doneOn: () => false,
  ...over,
});

describe('dayCards', () => {
  it('the trainee\'s own row is drawn and priced as stored', () => {
    const own = { week_start_date: WEEK, athlete_id: ME, parsed_workouts: { workouts: [reps(2, 245)] }, created_at: '2026-10-10' };
    const { cards, planWeeks } = dayCards(input([own]));
    expect(planWeeks[WEEK]).toBe(true);
    expect(cards[TUE]).toMatchObject({ title: '5 × 1 ק״מ', paceSec: 245, paceOf: 'reps', kind: 'quality', onWatch: true, done: false });
    const steps = reps(2, 245).steps;
    expect(cards[TUE].expectedLoad).toBe(Math.round(plannedLoad(steps, 252)));
    expect(cards[TUE].durationSec).toBe(plannedTotals(steps).durationSec);
    // Wednesday has no session: no card (a rest day), the week still has a plan.
    expect(cards[WED]).toBeUndefined();
  });

  it('own row over the club\'s, and never another trainee\'s', () => {
    const club = { week_start_date: WEEK, athlete_id: null, parsed_workouts: { workouts: [reps(2, 200)] }, created_at: '2026-10-09' };
    const stranger = { week_start_date: WEEK, athlete_id: 'other', parsed_workouts: { workouts: [reps(2, 300)] }, created_at: '2026-10-11' };
    const own = { week_start_date: WEEK, athlete_id: ME, parsed_workouts: { workouts: [reps(2, 245)] }, created_at: '2026-10-10' };
    expect(dayCards(input([club, stranger, own])).cards[TUE].paceSec).toBe(245);
  });

  it('a club week is the lane\'s session restated to the trainee: drawn and priced at their paces', () => {
    // Unified club plan → lane 1 (230). The trainee's 252 makes the lane's 3:50 reps 4:12.
    const club = { week_start_date: WEEK, athlete_id: null, parsed_workouts: { workouts: [reps(2, 230)] }, created_at: '2026-10-09' };
    const card = dayCards(input([club])).cards[TUE];
    expect(card.paceSec).toBe(252);
    const asIfOwn = dayCards(input([{ ...club, athlete_id: ME, parsed_workouts: { workouts: [reps(2, 252)] } }])).cards[TUE];
    expect(Math.abs((card.expectedLoad ?? 0) - (asIfOwn.expectedLoad ?? 0))).toBeLessThanOrEqual(1);
  });

  it('an optional session is never the day\'s card', () => {
    const own = { week_start_date: WEEK, athlete_id: ME, parsed_workouts: { workouts: [reps(2, 245, { optional: true }), reps(3, 245)] }, created_at: '2026-10-10' };
    const { cards } = dayCards(input([own]));
    expect(cards[TUE]).toBeUndefined();
    expect(cards[WED]).toBeDefined();
  });

  it('no plan row for the week: no card and no plan', () => {
    const { cards, planWeeks } = dayCards(input([]));
    expect(cards).toEqual({});
    expect(planWeeks[WEEK]).toBe(false);
  });

  it('without a test there is no ⚡ and the steps are drawn as stored', () => {
    const own = { week_start_date: WEEK, athlete_id: ME, parsed_workouts: { workouts: [reps(2, 245)] }, created_at: '2026-10-10' };
    const card = dayCards(input([own], { tests: [] })).cards[TUE];
    expect(card.expectedLoad).toBeNull();
    expect(card.paceSec).toBe(245);
  });
});
