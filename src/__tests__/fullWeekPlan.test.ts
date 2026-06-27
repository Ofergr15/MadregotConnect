import { describe, it, expect } from 'vitest';
import { ParsedWeeklyPlan, WorkoutStep } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';

/**
 * Full week test based on the coach's PDF: תוכנית אימון 28.06-04.07.26 MADREGOT
 * This validates that after parsing + splitIntoGroups, each group gets the correct paces.
 *
 * PDF structure: 7 days, 3 columns (❶ fastest on RIGHT, ❸ slowest on LEFT in Hebrew RTL)
 */

// Helper: build a step with all 3 groups
function paceStep(opts: {
  order: number;
  type: WorkoutStep['type'];
  durationType: 'distance' | 'time' | 'open';
  durationValue?: number;
  g1Pace: [number, number]; // [min, max] in seconds/km
  g2Pace?: [number, number];
  g3Pace?: [number, number];
  notes?: string;
  repeatCount?: number;
  repeatSteps?: WorkoutStep[];
}): WorkoutStep {
  return {
    order: opts.order,
    type: opts.type,
    durationType: opts.durationType,
    durationValue: opts.durationValue,
    targetType: 'pace',
    targetPaceMinPerKm: opts.g1Pace[0],
    targetPaceMaxPerKm: opts.g1Pace[1],
    group2Pace: opts.g2Pace ? { min: opts.g2Pace[0], max: opts.g2Pace[1] } : undefined,
    group3Pace: opts.g3Pace ? { min: opts.g3Pace[0], max: opts.g3Pace[1] } : undefined,
    notes: opts.notes,
    repeatCount: opts.repeatCount,
    repeatSteps: opts.repeatSteps,
  };
}

function noPaceStep(opts: {
  order: number;
  type: WorkoutStep['type'];
  durationType: 'distance' | 'time' | 'open';
  durationValue?: number;
  notes?: string;
}): WorkoutStep {
  return {
    order: opts.order,
    type: opts.type,
    durationType: opts.durationType,
    durationValue: opts.durationValue,
    targetType: 'no_target',
    notes: opts.notes,
  };
}

// ═══════════════════════════════════════════════════
// SUNDAY (יום ראשון) — Fartlek 12-14 ק"מ
// All 3 groups identical: 15 דק' 4:30-5:30, x15 (1 דק' קל-נוח, 1 דק' מתון-בינוני, 1 דק' בינוני-קשה)
// ═══════════════════════════════════════════════════
describe('Sunday — Fartlek session (same for all groups)', () => {
  const sundayPlan: ParsedWeeklyPlan = {
    workouts: [{
      dayOfWeek: 0,
      name: 'יום ראשון',
      steps: [
        paceStep({ order: 1, type: 'warmup', durationType: 'time', durationValue: 900, g1Pace: [270, 330], notes: '15 דק׳ 4:30-5:30' }),
        {
          order: 2, type: 'interval', durationType: 'time', durationValue: 60, targetType: 'no_target',
          repeatCount: 15,
          repeatSteps: [
            noPaceStep({ order: 1, type: 'interval', durationType: 'time', durationValue: 60, notes: 'קל מתון - נוח' }),
            noPaceStep({ order: 2, type: 'interval', durationType: 'time', durationValue: 60, notes: 'מתון - בינוני' }),
            noPaceStep({ order: 3, type: 'interval', durationType: 'time', durationValue: 60, notes: 'בינוני - קשה' }),
          ],
        },
      ],
    }],
  };

  it('all 3 groups should have identical workout (subjective effort, no paces)', () => {
    const grouped = splitIntoGroups(sundayPlan);
    // Sunday is RPE-based, no group-specific paces
    const g1Steps = grouped.group1.workouts[0].steps;
    const g2Steps = grouped.group2.workouts[0].steps;
    const g3Steps = grouped.group3.workouts[0].steps;

    expect(g1Steps).toHaveLength(2);
    expect(g2Steps).toHaveLength(2);
    expect(g3Steps).toHaveLength(2);

    // Repeat counts same
    expect(g1Steps[1].repeatCount).toBe(15);
    expect(g2Steps[1].repeatCount).toBe(15);
    expect(g3Steps[1].repeatCount).toBe(15);
  });
});

