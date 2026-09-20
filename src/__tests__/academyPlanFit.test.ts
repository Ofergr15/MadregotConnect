import { describe, expect, it } from 'vitest';
import {
  MAX_WEEKLY_JUMP, raceCountdown, weekFit,
  type FitRecipient, type PlannedDay,
} from '@/lib/academy/plan-fit';
import type { PlanInputs } from '@/lib/academy/characterization';

/**
 * The characterization answers against the week being built.
 *
 * Every finding here is advisory, so the tests are almost entirely about when the module must
 * stay QUIET. A false warning on this screen is expensive in a specific way: the coach builds a
 * week here every week, and the second time a box is wrong they stop reading the box — including
 * the time it is right about somebody's knee.
 */

function inputs(over: Partial<PlanInputs> = {}): PlanInputs {
  return {
    goalType: 'half',
    availableDays: [0, 2, 4],
    daysPerWeek: 3,
    weeklyKm: 30,
    limitation: null,
    targetRaceDate: null,
    weeksToRace: null,
    prPaceSec: null,
    ready: true,
    missing: [],
    ...over,
  };
}

const withInputs = (name: string, over: Partial<PlanInputs> = {}): FitRecipient =>
  ({ athleteId: name.toLowerCase(), name, inputs: inputs(over) });

const days = (spec: Array<[number, number | null]>): PlannedDay[] =>
  spec.map(([dayOfWeek, km]) => ({ dayOfWeek, km }));

describe('a day the trainee said they do not train on', () => {
  it('is named, on the day, with whoever said it', () => {
    const fit = weekFit({
      days: days([[0, 8], [1, 10], [4, 12]]),
      recipients: [withInputs('Dor'), withInputs('Noa', { availableDays: [0, 1, 4] })],
    });
    // Monday: Dor offered Sun/Tue/Thu, Noa offered Sun/Mon/Thu. Only Dor clashes.
    expect(fit.clashes).toEqual([{ dayOfWeek: 1, names: ['Dor'] }]);
  });

  it('does not clash with a day nobody planned', () => {
    // Tuesday is in nobody's week, so the fact that Noa cannot run it is not a finding.
    const fit = weekFit({
      days: days([[0, 8]]),
      recipients: [withInputs('Noa', { availableDays: [0] })],
    });
    expect(fit.clashes).toEqual([]);
  });

  it('says nothing at all about somebody with no answers on file', () => {
    // The whole roster predates the characterization form. "No row" must not become "trains
    // every day" or "trains no days" — both are inventions, and one of them clashes with every
    // day of the week at once.
    const fit = weekFit({
      days: days([[1, 10], [3, 10]]),
      recipients: [{ athleteId: 'x', name: 'Uri', inputs: null }],
    });
    expect(fit.clashes).toEqual([]);
    expect(fit.anything).toBe(false);
    expect(fit.uncharacterised).toEqual(['Uri']);
  });

  it('treats a row whose days question was never reached the same as no row', () => {
    // The form saves itself from the first keystroke during a twenty-minute call, so a row with
    // an empty `availableDays` is a call in progress, not an answer of "no days".
    const fit = weekFit({
      days: days([[1, 10]]),
      recipients: [withInputs('Half', { availableDays: [] })],
    });
    expect(fit.clashes).toEqual([]);
    expect(fit.uncharacterised).toEqual(['Half']);
  });
});

describe('the volume the week adds up to', () => {
  it('flags a week well above what they said they run', () => {
    const fit = weekFit({
      days: days([[0, 10], [2, 14], [4, 22]]),
      recipients: [withInputs('Dor', { weeklyKm: 30 })],
    });
    expect(fit.plannedKm).toBe(46);
    expect(fit.jumps).toHaveLength(1);
    expect(fit.jumps[0]).toMatchObject({ name: 'Dor', currentKm: 30, plannedKm: 46, partial: false });
    expect(fit.jumps[0].jump).toBeCloseTo(0.53, 2);
  });

  it('stays quiet about the build-up the academy actually writes', () => {
    // 25 → 32 is how a first month is supposed to look. A 10%-per-week rule would warn here and
    // therefore warn on nearly every week, which is the same as not warning at all.
    const fit = weekFit({
      days: days([[0, 10], [2, 10], [4, 12]]),
      recipients: [withInputs('Dor', { weeklyKm: 25 })],
    });
    expect(fit.jumps).toEqual([]);
    expect(32 / 25 - 1).toBeLessThan(MAX_WEEKLY_JUMP);
  });

  it('claims a floor rather than a total when a day has no distance in it', () => {
    // A book entry written purely in minutes. Unknown days can only make the week bigger, so a
    // FLOOR already past the threshold is a sound warning — and it says "at least".
    const fit = weekFit({
      days: days([[0, 20], [2, 20], [4, null]]),
      recipients: [withInputs('Dor', { weeklyKm: 25 })],
    });
    expect(fit.plannedKm).toBe(40);
    expect(fit.plannedKmPartial).toBe(true);
    expect(fit.jumps[0]).toMatchObject({ partial: true, plannedKm: 40 });
  });

  it('does not warn on a floor that has not passed the threshold, however much is missing', () => {
    // The opposite direction of the same rule: two unknown days could be anything, and a
    // warning here would be a guess about sessions the module cannot read.
    const fit = weekFit({
      days: days([[0, 10], [2, null], [4, null]]),
      recipients: [withInputs('Dor', { weeklyKm: 30 })],
    });
    expect(fit.jumps).toEqual([]);
  });

  it('says nothing when the whole week is unreadable', () => {
    const fit = weekFit({
      days: days([[0, null], [2, null]]),
      recipients: [withInputs('Dor', { weeklyKm: 30 })],
    });
    expect(fit.plannedKm).toBeNull();
    expect(fit.jumps).toEqual([]);
  });

  it('refuses to turn "never answered" or zero into a percentage', () => {
    // A ratio against nothing is infinite, and "+∞% more than he runs now" beside a name is not
    // something a coach can act on. The missing answer is the characterization screen's sentence
    // to say, not this one's.
    const fit = weekFit({
      days: days([[0, 20], [2, 20]]),
      recipients: [
        withInputs('NoVolume', { weeklyKm: null }),
        withInputs('Zero', { weeklyKm: 0 }),
      ],
    });
    expect(fit.jumps).toEqual([]);
  });

  it('puts the biggest jump first, because that is the one worth a second look', () => {
    const fit = weekFit({
      days: days([[0, 20], [2, 20]]),
      recipients: [withInputs('Mild', { weeklyKm: 28 }), withInputs('Steep', { weeklyKm: 12 })],
    });
    expect(fit.jumps.map(j => j.name)).toEqual(['Steep', 'Mild']);
  });
});

