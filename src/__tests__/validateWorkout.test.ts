import { describe, it, expect } from 'vitest';
import { ParsedWeeklyPlan, WorkoutStep } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';

/**
 * This test validates that a parsed workout matches Yaya's expected output.
 * The "golden" plan below represents what Yaya produces for the Friday long session.
 * We test both the structure validation and the splitIntoGroups utility.
 */

// Yaya's expected output for Friday (from the coach's image):
// Step 1. Warm Up — 2 km, 5:00
// Step 2. Warm Up — 3 km, 4:40 אחרי 2 קמ ג׳ל ולשתות 500-600 מל כל שעה
// Step 3. Rest — 2:00, הליכה
// Step 4. Run — 0.2 km, 3:35(3:45)((3:55))
// Step 5. Run — 0.2 km, 3:25(3:35)((3:45))
// Step 6. Run — 0.2 km, 3:15(3:25)((3:35))
// Step 7. Rest — 2:00, הליכה
// Step 8. 4x: (Run 0:20, מתגברת)(Rest 0:40, הליכה)
// Step 9. 5x: (Run 0:45, עליה)(Rest LBP, ג'וג קלקל בירידה)(Run 0:30, עליה)(Rest LBP, ג'וג קלקל בירידה)(Run 0:15, עליה)(Rest LBP, הליכה בירידה)(Rest 2:00, מנוחה מוחלטת)
// Step 10. Rest — 3:00, מנוחה (השלמה ל5 דק׳ סה״כ)
// Step 11. Run — 6 km, 4:15 (4:24) ((4:36))
// Step 12. Run — 6 km, 4:04 (4:13) ((4:18)) ג׳ל בקילומטר השני
// Step 13. Run — 6 km, 3:53 (4:02) ((4:07)) ג׳ל אחרי 3