// ═══════════════════════════════════════════════════
// MONDAY (יום שני) — Easy run 11-18 ק"מ
// All groups: 60-80 דק' 4:40-5:15
// ═══════════════════════════════════════════════════
describe('Monday — Easy run (same for all groups)', () => {
  const mondayPlan: ParsedWeeklyPlan = {
    workouts: [{
      dayOfWeek: 1,
      name: 'יום שני',
      steps: [
        noPaceStep({ order: 1, type: 'active', durationType: 'open', notes: '60-80 דקות 4:40-5:15' }),
      ],
    }],
  };

  it('single open step, identical for all groups', () => {
    const grouped = splitIntoGroups(mondayPlan);
    expect(grouped.group1.workouts[0].steps).toHaveLength(1);
    expect(grouped.group1.workouts[0].steps[0].durationType).toBe('open');
    expect(grouped.group1.workouts[0].steps[0].notes).toBe('60-80 דקות 4:40-5:15');
    expect(grouped.group2.workouts[0].steps[0].notes).toBe('60-80 דקות 4:40-5:15');
    expect(grouped.group3.workouts[0].steps[0].notes).toBe('60-80 דקות 4:40-5:15');
  });
});

// ═══════════════════════════════════════════════════
// TUESDAY (יום שלישי) — Interval pyramid 18-21 ק"מ
// This is the most complex day. Different paces per group.
// ═══════════════════════════════════════════════════
describe('Tuesday — Interval pyramid (3 different group paces)', () => {
  // From PDF:
  // 45 שנ' descending: ❶ 3:50,3:40,3:30,3:20 | ❷ 4:00,3:50,3:40,3:30 | ❸ 4:10,4:00,3:50,3:40
  // Pyramid recovery: ❶ 4:00-4:10 | ❷ 4:10-4:20 | ❸ 4:20-4:30
  // Pyramid fast: ❶ 3:25,3:30,3:35,3:30,3:25,3:30,3:35,3:50 | ❷ 3:35,3:40,3:45,3:40,3:35,3:40,3:45 | ❸ 3:45,3:50,3:55,3:50,3:45,3:50,3:55

  const tuesdayPlan: ParsedWeeklyPlan = {
    workouts: [{
      dayOfWeek: 2,
      name: 'יום שלישי',
      steps: [
        // Warmup 2km 5:00 (same all groups)
        paceStep({ order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, g1Pace: [300, 300], notes: '5:00' }),
        // Warmup 3km 4:40 (same all groups)
        paceStep({ order: 2, type: 'warmup', durationType: 'distance', durationValue: 3000, g1Pace: [280, 280], notes: '4:40' }),
        // 2 דק' הליכה
        noPaceStep({ order: 3, type: 'rest', durationType: 'time', durationValue: 120, notes: 'הליכה' }),
        // 45s intervals descending (different paces per group)
        paceStep({ order: 4, type: 'interval', durationType: 'time', durationValue: 45,
          g1Pace: [230, 230], g2Pace: [240, 240], g3Pace: [250, 250],
          notes: '3:50 (4:00) ((4:10))' }),
        paceStep({ order: 5, type: 'interval', durationType: 'time', durationValue: 45,
          g1Pace: [220, 220], g2Pace: [230, 230], g3Pace: [240, 240],
          notes: '3:40 (3:50) ((4:00))' }),
        paceStep({ order: 6, type: 'interval', durationType: 'time', durationValue: 45,
          g1Pace: [210, 210], g2Pace: [220, 220], g3Pace: [230, 230],
          notes: '3:30 (3:40) ((3:50))' }),
        paceStep({ order: 7, type: 'interval', durationType: 'time', durationValue: 45,
          g1Pace: [200, 200], g2Pace: [210, 210], g3Pace: [220, 220],
          notes: '3:20 (3:30) ((3:40))' }),
        // 2 דק' הליכה
        noPaceStep({ order: 8, type: 'rest', durationType: 'time', durationValue: 120, notes: 'הליכה' }),
        // x4: 30s מתגברת + 60s הליכה (same for all)
        {
          order: 9, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'no_target',
          repeatCount: 4,
          repeatSteps: [
            noPaceStep({ order: 1, type: 'interval', durationType: 'time', durationValue: 30, notes: 'מתגברת' }),
            noPaceStep({ order: 2, type: 'rest', durationType: 'time', durationValue: 60, notes: 'הליכה' }),
          ],
        },
        // Pyramid: 2 דק' fast pace (different per group)
        paceStep({ order: 10, type: 'interval', durationType: 'time', durationValue: 120,
          g1Pace: [205, 205], g2Pace: [215, 215], g3Pace: [225, 225],
          notes: '3:25 (3:35) ((3:45))' }),
        // Recovery 1 דק'
        paceStep({ order: 11, type: 'active', durationType: 'time', durationValue: 60,
          g1Pace: [240, 250], g2Pace: [250, 260], g3Pace: [260, 270],
          notes: '4:00-4:10 (4:10-4:20) ((4:20-4:30))' }),
        // 3 דק' fast
        paceStep({ order: 12, type: 'interval', durationType: 'time', durationValue: 180,
          g1Pace: [210, 210], g2Pace: [220, 220], g3Pace: [230, 230],
          notes: '3:30 (3:40) ((3:50))' }),
      ],
    }],
  };

  it('Group 1 gets fastest paces from column ❶', () => {
    const grouped = splitIntoGroups(tuesdayPlan);
    const steps = grouped.group1.workouts[0].steps;

    // 45s intervals: 3:50=230, 3:40=220, 3:30=210, 3:20=200
    expect(steps[3].targetPaceMinPerKm).toBe(230);
    expect(steps[4].targetPaceMinPerKm).toBe(220);
    expect(steps[5].targetPaceMinPerKm).toBe(210);
    expect(steps[6].targetPaceMinPerKm).toBe(200);

    // Pyramid 2min: 3:25=205
    expect(steps[9].targetPaceMinPerKm).toBe(205);

    // Recovery: 4:00-4:10 = 240-250
    expect(steps[10].targetPaceMinPerKm).toBe(240);
    expect(steps[10].targetPaceMaxPerKm).toBe(250);
  });

  it('Group 2 gets middle paces from column ❷', () => {
    const grouped = splitIntoGroups(tuesdayPlan);
    const steps = grouped.group2.workouts[0].steps;

    // 45s intervals: 4:00=240, 3:50=230, 3:40=220, 3:30=210
    expect(steps[3].targetPaceMinPerKm).toBe(240);
    expect(steps[4].targetPaceMinPerKm).toBe(230);
    expect(steps[5].targetPaceMinPerKm).toBe(220);
    expect(steps[6].targetPaceMinPerKm).toBe(210);

    // Pyramid 2min: 3:35=215
    expect(steps[9].targetPaceMinPerKm).toBe(215);

    // Recovery: 4:10-4:20 = 250-260
    expect(steps[10].targetPaceMinPerKm).toBe(250);
    expect(steps[10].targetPaceMaxPerKm).toBe(260);
  });

  it('Group 3 gets slowest paces from column ❸', () => {
    const grouped = splitIntoGroups(tuesdayPlan);
    const steps = grouped.group3.workouts[0].steps;

    // 45s intervals: 4:10=250, 4:00=240, 3:50=230, 3:40=220
    expect(steps[3].targetPaceMinPerKm).toBe(250);
    expect(steps[4].targetPaceMinPerKm).toBe(240);
    expect(steps[5].targetPaceMinPerKm).toBe(230);
    expect(steps[6].targetPaceMinPerKm).toBe(220);

    // Pyramid 2min: 3:45=225
    expect(steps[9].targetPaceMinPerKm).toBe(225);

    // Recovery: 4:20-4:30 = 260-270
    expect(steps[10].targetPaceMinPerKm).toBe(260);
    expect(steps[10].targetPaceMaxPerKm).toBe(270);
  });

  it('notes are rewritten per group (no bracket notation in output)', () => {
    const grouped = splitIntoGroups(tuesdayPlan);

    // Group 1 notes show only g1 pace
    expect(grouped.group1.workouts[0].steps[3].notes).toBe('3:50');
    expect(grouped.group1.workouts[0].steps[10].notes).toBe('4:00-4:10');

    // Group 2 notes show only g2 pace
    expect(grouped.group2.workouts[0].steps[3].notes).toBe('4:00');
    expect(grouped.group2.workouts[0].steps[10].notes).toBe('4:10-4:20');

    // Group 3 notes show only g3 pace
    expect(grouped.group3.workouts[0].steps[3].notes).toBe('4:10');
    expect(grouped.group3.workouts[0].steps[10].notes).toBe('4:20-4:30');
  });

  it('warmup and rest steps are identical across groups', () => {
    const grouped = splitIntoGroups(tuesdayPlan);

    // Warmup 2km 5:00 — same for all
    expect(grouped.group1.workouts[0].steps[0].durationValue).toBe(2000);
    expect(grouped.group2.workouts[0].steps[0].durationValue).toBe(2000);
    expect(grouped.group3.workouts[0].steps[0].durationValue).toBe(2000);

    // Rest 2min — same for all
    expect(grouped.group1.workouts[0].steps[2].notes).toBe('הליכה');
    expect(grouped.group2.workouts[0].steps[2].notes).toBe('הליכה');
    expect(grouped.group3.workouts[0].steps[2].notes).toBe('הליכה');
  });

  it('repeat blocks are preserved correctly', () => {
    const grouped = splitIntoGroups(tuesdayPlan);
    const repeat = grouped.group1.workouts[0].steps[8];

    expect(repeat.repeatCount).toBe(4);
    expect(repeat.repeatSteps).toHaveLength(2);
    expect(repeat.repeatSteps![0].durationType).toBe('time');
    expect(repeat.repeatSteps![0].durationValue).toBe(30);
    expect(repeat.repeatSteps![0].notes).toBe('מתגברת');
    expect(repeat.repeatSteps![1].durationType).toBe('time');
    expect(repeat.repeatSteps![1].durationValue).toBe(60);
    expect(repeat.repeatSteps![1].notes).toBe('הליכה');
  });
});

