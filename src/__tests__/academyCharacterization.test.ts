import { describe, expect, it } from 'vitest';

import {
  DAY_LABELS,
  FIT_OPTIONS,
  GOAL_TYPES,
  characterizationComplete,
  characterizationIssues,
  emptyCharacterization,
  planInputsFrom,
  prPaceSec,
  readCharacterization,
  readWeekdays,
  weeksToRace,
  type Characterization,
} from '@/lib/academy/characterization';

/**
 * The characterization form is filled during a phone call and its answers become the first
 * training plan, so the wrong answers to guard are the ones nothing downstream contradicts: a
 * volume with a finger-slip in it, a race date in the wrong year, a day list that counts six
 * days when the coach picked five, and a half-filled form treated as an error while somebody
 * is still talking.
 */

const TODAY = '2026-09-19';

function filled(over: Partial<Characterization> = {}): Characterization {
  return {
    ...emptyCharacterization('c1'),
    goalType: 'half',
    weeklyKm: 35,
    availableDays: [0, 2, 4],
    fit: 'maybe',
    ...over,
  };
}

describe('reading the form', () => {
  it('takes a database row, snake_case and all', () => {
    const c = readCharacterization({
      candidate_id: 'c1',
      goal_type: 'full',
      target_race: 'טבריה',
      target_race_date: '2027-01-10',
      weekly_km: '35.0',
      years_running: '2',
      available_days: [2, 4, 6],
      limitations: 'דלקת בגיד אכילס לפני חצי שנה',
      watch: 'Garmin',
      pr_distance_m: 10000,
      pr_time_sec: 2910,
      fit: 'yes',
      recorded_by: 'ofer@madregot.app',
    });
    expect(c).toMatchObject({
      candidateId: 'c1',
      goalType: 'full',
      targetRaceDate: '2027-01-10',
      weeklyKm: 35,
      yearsRunning: 2,
      availableDays: [2, 4, 6],
      fit: 'yes',
    });
    expect(c.limitations).toBe('דלקת בגיד אכילס לפני חצי שנה');
  });

  it('reads an unrecognised goal or fit as no answer rather than trusting it', () => {
    // Neither column has a CHECK constraint — the choices are product and live in the module —
    // so this reader is the only thing between a typo in SQL and a blank chip on the card.
    const c = readCharacterization({ candidate_id: 'c1', goal_type: 'ultra', fit: 'probably' });
    expect(c.goalType).toBeNull();
    expect(c.fit).toBeNull();
  });

  it('treats a blank string as no answer', () => {
    const c = readCharacterization({ candidate_id: 'c1', limitations: '   ', watch: '', weekly_km: '' });
    expect(c.limitations).toBeNull();
    expect(c.watch).toBeNull();
    expect(c.weeklyKm).toBeNull();
  });

  it('drops half a personal best, because half a pair has no pace in it', () => {
    expect(readCharacterization({ candidate_id: 'c1', pr_distance_m: 10000 }).prDistanceM).toBeNull();
    expect(readCharacterization({ candidate_id: 'c1', pr_time_sec: 2910 }).prTimeSec).toBeNull();
  });

  it('cleans the day list: integers 0-6, deduplicated, ascending', () => {
    // Every one of these has a consequence. A duplicate makes a five-day week count as six;
    // `7` for Sunday (the ISO numbering) falls off the end of DAY_LABELS and renders blank;
    // an unsorted list puts Saturday's long run before Tuesday's intervals.
    expect(readWeekdays([6, 2, 2, 0])).toEqual([0, 2, 6]);
    expect(readWeekdays([7, -1, 3.5, 'x', null, 4])).toEqual([4]);
    expect(readWeekdays(null)).toEqual([]);
    expect(readWeekdays([0, 1, 2, 3, 4, 5, 6]).map(d => DAY_LABELS[d]).every(Boolean)).toBe(true);
  });
});