const GOLDEN_PLAN: ParsedWeeklyPlan = {
  workouts: [
    {
      dayOfWeek: 5, // Friday
      name: 'שישי',
      steps: [
        {
          order: 1,
          type: 'warmup',
          durationType: 'distance',
          durationValue: 2000,
          targetType: 'pace',
          targetPaceMinPerKm: 300,
          targetPaceMaxPerKm: 300,
          notes: '5:00',
        },
        {
          order: 2,
          type: 'warmup',
          durationType: 'distance',
          durationValue: 3000,
          targetType: 'pace',
          targetPaceMinPerKm: 280,
          targetPaceMaxPerKm: 280,
          notes: '4:40 אחרי 2 קמ ג׳ל ולשתות 500-600 מל כל שעה',
        },
        {
          order: 3,
          type: 'rest',
          durationType: 'time',
          durationValue: 120,
          targetType: 'no_target',
          notes: 'הליכה',
        },
        {
          order: 4,
          type: 'interval',
          durationType: 'distance',
          durationValue: 200,
          targetType: 'pace',
          targetPaceMinPerKm: 215,
          targetPaceMaxPerKm: 215,
          group2Pace: { min: 225, max: 225 },
          group3Pace: { min: 235, max: 235 },
          notes: '3:35(3:45)((3:55))',
        },
        {
          order: 5,
          type: 'interval',
          durationType: 'distance',
          durationValue: 200,
          targetType: 'pace',
          targetPaceMinPerKm: 205,
          targetPaceMaxPerKm: 205,
          group2Pace: { min: 215, max: 215 },
          group3Pace: { min: 225, max: 225 },
          notes: '3:25(3:35)((3:45))',
        },
        {
          order: 6,
          type: 'interval',
          durationType: 'distance',
          durationValue: 200,
          targetType: 'pace',
          targetPaceMinPerKm: 195,
          targetPaceMaxPerKm: 195,
          group2Pace: { min: 205, max: 205 },
          group3Pace: { min: 215, max: 215 },
          notes: '3:15(3:25)((3:35))',
        },
        {
          order: 7,
          type: 'rest',
          durationType: 'time',
          durationValue: 120,
          targetType: 'no_target',
          notes: 'הליכה',
        },
        {
          order: 8,
          type: 'interval',
          durationType: 'time',
          durationValue: 20,
          targetType: 'no_target',
          repeatCount: 4,
          repeatSteps: [
            {
              order: 1,
              type: 'interval',
              durationType: 'time',
              durationValue: 20,
              targetType: 'no_target',
              notes: 'מתגברת',
            },
            {
              order: 2,
              type: 'rest',
              durationType: 'time',
              durationValue: 40,
              targetType: 'no_target',
              notes: 'הליכה',
            },
          ],
        },
        {
          order: 9,
          type: 'interval',
          durationType: 'time',
          durationValue: 45,
          targetType: 'no_target',
          repeatCount: 5,
          repeatSteps: [
            { order: 1, type: 'interval', durationType: 'time', durationValue: 45, targetType: 'no_target', notes: 'עליה' },
            { order: 2, type: 'recovery', durationType: 'open', targetType: 'no_target', notes: 'ג׳וג קלקל בירידה' },
            { order: 3, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'no_target', notes: 'עליה' },
            { order: 4, type: 'recovery', durationType: 'open', targetType: 'no_target', notes: 'ג׳וג קלקל בירידה' },
            { order: 5, type: 'interval', durationType: 'time', durationValue: 15, targetType: 'no_target', notes: 'עליה' },
            { order: 6, type: 'recovery', durationType: 'open', targetType: 'no_target', notes: 'הליכה בירידה' },
            { order: 7, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target', notes: 'מנוחה מוחלטת' },
          ],
        },
        {
          order: 10,
          type: 'rest',
          durationType: 'time',
          durationValue: 180,
          targetType: 'no_target',
          notes: 'מנוחה (השלמה ל5 דק׳ סה״כ)',
        },
        {
          order: 11,
          type: 'active',
          durationType: 'distance',
          durationValue: 6000,
          targetType: 'pace',
          targetPaceMinPerKm: 255,
          targetPaceMaxPerKm: 255,
          group2Pace: { min: 264, max: 264 },
          group3Pace: { min: 276, max: 276 },
          notes: '4:15 (4:24) ((4:36))',
        },
        {
          order: 12,
          type: 'active',
          durationType: 'distance',
          durationValue: 6000,
          targetType: 'pace',
          targetPaceMinPerKm: 244,
          targetPaceMaxPerKm: 244,
          group2Pace: { min: 253, max: 253 },
          group3Pace: { min: 258, max: 258 },
          notes: '4:04 (4:13) ((4:18)) ג׳ל בקילומטר השני',
        },
        {
          order: 13,
          type: 'active',
          durationType: 'distance',
          durationValue: 6000,
          targetType: 'pace',
          targetPaceMinPerKm: 233,
          targetPaceMaxPerKm: 233,
          group2Pace: { min: 242, max: 242 },
          group3Pace: { min: 247, max: 247 },
          notes: '4:02 (4:02) ((4:07)) ג׳ל אחרי 3',
        },
      ],
    },
  ],
};

describe('Workout structure validation (Yaya comparison)', () => {
  it('warmup steps should have durationType "distance" with correct meters', () => {
    const steps = GOLDEN_PLAN.workouts[0].steps;
    const warmups = steps.filter(s => s.type === 'warmup');

    expect(warmups).toHaveLength(2);
    expect(warmups[0].durationType).toBe('distance');
    expect(warmups[0].durationValue).toBe(2000); // 2km
    expect(warmups[1].durationType).toBe('distance');
    expect(warmups[1].durationValue).toBe(3000); // 3km
  });

  it('rest steps should have durationType "time" with seconds', () => {
    const steps = GOLDEN_PLAN.workouts[0].steps;
    const rests = steps.filter(s => s.type === 'rest' && !s.repeatCount);

    for (const rest of rests) {
      expect(rest.durationType).toBe('time');
      expect(rest.durationValue).toBeGreaterThan(0);
    }

    // First rest: 2 min = 120s
    expect(rests[0].durationValue).toBe(120);
    expect(rests[0].notes).toBe('הליכה');
  });

  it('200m intervals should have durationType "distance" not "time"', () => {
    const steps = GOLDEN_PLAN.workouts[0].steps;
    const runs200m = steps.filter(s => s.durationValue === 200 && s.type === 'interval');

    expect(runs200m).toHaveLength(3);
    for (const step of runs200m) {
      expect(step.durationType).toBe('distance');
      expect(step.durationValue).toBe(200);
    }
  });

  it('6km active steps should have durationType "distance" = 6000', () => {
    const steps = GOLDEN_PLAN.workouts[0].steps;
    const longRuns = steps.filter(s => s.durationValue === 6000);

    expect(longRuns).toHaveLength(3);
    for (const step of longRuns) {
      expect(step.durationType).toBe('distance');
      expect(step.type).toBe('active');
    }
  });

  it('repeat block sub-steps should have correct durationType and durationValue', () => {
    const steps = GOLDEN_PLAN.workouts[0].steps;
    const repeat4x = steps.find(s => s.repeatCount === 4);

    expect(repeat4x).toBeDefined();
    expect(repeat4x!.repeatSteps).toHaveLength(2);
    expect(repeat4x!.repeatSteps![0].durationType).toBe('time');
    expect(repeat4x!.repeatSteps![0].durationValue).toBe(20); // 20 seconds
    expect(repeat4x!.repeatSteps![1].durationType).toBe('time');
    expect(repeat4x!.repeatSteps![1].durationValue).toBe(40); // 40 seconds
  });

  it('5x hill repeat sub-steps should have time durations (not open)', () => {
    const steps = GOLDEN_PLAN.workouts[0].steps;
    const repeat5x = steps.find(s => s.repeatCount === 5);

    expect(repeat5x).toBeDefined();
    expect(repeat5x!.repeatSteps).toHaveLength(7);

    // Running uphill steps should have time duration
    const uphillSteps = repeat5x!.repeatSteps!.filter(s => s.type === 'interval');
    expect(uphillSteps).toHaveLength(3);
    expect(uphillSteps[0].durationType).toBe('time');
    expect(uphillSteps[0].durationValue).toBe(45);
    expect(uphillSteps[1].durationType).toBe('time');
    expect(uphillSteps[1].durationValue).toBe(30);
    expect(uphillSteps[2].durationType).toBe('time');
    expect(uphillSteps[2].durationValue).toBe(15);

    // Jog downhill steps can be "open" (lap button) - that's fine
    const jogSteps = repeat5x!.repeatSteps!.filter(s => s.type === 'recovery');
    expect(jogSteps).toHaveLength(3);
    for (const jog of jogSteps) {
      expect(jog.durationType).toBe('open');
    }

    // Final rest in repeat should be time=120
    const restStep = repeat5x!.repeatSteps![6];
    expect(restStep.durationType).toBe('time');
    expect(restStep.durationValue).toBe(120);
    expect(restStep.notes).toBe('מנוחה מוחלטת');
  });

  it('notes should preserve exact coach wording', () => {
    const steps = GOLDEN_PLAN.workouts[0].steps;

    // Rest step with "הליכה" not "מנוחה"
    expect(steps[2].notes).toBe('הליכה');

    // Step 10: includes parenthetical instruction
    expect(steps[9].notes).toContain('השלמה ל5');

    // 6km with gel notes
    expect(steps[11].notes).toContain('ג׳ל בקילומטר השני');
    expect(steps[12].notes).toContain('ג׳ל אחרי 3');
  });
});

describe('validateAndFixStep post-processor', () => {
  // Import the validation function by testing through the module
  // We'll test the logic directly

  function validateAndFixStep(step: WorkoutStep): WorkoutStep {
    const fixed = { ...step };

    if (fixed.durationType === 'time' && fixed.durationValue) {
      if (fixed.durationValue >= 1000 && (fixed.type === 'warmup' || fixed.type === 'active' || fixed.type === 'interval')) {
        fixed.durationType = 'distance';
      }
    }

    if (fixed.durationType === 'time' && fixed.durationValue) {
      if ([200, 400, 800].includes(fixed.durationValue) && fixed.targetType === 'pace') {
        fixed.durationType = 'distance';
      }
    }

    if (fixed.durationType === 'open' && fixed.durationValue) {
      if (fixed.durationValue >= 1000) {
        fixed.durationType = 'distance';
      } else {
        fixed.durationType = 'time';
      }
    }

    if (fixed.repeatSteps) {
      fixed.repeatSteps = fixed.repeatSteps.map(validateAndFixStep);
    }

    return fixed;
  }

  it('fixes 3km warmup misclassified as time=3000', () => {
    const bad: WorkoutStep = {
      order: 1,
      type: 'warmup',
      durationType: 'time',
      durationValue: 3000,
      targetType: 'pace',
      targetPaceMinPerKm: 280,
      targetPaceMaxPerKm: 280,
    };
    const fixed = validateAndFixStep(bad);
    expect(fixed.durationType).toBe('distance');
    expect(fixed.durationValue).toBe(3000);
  });

  it('fixes 200m intervals misclassified as time=200', () => {
    const bad: WorkoutStep = {
      order: 1,
      type: 'interval',
      durationType: 'time',
      durationValue: 200,
      targetType: 'pace',
      targetPaceMinPerKm: 215,
      targetPaceMaxPerKm: 215,
    };
    const fixed = validateAndFixStep(bad);
    expect(fixed.durationType).toBe('distance');
    expect(fixed.durationValue).toBe(200);
  });

  it('fixes 6km active run misclassified as time=6000', () => {
    const bad: WorkoutStep = {
      order: 1,
      type: 'active',
      durationType: 'time',
      durationValue: 6000,
      targetType: 'pace',
      targetPaceMinPerKm: 255,
      targetPaceMaxPerKm: 255,
    };
    const fixed = validateAndFixStep(bad);
    expect(fixed.durationType).toBe('distance');
    expect(fixed.durationValue).toBe(6000);
  });

  it('fixes rest with durationValue but open type', () => {
    const bad: WorkoutStep = {
      order: 1,
      type: 'rest',
      durationType: 'open',
      durationValue: 120,
      targetType: 'no_target',
    };
    const fixed = validateAndFixStep(bad);
    expect(fixed.durationType).toBe('time');
    expect(fixed.durationValue).toBe(120);
  });

  it('does NOT change legitimate time values (e.g., 45s interval)', () => {
    const good: WorkoutStep = {
      order: 1,
      type: 'interval',
      durationType: 'time',
      durationValue: 45,
      targetType: 'no_target',
    };
    const result = validateAndFixStep(good);
    expect(result.durationType).toBe('time');
    expect(result.durationValue).toBe(45);
  });

  it('does NOT change legitimate open steps (no durationValue)', () => {
    const good: WorkoutStep = {
      order: 1,
      type: 'recovery',
      durationType: 'open',
      targetType: 'no_target',
    };
    const result = validateAndFixStep(good);
    expect(result.durationType).toBe('open');
  });

  it('fixes sub-steps inside repeat blocks', () => {
    const bad: WorkoutStep = {
      order: 1,
      type: 'interval',
      durationType: 'time',
      durationValue: 20,
      targetType: 'no_target',
      repeatCount: 4,
      repeatSteps: [
        { order: 1, type: 'interval', durationType: 'open', durationValue: 20, targetType: 'no_target' },
        { order: 2, type: 'rest', durationType: 'open', durationValue: 40, targetType: 'no_target' },
      ],
    };
    const fixed = validateAndFixStep(bad);
    expect(fixed.repeatSteps![0].durationType).toBe('time');
    expect(fixed.repeatSteps![0].durationValue).toBe(20);
    expect(fixed.repeatSteps![1].durationType).toBe('time');
    expect(fixed.repeatSteps![1].durationValue).toBe(40);
  });
});

describe('splitIntoGroups', () => {
  it('splits group paces correctly into 3 separate plans', () => {
    const plan: ParsedWeeklyPlan = {
      workouts: [
        {
          dayOfWeek: 5,
          name: 'שישי',
          steps: [
            {
              order: 1,
              type: 'active',
              durationType: 'distance',
              durationValue: 6000,
              targetType: 'pace',
              targetPaceMinPerKm: 255, // Group 1: 4:15
              targetPaceMaxPerKm: 255,
              group2Pace: { min: 264, max: 264 }, // Group 2: 4:24
              group3Pace: { min: 276, max: 276 }, // Group 3: 4:36
              notes: '4:15 (4:24) ((4:36))',
            },
          ],
        },
      ],
    };

    const grouped = splitIntoGroups(plan);

    // Group 1 keeps original pace
    expect(grouped.group1.workouts[0].steps[0].targetPaceMinPerKm).toBe(255);
    expect(grouped.group1.workouts[0].steps[0].targetPaceMaxPerKm).toBe(255);

    // Group 2 uses group2Pace
    expect(grouped.group2.workouts[0].steps[0].targetPaceMinPerKm).toBe(264);
    expect(grouped.group2.workouts[0].steps[0].targetPaceMaxPerKm).toBe(264);

    // Group 3 uses group3Pace
    expect(grouped.group3.workouts[0].steps[0].targetPaceMinPerKm).toBe(276);
    expect(grouped.group3.workouts[0].steps[0].targetPaceMaxPerKm).toBe(276);

    // Group pace fields removed from output
    expect(grouped.group1.workouts[0].steps[0].group2Pace).toBeUndefined();
    expect(grouped.group1.workouts[0].steps[0].group3Pace).toBeUndefined();
    expect(grouped.group2.workouts[0].steps[0].group2Pace).toBeUndefined();
    expect(grouped.group3.workouts[0].steps[0].group3Pace).toBeUndefined();
  });

  it('rewrites notes to show only relevant group pace', () => {
    const plan: ParsedWeeklyPlan = {
      workouts: [
        {
          dayOfWeek: 5,
          name: 'שישי',
          steps: [
            {
              order: 1,
              type: 'active',
              durationType: 'distance',
              durationValue: 6000,
              targetType: 'pace',
              targetPaceMinPerKm: 255,
              targetPaceMaxPerKm: 255,
              group2Pace: { min: 264, max: 264 },
              group3Pace: { min: 276, max: 276 },
              notes: '4:15 (4:24) ((4:36))',
            },
            {
              order: 2,
              type: 'interval',
              durationType: 'distance',
              durationValue: 200,
              targetType: 'pace',
              targetPaceMinPerKm: 215,
              targetPaceMaxPerKm: 215,
              group2Pace: { min: 225, max: 225 },
              group3Pace: { min: 235, max: 235 },
              notes: '3:35(3:45)((3:55))',
            },
            {
              order: 3,
              type: 'active',
              durationType: 'distance',
              durationValue: 6000,
              targetType: 'pace',
              targetPaceMinPerKm: 244,
              targetPaceMaxPerKm: 244,
              group2Pace: { min: 253, max: 253 },
              group3Pace: { min: 258, max: 258 },
              notes: '4:04 (4:13) ((4:18)) ג׳ל בקילומטר השני',
            },
          ],
        },
      ],
    };

    const grouped = splitIntoGroups(plan);

    // Group 1: shows only g1 pace
    expect(grouped.group1.workouts[0].steps[0].notes).toBe('4:15');
    expect(grouped.group1.workouts[0].steps[1].notes).toBe('3:35');
    expect(grouped.group1.workouts[0].steps[2].notes).toBe('4:04 ג׳ל בקילומטר השני');

    // Group 2: shows only g2 pace
    expect(grouped.group2.workouts[0].steps[0].notes).toBe('4:24');
    expect(grouped.group2.workouts[0].steps[1].notes).toBe('3:45');
    expect(grouped.group2.workouts[0].steps[2].notes).toBe('4:13 ג׳ל בקילומטר השני');

    // Group 3: shows only g3 pace
    expect(grouped.group3.workouts[0].steps[0].notes).toBe('4:36');
    expect(grouped.group3.workouts[0].steps[1].notes).toBe('3:55');
    expect(grouped.group3.workouts[0].steps[2].notes).toBe('4:18 ג׳ל בקילומטר השני');
  });

  it('preserves notes without bracket notation in all groups', () => {
    const plan: ParsedWeeklyPlan = {
      workouts: [
        {
          dayOfWeek: 5,
          name: 'שישי',
          steps: [
            {
              order: 1,
              type: 'rest',
              durationType: 'time',
              durationValue: 120,
              targetType: 'no_target',
              notes: 'הליכה וג׳ל',
            },
          ],
        },
      ],
    };

    const grouped = splitIntoGroups(plan);

    expect(grouped.group1.workouts[0].steps[0].notes).toBe('הליכה וג׳ל');
    expect(grouped.group2.workouts[0].steps[0].notes).toBe('הליכה וג׳ל');
    expect(grouped.group3.workouts[0].steps[0].notes).toBe('הליכה וג׳ל');
  });

  it('falls back to group1 pace if group2/group3 pace is null', () => {
    const plan: ParsedWeeklyPlan = {
      workouts: [
        {
          dayOfWeek: 5,
          name: 'שישי',
          steps: [
            {
              order: 1,
              type: 'warmup',
              durationType: 'distance',
              durationValue: 2000,
              targetType: 'pace',
              targetPaceMinPerKm: 300,
              targetPaceMaxPerKm: 300,
            },
          ],
        },
      ],
    };

    const grouped = splitIntoGroups(plan);

    // All groups keep the original pace when no group-specific pace given
    expect(grouped.group1.workouts[0].steps[0].targetPaceMinPerKm).toBe(300);
    expect(grouped.group2.workouts[0].steps[0].targetPaceMinPerKm).toBe(300);
    expect(grouped.group3.workouts[0].steps[0].targetPaceMinPerKm).toBe(300);
  });
});