// ═══════════════════════════════════════════════════
// WEDNESDAY (יום רביעי) — Easy recovery 14-20 ק"מ
// All groups: 75-90 דק' ריצת שחרור קלה
// ═══════════════════════════════════════════════════
describe('Wednesday — Easy recovery (same for all groups)', () => {
  const wednesdayPlan: ParsedWeeklyPlan = {
    workouts: [{
      dayOfWeek: 3,
      name: 'יום רביעי',
      steps: [
        noPaceStep({ order: 1, type: 'active', durationType: 'open', notes: '75-90 דקות ריצת שחרור קלה' }),
      ],
    }],
  };

  it('single open step, all groups identical', () => {
    const grouped = splitIntoGroups(wednesdayPlan);
    expect(grouped.group1.workouts[0].steps[0].durationType).toBe('open');
    expect(grouped.group1.workouts[0].steps[0].notes).toContain('שחרור');
    expect(grouped.group2.workouts[0].steps[0].notes).toContain('שחרור');
    expect(grouped.group3.workouts[0].steps[0].notes).toContain('שחרור');
  });
});

// ═══════════════════════════════════════════════════
// THURSDAY (יום חמישי) — Fartlek 15-17 ק"מ
// ❶: x5 (14 דק' 4:40-5:15 + 1 דק' 3:35-3:40)
// ❷: x5 (14 דק' 4:40-5:15 + 1 דק' 3:45-3:50)
// ❸: x5 (14 דק' 4:40-5:15 + 1 דק' 3:55-4:00)
// ═══════════════════════════════════════════════════
describe('Thursday — Fartlek (different fast pace per group)', () => {
  const thursdayPlan: ParsedWeeklyPlan = {
    workouts: [{
      dayOfWeek: 4,
      name: 'יום חמישי',
      steps: [
        {
          order: 1, type: 'interval', durationType: 'time', durationValue: 840, targetType: 'pace',
          targetPaceMinPerKm: 280, targetPaceMaxPerKm: 315,
          repeatCount: 5,
          repeatSteps: [
            paceStep({ order: 1, type: 'active', durationType: 'time', durationValue: 840, g1Pace: [280, 315], notes: '4:40-5:15' }),
            paceStep({ order: 2, type: 'interval', durationType: 'time', durationValue: 60,
              g1Pace: [215, 220], g2Pace: [225, 230], g3Pace: [235, 240],
              notes: '3:35-3:40 (3:45-3:50) ((3:55-4:00))' }),
          ],
        },
      ],
    }],
  };

  it('Group 1 fast segments: 3:35-3:40 = 215-220', () => {
    const grouped = splitIntoGroups(thursdayPlan);
    const fastStep = grouped.group1.workouts[0].steps[0].repeatSteps![1];
    expect(fastStep.targetPaceMinPerKm).toBe(215);
    expect(fastStep.targetPaceMaxPerKm).toBe(220);
  });

  it('Group 2 fast segments: 3:45-3:50 = 225-230', () => {
    const grouped = splitIntoGroups(thursdayPlan);
    const fastStep = grouped.group2.workouts[0].steps[0].repeatSteps![1];
    expect(fastStep.targetPaceMinPerKm).toBe(225);
    expect(fastStep.targetPaceMaxPerKm).toBe(230);
  });

  it('Group 3 fast segments: 3:55-4:00 = 235-240', () => {
    const grouped = splitIntoGroups(thursdayPlan);
    const fastStep = grouped.group3.workouts[0].steps[0].repeatSteps![1];
    expect(fastStep.targetPaceMinPerKm).toBe(235);
    expect(fastStep.targetPaceMaxPerKm).toBe(240);
  });

  it('easy segments are the same for all groups (4:40-5:15)', () => {
    const grouped = splitIntoGroups(thursdayPlan);
    const g1Easy = grouped.group1.workouts[0].steps[0].repeatSteps![0];
    const g2Easy = grouped.group2.workouts[0].steps[0].repeatSteps![0];
    const g3Easy = grouped.group3.workouts[0].steps[0].repeatSteps![0];

    expect(g1Easy.targetPaceMinPerKm).toBe(280);
    expect(g2Easy.targetPaceMinPerKm).toBe(280);
    expect(g3Easy.targetPaceMinPerKm).toBe(280);
  });

  it('notes rewritten per group for fast segment', () => {
    const grouped = splitIntoGroups(thursdayPlan);
    expect(grouped.group1.workouts[0].steps[0].repeatSteps![1].notes).toBe('3:35-3:40');
    expect(grouped.group2.workouts[0].steps[0].repeatSteps![1].notes).toBe('3:45-3:50');
    expect(grouped.group3.workouts[0].steps[0].repeatSteps![1].notes).toBe('3:55-4:00');
  });
});

