import { describe, it, expect } from 'vitest';
import type { ParsedWorkout } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { remapForAthlete, sessionSlot } from '@/lib/plans/push-selection';
import { withGroupPaces } from '@/lib/plans/watch-paces';

const session = (day: number, name: string, pace: number): ParsedWorkout => ({
  dayOfWeek: day, name,
  steps: [{ order: 1, type: 'active', durationType: 'time', durationValue: 1800, targetType: 'pace', targetPaceMinPerKm: pace, targetPaceMaxPerKm: pace, group2Pace: { min: pace + 10, max: pace + 10 }, group3Pace: { min: pace + 20, max: pace + 20 } }],
});
// The club's week as saved: Monday easy, Wednesday tempo.
const grouped = splitIntoGroups({ workouts: normalizeWorkoutParts({ workouts: [session(1, 'easy', 330), session(3, 'tempo', 255)] }).workouts });
const club = grouped.group2.workouts;

describe('a custom week keeps every session its own key', () => {
  const wed = club.find((w) => w.dayOfWeek === 3)!;
  const moved = remapForAthlete(club, { [sessionSlot(wed, club.indexOf(wed))]: 1 });
  const sent = normalizeWorkoutParts({ workouts: moved }).workouts; // what the push route does

  it("Wednesday's session moved to Monday is still Wednesday's session", () => {
    const tempo = sent.find((w) => w.name === 'tempo')!;
    expect(tempo.dayOfWeek).toBe(1);
    expect(tempo.workoutKey).toBe(wed.workoutKey);
  });

  it("Monday's own session keeps its key, though it now shares the day", () => {
    const mon = club.find((w) => w.dayOfWeek === 1)!;
    expect(sent.find((w) => w.name === 'easy')!.workoutKey).toBe(mon.workoutKey);
  });

  it('the moved session still gets every pack its pace on the watch', () => {
    const tempo = withGroupPaces(sent, grouped).find((w) => w.name === 'tempo')!;
    expect(tempo.steps[0].groupPaces).toEqual([{ min: 255, max: 255 }, { min: 265, max: 265 }, { min: 275, max: 275 }]);
  });

  it('a week with no custom days is untouched', () => {
    expect(remapForAthlete(club, {})).toEqual(club);
  });
});