describe('the limitation sentence', () => {
  it('travels verbatim, per recipient', () => {
    const text = 'פציעת גב תחתון — בלי מהירות עד סוף החודש';
    const fit = weekFit({
      days: days([[0, 10]]),
      recipients: [withInputs('Dor', { limitation: text }), withInputs('Noa')],
    });
    expect(fit.limitations).toEqual([{ athleteId: 'dor', name: 'Dor', text }]);
    expect(fit.anything).toBe(true);
  });

  it('is the one finding that does not need the week to have anything in it', () => {
    // Somebody's injury is worth reading before the first workout is written, not after.
    const fit = weekFit({ days: [], recipients: [withInputs('Dor', { limitation: 'ברך' })] });
    expect(fit.limitations).toHaveLength(1);
    expect(fit.anything).toBe(true);
  });
});

describe('days offered and left empty', () => {
  it('reports the primary recipient only', () => {
    // With several recipients there is no single answer to "which days are unused", and the board
    // is seeded from the primary's own saved week.
    const fit = weekFit({
      days: days([[0, 10]]),
      recipients: [
        withInputs('Dor', { availableDays: [0, 2, 4] }),
        withInputs('Noa', { availableDays: [1, 3, 5] }),
      ],
      primaryId: 'dor',
    });
    expect(fit.unusedDays).toEqual([2, 4]);
  });

  it('reports nothing when no primary was named', () => {
    const fit = weekFit({ days: days([[0, 10]]), recipients: [withInputs('Dor')] });
    expect(fit.unusedDays).toEqual([]);
  });
});

describe('whether the strip appears at all', () => {
  it('an uncharacterised club produces a completely silent screen', () => {
    // `uncharacterised` on its own is deliberately not enough to open the box: a note explaining
    // that it has nothing to say, on every week, forever, is worse than no box.
    const fit = weekFit({
      days: days([[0, 10], [2, 10]]),
      recipients: [
        { athleteId: 'a', name: 'A', inputs: null },
        { athleteId: 'b', name: 'B', inputs: null },
      ],
    });
    expect(fit.anything).toBe(false);
    expect(fit.uncharacterised).toEqual(['A', 'B']);
  });

  it('a week that matches the answers is also silent', () => {
    const fit = weekFit({
      days: days([[0, 10], [2, 10], [4, 10]]),
      recipients: [withInputs('Dor', { availableDays: [0, 2, 4], weeklyKm: 30 })],
      primaryId: 'dor',
    });
    expect(fit).toMatchObject({ clashes: [], jumps: [], limitations: [], unusedDays: [], anything: false });
    expect(fit.plannedDays).toBe(3);
  });
});

describe('the race countdown', () => {
  it('is shown when there is a race still ahead', () => {
    expect(raceCountdown(inputs({ targetRaceDate: '2026-12-05', weeksToRace: 11 })))
      .toEqual({ weeks: 11, date: '2026-12-05' });
  });

  it('is nothing once the race has been run, or when there is no race', () => {
    // A negative countdown on the board would have the coach building towards a date in the past.
    expect(raceCountdown(inputs({ targetRaceDate: '2026-01-01', weeksToRace: -3 }))).toBeNull();
    expect(raceCountdown(inputs({ targetRaceDate: null, weeksToRace: null }))).toBeNull();
    expect(raceCountdown(null)).toBeNull();
  });

  it('survives race week, which is a real week to build', () => {
    expect(raceCountdown(inputs({ targetRaceDate: '2026-09-26', weeksToRace: 0 })))
      .toMatchObject({ weeks: 0 });
  });
});