describe('what is wrong with the form', () => {
  it('reports an empty form as missing and never as an error', () => {
    // It is filled while the call is happening: incomplete is the normal state for twenty
    // minutes, and a screen shouting at the coach mid-conversation is the wrong screen.
    const issues = characterizationIssues(emptyCharacterization('c1'), TODAY);
    expect(issues.every(i => i.level === 'missing')).toBe(true);
    expect(issues.map(i => i.field)).toEqual(['goalType', 'availableDays', 'weeklyKm', 'fit']);
  });

  it('warns on a volume that looks like a finger-slip', () => {
    const issues = characterizationIssues(filled({ weeklyKm: 350 }), TODAY);
    expect(issues).toEqual([{ field: 'weeklyKm', level: 'warning', text: 'נפח שבועי לא סביר — אולי הקלדה' }]);
    // And says nothing about a real one, however low.
    expect(characterizationIssues(filled({ weeklyKm: 0 }), TODAY)).toEqual([]);
  });

  it('warns on twenty years of running typed for two', () => {
    expect(characterizationIssues(filled({ yearsRunning: 80 }), TODAY).map(i => i.field)).toEqual(['yearsRunning']);
    expect(characterizationIssues(filled({ yearsRunning: 2 }), TODAY)).toEqual([]);
  });

  it('warns when the target race has already been run', () => {
    // Almost always the year: `27` typed as `26` in January. Left uncaught it makes the weeks
    // available to build negative, and a plan built backwards from a past race has no long run.
    const issues = characterizationIssues(filled({ targetRace: 'טבריה', targetRaceDate: '2026-01-10' }), TODAY);
    expect(issues).toEqual([{ field: 'targetRaceDate', level: 'warning', text: 'תאריך התחרות כבר עבר' }]);
  });

  it('notices a race with no date, which otherwise looks answered', () => {
    const issues = characterizationIssues(filled({ targetRace: 'טבריה' }), TODAY);
    expect(issues).toEqual([{ field: 'targetRaceDate', level: 'missing', text: 'יש תחרות מטרה בלי תאריך' }]);
  });

  it('warns when the quoted best implies an impossible pace', () => {
    // The distance given in kilometres where metres were asked for: `10` and `48:30` is a pace
    // of eighty hours per kilometre, which is the shape of unit mistake this catches.
    const issues = characterizationIssues(filled({ prDistanceM: 10, prTimeSec: 2910 }), TODAY);
    expect(issues.map(i => i.field)).toEqual(['prTimeSec']);
    expect(characterizationIssues(filled({ prDistanceM: 10000, prTimeSec: 2910 }), TODAY)).toEqual([]);
    // And what it does NOT catch, recorded so nobody trusts it further than it goes: 48:30
    // typed as `4830` seconds is 8:03/km — slow, entirely possible, and indistinguishable
    // from a real answer. Only the coach's ear catches that one.
    expect(characterizationIssues(filled({ prDistanceM: 10000, prTimeSec: 4830 }), TODAY)).toEqual([]);
  });

  it('warns on a single training day without refusing it', () => {
    const issues = characterizationIssues(filled({ availableDays: [3] }), TODAY);
    expect(issues.map(i => i.level)).toEqual(['warning']);
  });

  it('says nothing about a blank limitations field', () => {
    // The common answer is "nothing hurts". Requiring it means a coach typing `אין` to get
    // past a form, which is a worse record than an empty field.
    expect(characterizationIssues(filled({ limitations: null }), TODAY)).toEqual([]);
  });
});

describe('closing the call', () => {
  it('needs the four answers something downstream reads', () => {
    expect(characterizationComplete(filled())).toBe(true);
    expect(characterizationComplete(filled({ goalType: null }))).toBe(false);
    expect(characterizationComplete(filled({ weeklyKm: null }))).toBe(false);
    expect(characterizationComplete(filled({ availableDays: [] }))).toBe(false);
    expect(characterizationComplete(filled({ fit: null }))).toBe(false);
  });

  it('is not blocked by a warning', () => {
    // A warning is an answer the coach gave and stands behind. Refusing to close the step over
    // one would leave a call that happened sitting open on the board forever.
    expect(characterizationComplete(filled({ weeklyKm: 350 }))).toBe(true);
    expect(characterizationComplete(filled({ availableDays: [3] }))).toBe(true);
  });

  it('does not need a race, a watch, a best or a limitation', () => {
    expect(characterizationComplete(filled({ goalType: 'fitness' }))).toBe(true);
  });
});