// ═══════════════════════════════════════════════════
// FRIDAY (יום שישי) — Long session with hills 27-29 ק"מ
// The most detailed workout. Different paces for 200m reps and 6km blocks.
// ═══════════════════════════════════════════════════
describe('Friday — Long session with hills and 3x6km', () => {
  const fridayPlan: ParsedWeeklyPlan = {
    workouts: [{
      dayOfWeek: 5,
      name: 'יום שישי',
      steps: [
        // Warmup 2km 5:00
        paceStep({ order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, g1Pace: [300, 300], notes: '5:00' }),
        // Warmup 3km 4:40
        paceStep({ order: 2, type: 'warmup', durationType: 'distance', durationValue: 3000, g1Pace: [280, 280], notes: '4:40' }),
        // Rest 2 min
        noPaceStep({ order: 3, type: 'rest', durationType: 'time', durationValue: 120, notes: 'הליכה' }),
        // 200m descending (different per group)
        // ❶: 3:35, 3:25, 3:15 | ❷: 3:45, 3:35, 3:25 | ❸: 3:55, 3:45, 3:35
        paceStep({ order: 4, type: 'interval', durationType: 'distance', durationValue: 200,
          g1Pace: [215, 215], g2Pace: [225, 225], g3Pace: [235, 235],
          notes: '3:35 (3:45) ((3:55))' }),
        paceStep({ order: 5, type: 'interval', durationType: 'distance', durationValue: 200,
          g1Pace: [205, 205], g2Pace: [215, 215], g3Pace: [225, 225],
          notes: '3:25 (3:35) ((3:45))' }),
        paceStep({ order: 6, type: 'interval', durationType: 'distance', durationValue: 200,
          g1Pace: [195, 195], g2Pace: [205, 205], g3Pace: [215, 215],
          notes: '3:15 (3:25) ((3:35))' }),
        // Rest 2 min
        noPaceStep({ order: 7, type: 'rest', durationType: 'time', durationValue: 120, notes: 'הליכה' }),
        // x4: 20s מתגברת + 40s הליכה
        {
          order: 8, type: 'interval', durationType: 'time', durationValue: 20, targetType: 'no_target',
          repeatCount: 4,
          repeatSteps: [
            noPaceStep({ order: 1, type: 'interval', durationType: 'time', durationValue: 20, notes: 'מתגברת' }),
            noPaceStep({ order: 2, type: 'rest', durationType: 'time', durationValue: 40, notes: 'הליכה' }),
          ],
        },
        // x5 hill repeats (same for all groups - effort based)
        {
          order: 9, type: 'interval', durationType: 'time', durationValue: 45, targetType: 'no_target',
          repeatCount: 5,
          repeatSteps: [
            noPaceStep({ order: 1, type: 'interval', durationType: 'time', durationValue: 45, notes: 'עליה' }),
            noPaceStep({ order: 2, type: 'recovery', durationType: 'open', notes: 'גוג קלקל בירידה' }),
            noPaceStep({ order: 3, type: 'interval', durationType: 'time', durationValue: 30, notes: 'עליה' }),
            noPaceStep({ order: 4, type: 'recovery', durationType: 'open', notes: 'גוג קלקל בירידה' }),
            noPaceStep({ order: 5, type: 'interval', durationType: 'time', durationValue: 15, notes: 'עליה' }),
            noPaceStep({ order: 6, type: 'recovery', durationType: 'open', notes: 'הליכה בירידה' }),
            noPaceStep({ order: 7, type: 'rest', durationType: 'time', durationValue: 120, notes: 'מנוחה מוחלטת' }),
          ],
        },
        // Rest 3 min (השלמה ל5 דק' סה"כ)
        noPaceStep({ order: 10, type: 'rest', durationType: 'time', durationValue: 180, notes: 'מנוחה (השלמה ל5 דק׳ סה״כ)' }),
        // 6km blocks (different per group)
        // ❶: 4:15, 4:04, 3:53 | ❷: 4:24, 4:13, 4:02 | ❸: 4:36, 4:18, 4:07
        paceStep({ order: 11, type: 'active', durationType: 'distance', durationValue: 6000,
          g1Pace: [255, 255], g2Pace: [264, 264], g3Pace: [276, 276],
          notes: '4:15 (4:24) ((4:36))' }),
        paceStep({ order: 12, type: 'active', durationType: 'distance', durationValue: 6000,
          g1Pace: [244, 244], g2Pace: [253, 253], g3Pace: [258, 258],
          notes: '4:04 (4:13) ((4:18))' }),
        paceStep({ order: 13, type: 'active', durationType: 'distance', durationValue: 6000,
          g1Pace: [233, 233], g2Pace: [242, 242], g3Pace: [247, 247],
          notes: '3:53 (4:02) ((4:07))' }),
      ],
    }],
  };

  it('200m intervals — Group 1: 3:35, 3:25, 3:15', () => {
    const grouped = splitIntoGroups(fridayPlan);
    const steps = grouped.group1.workouts[0].steps;
    expect(steps[3].targetPaceMinPerKm).toBe(215); // 3:35
    expect(steps[4].targetPaceMinPerKm).toBe(205); // 3:25
    expect(steps[5].targetPaceMinPerKm).toBe(195); // 3:15
  });

  it('200m intervals — Group 2: 3:45, 3:35, 3:25', () => {
    const grouped = splitIntoGroups(fridayPlan);
    const steps = grouped.group2.workouts[0].steps;
    expect(steps[3].targetPaceMinPerKm).toBe(225); // 3:45
    expect(steps[4].targetPaceMinPerKm).toBe(215); // 3:35
    expect(steps[5].targetPaceMinPerKm).toBe(205); // 3:25
  });

  it('200m intervals — Group 3: 3:55, 3:45, 3:35', () => {
    const grouped = splitIntoGroups(fridayPlan);
    const steps = grouped.group3.workouts[0].steps;
    expect(steps[3].targetPaceMinPerKm).toBe(235); // 3:55
    expect(steps[4].targetPaceMinPerKm).toBe(225); // 3:45
    expect(steps[5].targetPaceMinPerKm).toBe(215); // 3:35
  });

  it('6km blocks — Group 1: 4:15, 4:04, 3:53', () => {
    const grouped = splitIntoGroups(fridayPlan);
    const steps = grouped.group1.workouts[0].steps;
    expect(steps[10].targetPaceMinPerKm).toBe(255); // 4:15
    expect(steps[10].durationType).toBe('distance');
    expect(steps[10].durationValue).toBe(6000);
    expect(steps[11].targetPaceMinPerKm).toBe(244); // 4:04
    expect(steps[12].targetPaceMinPerKm).toBe(233); // 3:53
  });

  it('6km blocks — Group 2: 4:24, 4:13, 4:02', () => {
    const grouped = splitIntoGroups(fridayPlan);
    const steps = grouped.group2.workouts[0].steps;
    expect(steps[10].targetPaceMinPerKm).toBe(264); // 4:24
    expect(steps[11].targetPaceMinPerKm).toBe(253); // 4:13
    expect(steps[12].targetPaceMinPerKm).toBe(242); // 4:02
  });

  it('6km blocks — Group 3: 4:36, 4:18, 4:07', () => {
    const grouped = splitIntoGroups(fridayPlan);
    const steps = grouped.group3.workouts[0].steps;
    expect(steps[10].targetPaceMinPerKm).toBe(276); // 4:36
    expect(steps[11].targetPaceMinPerKm).toBe(258); // 4:18
    expect(steps[12].targetPaceMinPerKm).toBe(247); // 4:07
  });

  it('hill repeats — same for all groups (effort-based)', () => {
    const grouped = splitIntoGroups(fridayPlan);
    const g1Hill = grouped.group1.workouts[0].steps[8];
    const g2Hill = grouped.group2.workouts[0].steps[8];
    const g3Hill = grouped.group3.workouts[0].steps[8];

    expect(g1Hill.repeatCount).toBe(5);
    expect(g2Hill.repeatCount).toBe(5);
    expect(g3Hill.repeatCount).toBe(5);

    expect(g1Hill.repeatSteps![0].durationValue).toBe(45);
    expect(g2Hill.repeatSteps![0].durationValue).toBe(45);
    expect(g3Hill.repeatSteps![0].durationValue).toBe(45);

    expect(g1Hill.repeatSteps![6].notes).toBe('מנוחה מוחלטת');
    expect(g2Hill.repeatSteps![6].notes).toBe('מנוחה מוחלטת');
    expect(g3Hill.repeatSteps![6].notes).toBe('מנוחה מוחלטת');
  });

  it('6km notes rewritten per group', () => {
    const grouped = splitIntoGroups(fridayPlan);
    expect(grouped.group1.workouts[0].steps[10].notes).toBe('4:15');
    expect(grouped.group2.workouts[0].steps[10].notes).toBe('4:24');
    expect(grouped.group3.workouts[0].steps[10].notes).toBe('4:36');

    expect(grouped.group1.workouts[0].steps[11].notes).toBe('4:04');
    expect(grouped.group2.workouts[0].steps[11].notes).toBe('4:13');
    expect(grouped.group3.workouts[0].steps[11].notes).toBe('4:18');
  });

  it('rest step preserves (השלמה ל5 דק׳ סה״כ) in all groups', () => {
    const grouped = splitIntoGroups(fridayPlan);
    expect(grouped.group1.workouts[0].steps[9].notes).toContain('השלמה');
    expect(grouped.group2.workouts[0].steps[9].notes).toContain('השלמה');
    expect(grouped.group3.workouts[0].steps[9].notes).toContain('השלמה');
  });

  it('all duration types are correct (no time/distance confusion)', () => {
    const grouped = splitIntoGroups(fridayPlan);
    const steps = grouped.group1.workouts[0].steps;

    // Warmup: distance
    expect(steps[0].durationType).toBe('distance');
    expect(steps[0].durationValue).toBe(2000);
    expect(steps[1].durationType).toBe('distance');
    expect(steps[1].durationValue).toBe(3000);

    // Rest: time
    expect(steps[2].durationType).toBe('time');
    expect(steps[2].durationValue).toBe(120);

    // 200m: distance
    expect(steps[3].durationType).toBe('distance');
    expect(steps[3].durationValue).toBe(200);
    expect(steps[4].durationType).toBe('distance');
    expect(steps[4].durationValue).toBe(200);
    expect(steps[5].durationType).toBe('distance');
    expect(steps[5].durationValue).toBe(200);

    // 6km: distance
    expect(steps[10].durationType).toBe('distance');
    expect(steps[10].durationValue).toBe(6000);
  });
});

