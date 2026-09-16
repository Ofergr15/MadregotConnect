import { describe, it, expect } from 'vitest';
import {
  assessHr,
  flattenPlannedSteps,
  hrTargetOf,
  matchLapsToSteps,
  resolveHrBand,
  type Lap,
} from '@/lib/academy/segments';
import {
  EXECUTION_LABELS,
  NOTE_MAX,
  deviationOf,
  emptyFeedback,
  renderFeedbackHebrew,
  suggestExecutionTags,
  validateFeedback,
} from '@/lib/academy/feedback';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// Two things are under test here, and they are the two halves of one requirement:
// a workout is judged on the metric the COACH WROTE IT IN (an HR session graded on
// pace calls a wrong-effort run perfect), and the feedback a mentor sends is
// generated from a closed vocabulary rather than typed.

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1,
    type: 'active',
    durationType: 'distance',
    durationValue: 1000,
    targetType: 'no_target',
    ...over,
  } as WorkoutStep;
}

function workout(steps: WorkoutStep[]): ParsedWorkout {
  return { name: 'W', dayOfWeek: 0, steps } as ParsedWorkout;
}

function lap(distance: number, duration: number, hr?: number): Lap {
  return { distance, duration, averagePace: Math.round(duration / (distance / 1000)), averageHR: hr ?? null };
}

/** 4 × 1000 m written the way Ofer writes an aerobic session: "דופק 150". */
function hrSession(): ParsedWorkout {
  return workout([
    step({
      durationType: 'open',
      repeatCount: 4,
      repeatSteps: [step({ type: 'interval', targetType: 'heart_rate', targetHrMinPct: 150, targetHrMaxPct: 150 })],
    }),
  ]);
}

/** The same session written in pace instead. */
function paceSession(reps = 4): ParsedWorkout {
  return workout([
    step({
      durationType: 'open',
      repeatCount: reps,
      repeatSteps: [
        step({ type: 'interval', targetType: 'pace', targetPaceMinPerKm: 240, targetPaceMaxPerKm: 240 }),
      ],
    }),
  ]);
}

describe('hrTargetOf — bpm or percent', () => {
  it('reads a number over 100 as bpm', () => {
    expect(hrTargetOf(step({ targetHrMinPct: 150 }))).toEqual({ kind: 'bpm', min: 150, max: 150 });
  });

  it('reads a number at or under 100 as a percentage', () => {
    expect(hrTargetOf(step({ targetHrMinPct: 75, targetHrMaxPct: 80 }))).toEqual({ kind: 'pct', min: 75, max: 80 });
    // 100 is the one ambiguous value and must read as a percentage: a percentage
    // without an anchor fails loudly, whereas grading 100 bpm would call a hard
    // session easy and say nothing.
    expect(hrTargetOf(step({ targetHrMinPct: 100 }))?.kind).toBe('pct');
  });

  it('is absent when the coach wrote no HR', () => {
    expect(hrTargetOf(step())).toBeUndefined();
  });
});

describe('resolveHrBand', () => {
  it('passes bpm straight through', () => {
    expect(resolveHrBand({ kind: 'bpm', min: 148, max: 152 })).toEqual({ min: 148, max: 152 });
  });

  it('converts a percentage against the athlete anchor', () => {
    expect(resolveHrBand({ kind: 'pct', min: 75, max: 80 }, 190)).toEqual({ min: 143, max: 152 });
  });

  it('refuses to invent an anchor', () => {
    expect(resolveHrBand({ kind: 'pct', min: 75, max: 80 })).toBeNull();
    expect(resolveHrBand({ kind: 'pct', min: 75, max: 80 }, 0)).toBeNull();
  });
});

describe('assessHr — direction is effort, not number', () => {
  it('calls a heart rate above the band "faster" (worked harder than asked)', () => {
    expect(assessHr(168, 150, 150, 5)).toBe('faster');
  });

  it('calls a heart rate below the band "slower"', () => {
    expect(assessHr(138, 150, 150, 5)).toBe('slower');
  });

  it('forgives the tolerance', () => {
    expect(assessHr(154, 150, 150, 5)).toBe('on_target');
    expect(assessHr(146, 150, 150, 5)).toBe('on_target');
  });
});