describe('weeks to the race', () => {
  it('floors, so three days out is this week', () => {
    expect(weeksToRace('2026-09-22', TODAY)).toBe(0);
    expect(weeksToRace('2026-09-26', TODAY)).toBe(1);
    expect(weeksToRace('2027-01-10', TODAY)).toBe(16);
  });

  it('is null for a race already run, and never a negative number', () => {
    // A caller that forgets to check the sign builds a taper backwards.
    expect(weeksToRace('2026-09-18', TODAY)).toBeNull();
    expect(weeksToRace(null, TODAY)).toBeNull();
  });

  it('is null for a date nothing can parse, rather than zero', () => {
    // Zero is the one wrong answer that reads as a real one: "the race is this week".
    expect(weeksToRace('10.01.27', TODAY)).toBeNull();
    expect(weeksToRace('2027-01', TODAY)).toBeNull();
  });

  it('accepts an ISO instant as today, like every other academy module', () => {
    expect(weeksToRace('2026-09-26', '2026-09-19T09:00:00.000Z')).toBe(1);
  });
});

describe('what the plan composer gets', () => {
  it('hands over the days, the volume, the limitation and the weeks', () => {
    const inputs = planInputsFrom(
      filled({
        targetRace: 'טבריה',
        targetRaceDate: '2027-01-10',
        limitations: 'אכילס',
        prDistanceM: 10000,
        prTimeSec: 2910,
      }),
      TODAY,
    );
    expect(inputs).toMatchObject({
      availableDays: [0, 2, 4],
      daysPerWeek: 3,
      weeklyKm: 35,
      limitation: 'אכילס',
      weeksToRace: 16,
      ready: true,
    });
    expect(inputs.prPaceSec).toBe(291);
    expect(inputs.missing).toEqual([]);
  });

  it('is not ready without the two things a week cannot be invented from', () => {
    expect(planInputsFrom(filled({ availableDays: [] }), TODAY).ready).toBe(false);
    expect(planInputsFrom(filled({ weeklyKm: null }), TODAY).ready).toBe(false);
    // A missing goal or fit verdict does not stop a week from being built.
    expect(planInputsFrom(filled({ goalType: null, fit: null }), TODAY).ready).toBe(true);
  });

  it('names what is missing, so the composer can say so instead of building an empty week', () => {
    const inputs = planInputsFrom(emptyCharacterization('c1'), TODAY);
    expect(inputs.ready).toBe(false);
    expect(inputs.daysPerWeek).toBe(0);
    expect(inputs.missing).toContain('availableDays');
    expect(inputs.missing).toContain('weeklyKm');
  });

  it('carries no pace when no best was quoted', () => {
    expect(planInputsFrom(filled(), TODAY).prPaceSec).toBeNull();
    expect(prPaceSec({ prDistanceM: 0, prTimeSec: 100 })).toBeNull();
  });
});

describe('the choices themselves', () => {
  it('offers the four goals the academy sells and keeps בספק as its own answer', () => {
    expect(GOAL_TYPES.map(g => g.value)).toEqual(['half', 'full', '10k', 'fitness']);
    // A two-way control would force the most common verdict after a first call into yes or no.
    expect(FIT_OPTIONS.map(f => f.value)).toEqual(['yes', 'maybe', 'no']);
  });

  it('labels the week from Sunday, the way the app’s week runs', () => {
    expect(DAY_LABELS).toHaveLength(7);
    expect(DAY_LABELS[0]).toBe('א׳');
    expect(DAY_LABELS[6]).toBe('ש׳');
  });
});
