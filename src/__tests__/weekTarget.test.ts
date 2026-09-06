import { describe, it, expect } from 'vitest';
import {
  weekTargetRange,
  weekTargetState,
  weekTargetProgressPct,
  weekTargetFloorPct,
  dayTargetLabel,
} from '@/lib/plans/week-target';
import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';

// The weekly target is a band: prescribed sessions at their short end up to
// everything on offer at its long end. These cases pin the two ways that goes
// wrong — a floor of zero (everyone is instantly "on plan") and a floor that
// counts the optional evening sessions (nobody ever is).

describe('weekTargetRange', () => {
  it('runs from the prescribed minimum to the full maximum', () => {
    const target = weekTargetRange({
      hasPlan: true,
      weekRequiredMin: 100,
      weekRequiredMax: 115,
      weekTotalMin: 118,
      weekTotalMax: 146.3,
    });
    expect(target).toEqual({ min: 100, max: 146.3 });
  });

  it('returns null with no plan for the week', () => {
    // `/api/plans/week` reports hasPlan:false rather than substituting another
    // week, so there is genuinely nothing to measure against.
    expect(weekTargetRange({ hasPlan: false })).toBeNull();
    expect(weekTargetRange(null)).toBeNull();
    expect(weekTargetRange(undefined)).toBeNull();
  });

  it('returns null for a plan whose sessions carry no distance', () => {
    // A plan of drills and strength work has no kilometres in it; a bar against
    // 0 km would divide by zero and read as 100% done.
    expect(weekTargetRange({ hasPlan: true, weekTotalMin: 0, weekTotalMax: 0 })).toBeNull();
  });

  it('falls back to the plain minimum on a plan stored before the split existed', () => {
    // `weekRequiredMin` is absent on older `parsed_workouts`. Falling through to
    // 0 would put every athlete inside the band from their first kilometre.
    expect(weekTargetRange({ hasPlan: true, weekTotalMin: 90, weekTotalMax: 120 })).toEqual({
      min: 90,
      max: 120,
    });
  });

  it('falls back when every session in the week is marked optional', () => {
    expect(
      weekTargetRange({ hasPlan: true, weekRequiredMin: 0, weekTotalMin: 40, weekTotalMax: 60 }),
    ).toEqual({ min: 40, max: 60 });
  });

  it('clamps a floor that sits above the ceiling instead of drawing backwards', () => {
    expect(weekTargetRange({ hasPlan: true, weekRequiredMin: 80, weekTotalMax: 60 })).toEqual({
      min: 60,
      max: 60,
    });
  });

  it('rounds the float dust off both ends', () => {
    // 11 + 2.4 summed to 13.400000000000006 upstream and printed every digit.
    const target = weekTargetRange({
      hasPlan: true,
      weekRequiredMin: 13.400000000000006,
      weekTotalMax: 20.700000000000003,
    });
    expect(target).toEqual({ min: 13.4, max: 20.7 });
  });
});

describe('weekTargetState', () => {
  const target = { min: 100, max: 146.3 };

  it('is below the band before the floor', () => {
    expect(weekTargetState(25.6, target)).toBe('below');
    expect(weekTargetState(99.9, target)).toBe('below');
  });

  it('counts hitting the floor exactly as on plan', () => {
    // The floor is already the week with every optional session skipped and
    // every span at its short end — landing on it is not "nearly".
    expect(weekTargetState(100, target)).toBe('in');
  });

  it('is in the band anywhere between the ends', () => {
    expect(weekTargetState(120, target)).toBe('in');
    expect(weekTargetState(146.3, target)).toBe('in');
  });

  it('is above only past the ceiling', () => {
    expect(weekTargetState(150, target)).toBe('above');
  });
});

describe('weekTargetProgressPct', () => {
  const target = { min: 100, max: 150 };

  it('measures the fill against the ceiling', () => {
    expect(weekTargetProgressPct(75, target)).toBe(50);
  });

  it('caps at 100 rather than overflowing the track', () => {
    expect(weekTargetProgressPct(200, target)).toBe(100);
  });

  it('floors at 0 rather than drawing a negative width', () => {
    expect(weekTargetProgressPct(-5, target)).toBe(0);
  });

  it('places the floor marker proportionally', () => {
    expect(weekTargetFloorPct(target)).toBe(67);
  });
});

describe('dayTargetLabel', () => {
  it('leaves the offered session out of the number and flags it instead', () => {
    // The live Tuesday: a 23.6–24.5 morning plus a 15.8–16.6 optional evening.
    // Summed it printed "39.4–41.1", which nobody runs and which contradicted
    // the week band on the same screen.
    expect(
      dayTargetLabel({
        min: 39.4,
        max: 41.1,
        requiredMin: 23.6,
        requiredMax: 24.5,
        sessions: [{ optional: false }, { optional: true }],
      }),
    ).toEqual({ km: '23.6–24.5', hasOptional: true });
  });

  it('prints one number when the day has no span', () => {
    expect(dayTargetLabel({ min: 32, max: 32, requiredMin: 32, requiredMax: 32, sessions: [{}] })).toEqual({
      km: '32',
      hasOptional: false,
    });
  });

  it('falls back to the plain totals on a day stored before the split existed', () => {
    expect(dayTargetLabel({ min: 13, max: 17 })).toEqual({ km: '13–17', hasOptional: false });
  });

  it('rounds the float dust the summing leaves behind', () => {
    // 11 + 2.4 arrives as 13.400000000000006 and overflowed the tile's width.
    expect(dayTargetLabel({ min: 11, max: 13.400000000000006 }).km).toBe('11–13.4');
  });

  it('reports an empty rest day as a plain zero', () => {
    expect(dayTargetLabel({ min: 0, max: 0, requiredMin: 0, requiredMax: 0, sessions: [] })).toEqual({
      km: '0',
      hasOptional: false,
    });
  });
});

describe('the range against a real published week', () => {
  // Sunday 23–24, Monday 11–13 plus an optional evening, Tuesday morning plus an
  // optional evening — the shape of every week in this club's plan.
  const plan = {
    workouts: [
      { dayOfWeek: 0, name: 'יום ראשון', distanceMinKm: 23, distanceMaxKm: 24, steps: [] },
      { dayOfWeek: 1, name: 'יום שני', distanceMinKm: 11, distanceMaxKm: 13, steps: [] },
      { dayOfWeek: 1, name: 'יום שני - ערב אופציה', distanceMinKm: 8, distanceMaxKm: 10, steps: [] },
    ],
  };

  it('leaves the optional evening out of the floor and keeps it in the ceiling', () => {
    const b = buildWeekBreakdown(plan);
    expect(b.weekRequiredMin).toBe(34); // 23 + 11
    expect(b.weekRequiredMax).toBe(37); // 24 + 13
    expect(b.weekTotalMax).toBe(47); // + the offered 10
    expect(weekTargetRange({ hasPlan: true, ...b })).toEqual({ min: 34, max: 47 });
  });

  it('recognises the optional session from its name alone', () => {
    // Plans written before normalization moved onto the write path have no
    // `optional` flag at all — only "אופציה" in the session's name.
    const b = buildWeekBreakdown(plan);
    const monday = b.dailyDistances.find((d) => d.dayOfWeek === 1)!;
    expect(monday.sessions.map((s) => s.optional)).toEqual([false, true]);
    expect(monday.requiredMax).toBe(13);
    expect(monday.max).toBe(23);
  });
});