describe('matchLapsToSteps — the metric follows the plan', () => {
  it('grades an HR plan on heart rate, and a good pace at the wrong HR fails', () => {
    const flat = flattenPlannedSteps(hrSession());
    // Every rep run at a lovely 4:00/km but at HR 168 — 18 beats over what was asked.
    const laps = [lap(1000, 240, 168), lap(1000, 240, 168), lap(1000, 240, 169), lap(1000, 241, 170)];
    const report = matchLapsToSteps(flat, laps);

    expect(report.aligned).toBe(true);
    expect(report.segments.every(s => s.metric === 'hr')).toBe(true);
    expect(report.segments.every(s => s.status === 'faster')).toBe(true);
    // This is the whole point of the requirement: measured, and not on target.
    expect(report.gradedCount).toBe(4);
    expect(report.onTargetCount).toBe(0);
  });

  it('reports the pace on an HR step as information, without judging on it', () => {
    const report = matchLapsToSteps(flattenPlannedSteps(hrSession()), [
      lap(1000, 240, 150), lap(1000, 240, 151), lap(1000, 240, 149), lap(1000, 240, 152),
    ]);
    expect(report.segments[0].actualPace).toBe(240);
    expect(report.segments[0].plannedPaceMin).toBeNull();
    expect(report.onTargetCount).toBe(4);
  });

  it('says WHY an HR step could not be graded instead of showing a blank verdict', () => {
    const pct = workout([
      step({ type: 'interval', targetType: 'heart_rate', targetHrMinPct: 75, targetHrMaxPct: 80 }),
    ]);
    const noAnchor = matchLapsToSteps(flattenPlannedSteps(pct), [lap(1000, 250, 145)]);
    expect(noAnchor.segments[0].hrUngradedReason).toBe('no_anchor');
    expect(noAnchor.gradedCount).toBe(0);

    const withAnchor = matchLapsToSteps(flattenPlannedSteps(pct), [lap(1000, 250, 145)], { hrAnchorBpm: 190 });
    expect(withAnchor.segments[0].hrUngradedReason).toBeUndefined();
    expect(withAnchor.segments[0].status).toBe('on_target');

    const noHrData = matchLapsToSteps(flattenPlannedSteps(hrSession()), [
      lap(1000, 240), lap(1000, 240), lap(1000, 240), lap(1000, 240),
    ]);
    expect(noHrData.segments[0].hrUngradedReason).toBe('no_hr_data');
  });

  it('still takes a bare number for paceSec, so existing callers are untouched', () => {
    const report = matchLapsToSteps(flattenPlannedSteps(paceSession()), [
      lap(1000, 248), lap(1000, 248), lap(1000, 248), lap(1000, 248),
    ], 10);
    expect(report.segments.every(s => s.metric === 'pace')).toBe(true);
    expect(report.onTargetCount).toBe(4);
  });
});

describe('suggestExecutionTags', () => {
  it('says "on plan" when every rep landed', () => {
    const report = matchLapsToSteps(flattenPlannedSteps(paceSession(6)), [
      lap(1000, 240), lap(1000, 242), lap(1000, 239), lap(1000, 241), lap(1000, 240), lap(1000, 243),
    ]);
    expect(suggestExecutionTags(report)).toEqual(['on_plan']);
  });

  it('reads "opened too fast and faded" off the laps', () => {
    // 4:00 asked. Opens at 3:42 and finishes at 4:21 — the shape Ofer described.
    const report = matchLapsToSteps(flattenPlannedSteps(paceSession(6)), [
      lap(1000, 222), lap(1000, 228), lap(1000, 238), lap(1000, 252), lap(1000, 258), lap(1000, 261),
    ]);
    const tags = suggestExecutionTags(report);
    expect(tags).toContain('fast_start');
    expect(tags).toContain('faded');
    expect(tags).toContain('uneven');
  });

  it('uses the HR words when the session was written in HR', () => {
    const report = matchLapsToSteps(flattenPlannedSteps(hrSession()), [
      lap(1000, 240, 168), lap(1000, 240, 170), lap(1000, 240, 169), lap(1000, 240, 171),
    ]);
    expect(suggestExecutionTags(report)).toContain('hr_high');
  });

  it('returns nothing when there was nothing to grade', () => {
    const report = matchLapsToSteps(flattenPlannedSteps(paceSession()), []);
    expect(suggestExecutionTags(report)).toEqual([]);
  });
});