// ═══════════════════════════════════════════════════
// SATURDAY (שבת) — Easy/rest 11-18 ק"מ
// All groups: 60-80 דק' ריצת שחרור או מנוחה
// ═══════════════════════════════════════════════════
describe('Saturday — Easy run or rest (same for all groups)', () => {
  const saturdayPlan: ParsedWeeklyPlan = {
    workouts: [{
      dayOfWeek: 6,
      name: 'שבת',
      steps: [
        noPaceStep({ order: 1, type: 'active', durationType: 'open', notes: '60-80 דקות ריצת שחרור או מנוחה' }),
      ],
    }],
  };

  it('single open step, all groups identical', () => {
    const grouped = splitIntoGroups(saturdayPlan);
    expect(grouped.group1.workouts[0].steps[0].notes).toContain('שחרור או מנוחה');
    expect(grouped.group2.workouts[0].steps[0].notes).toContain('שחרור או מנוחה');
    expect(grouped.group3.workouts[0].steps[0].notes).toContain('שחרור או מנוחה');
  });
});

// ═══════════════════════════════════════════════════
// EDGE CASES & VALIDATION
// ═══════════════════════════════════════════════════
describe('Edge cases and validation', () => {
  it('pace offset inferred correctly from steps with bracket notation', () => {
    // When some steps have bracket notation and others don't,
    // the ones without should get inferred offset
    const plan: ParsedWeeklyPlan = {
      workouts: [{
        dayOfWeek: 2,
        name: 'test',
        steps: [
          // Step with bracket notation: offset = 10s for g2, 20s for g3
          paceStep({ order: 1, type: 'interval', durationType: 'time', durationValue: 45,
            g1Pace: [230, 230], g2Pace: [240, 240], g3Pace: [250, 250],
            notes: '3:50 (4:00) ((4:10))' }),
          // Step WITHOUT bracket notation - should get offset applied
          paceStep({ order: 2, type: 'interval', durationType: 'time', durationValue: 120,
            g1Pace: [205, 205], notes: '3:25' }),
        ],
      }],
    };

    const grouped = splitIntoGroups(plan);

    // Step 2 should get inferred offset: g2 +10, g3 +20
    expect(grouped.group2.workouts[0].steps[1].targetPaceMinPerKm).toBe(215); // 205+10
    expect(grouped.group3.workouts[0].steps[1].targetPaceMinPerKm).toBe(225); // 205+20
  });

  it('open steps without pace are never modified', () => {
    const plan: ParsedWeeklyPlan = {
      workouts: [{
        dayOfWeek: 1,
        name: 'test',
        steps: [
          noPaceStep({ order: 1, type: 'active', durationType: 'open', notes: '60-80 דקות 4:40-5:15' }),
        ],
      }],
    };

    const grouped = splitIntoGroups(plan);
    // no_target steps should never get pace modifications
    expect(grouped.group1.workouts[0].steps[0].targetType).toBe('no_target');
    expect(grouped.group2.workouts[0].steps[0].targetType).toBe('no_target');
    expect(grouped.group3.workouts[0].steps[0].targetType).toBe('no_target');
  });

  it('handles workout with zero steps gracefully', () => {
    const plan: ParsedWeeklyPlan = {
      workouts: [{ dayOfWeek: 3, name: 'empty', steps: [] }],
    };
    const grouped = splitIntoGroups(plan);
    expect(grouped.group1.workouts[0].steps).toHaveLength(0);
  });

  it('pace conversion: common Hebrew pace values to seconds', () => {
    // Verify our assumptions about pace conversion
    expect(3 * 60 + 25).toBe(205); // 3:25
    expect(3 * 60 + 30).toBe(210); // 3:30
    expect(3 * 60 + 35).toBe(215); // 3:35
    expect(3 * 60 + 40).toBe(220); // 3:40
    expect(3 * 60 + 45).toBe(225); // 3:45
    expect(3 * 60 + 50).toBe(230); // 3:50
    expect(3 * 60 + 53).toBe(233); // 3:53
    expect(3 * 60 + 55).toBe(235); // 3:55
    expect(4 * 60 + 0).toBe(240);  // 4:00
    expect(4 * 60 + 2).toBe(242);  // 4:02
    expect(4 * 60 + 4).toBe(244);  // 4:04
    expect(4 * 60 + 7).toBe(247);  // 4:07
    expect(4 * 60 + 10).toBe(250); // 4:10
    expect(4 * 60 + 13).toBe(253); // 4:13
    expect(4 * 60 + 15).toBe(255); // 4:15
    expect(4 * 60 + 18).toBe(258); // 4:18
    expect(4 * 60 + 20).toBe(260); // 4:20
    expect(4 * 60 + 24).toBe(264); // 4:24
    expect(4 * 60 + 30).toBe(270); // 4:30
    expect(4 * 60 + 36).toBe(276); // 4:36
    expect(4 * 60 + 40).toBe(280); // 4:40
    expect(5 * 60 + 0).toBe(300);  // 5:00
    expect(5 * 60 + 15).toBe(315); // 5:15
  });
});