describe('deviationOf', () => {
  it('is negative on the hard side for both metrics', () => {
    const pace = matchLapsToSteps(flattenPlannedSteps(paceSession(1)), [lap(1000, 230)]);
    expect(deviationOf(pace.segments[0])).toBe(-10);

    const hr = matchLapsToSteps(flattenPlannedSteps(hrSession()), [
      lap(1000, 240, 160), lap(1000, 240, 150), lap(1000, 240, 150), lap(1000, 240, 150),
    ]);
    expect(deviationOf(hr.segments[0])).toBe(-10);
  });

  it('is zero inside the band', () => {
    const pace = matchLapsToSteps(flattenPlannedSteps(paceSession(1)), [lap(1000, 240)]);
    expect(deviationOf(pace.segments[0])).toBe(0);
  });
});

describe('validateFeedback', () => {
  it('requires what happened and what changes', () => {
    const problems = validateFeedback(emptyFeedback());
    expect(problems.map(p => p.field).sort()).toEqual(['action', 'execution']);
  });

  it('accepts the minimum a mentor must give', () => {
    expect(validateFeedback({ ...emptyFeedback(), execution: ['faded'], action: 'ease_next' })).toEqual([]);
  });

  it('rejects a note that grew back into a WhatsApp paragraph', () => {
    const problems = validateFeedback({
      ...emptyFeedback(), execution: ['faded'], action: 'keep', note: 'א'.repeat(NOTE_MAX + 1),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe('note');
  });

  it('rejects "on plan" alongside a deviation', () => {
    const problems = validateFeedback({
      ...emptyFeedback(), execution: ['on_plan', 'faded'], action: 'keep',
    });
    expect(problems.some(p => p.field === 'execution')).toBe(true);
  });
});

describe('renderFeedbackHebrew', () => {
  const report = matchLapsToSteps(flattenPlannedSteps(paceSession(6)), [
    lap(1000, 222), lap(1000, 228), lap(1000, 238), lap(1000, 252), lap(1000, 258), lap(1000, 261),
  ]);

  it('generates the same words for the same choices', () => {
    const text = renderFeedbackHebrew(
      { execution: ['fast_start', 'faded'], effort: 'hard', action: 'ease_next', lapComments: [], note: '' },
      { workoutName: '6×1000 מ׳ בקצב סף', mentorName: 'רון' }
    );
    expect(text.split('\n')).toEqual([
      '6×1000 מ׳ בקצב סף',
      `${EXECUTION_LABELS.fast_start} · ${EXECUTION_LABELS.faded}`,
      'תחושה: קשה',
      'מרככים את האימון הבא',
      '— רון',
    ]);
  });

  it('names a lap by its repeat number, not the watch lap index', () => {
    const text = renderFeedbackHebrew(
      {
        execution: ['faded'], effort: null, action: 'keep',
        lapComments: [{ index: 3, text: 'כאן נשברת' }], note: '',
      },
      { workoutName: 'W', segments: report.segments }
    );
    expect(text).toContain('חזרה 4 (1km): כאן נשברת');
  });

  it('drops an empty lap comment rather than printing a bare label', () => {
    const text = renderFeedbackHebrew(
      { execution: ['faded'], effort: null, action: 'keep', lapComments: [{ index: 2, text: '   ' }], note: '' },
      { workoutName: 'W', segments: report.segments }
    );
    expect(text).not.toContain('חזרה 3');
  });
});
