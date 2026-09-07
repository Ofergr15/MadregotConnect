import { describe, expect, it } from 'vitest';
import { distanceLine } from '@/lib/run-chat/garmin-clipboard';
import { parsedWorkoutToClipboard } from '@/lib/plans/clipboard';
import type { ParsedWorkout } from '@/lib/ai/types';

// The line under the title on the athlete's board. Two things about it are easy
// to break and invisible in a code review: the direction it renders in, and
// whether a derived figure still admits to being derived.

const ISOLATE_START = '⁧'; // RLI
const ISOLATE_END = '⁩'; // PDI

describe('distanceLine', () => {
  it('writes the range with the number first for a Hebrew reader', () => {
    // The isolate is the whole fix, not decoration: resvg lays every text run on
    // a hard left-to-right base and ignores `direction="rtl"`, so unwrapped this
    // rendered number-leftmost and "ק״מ" rightmost — the line backwards.
    const line = distanceLine({ min: 11, max: 13, estimated: false })!;
    expect(line.startsWith(ISOLATE_START)).toBe(true);
    expect(line.endsWith(ISOLATE_END)).toBe(true);
    expect(line.slice(1, -1)).toBe('11-13 ק״מ');
  });

  it('marks a derived figure as calculated', () => {
    // A session written only in minutes has no stated distance; the board still
    // gets one, and has to say where it came from.
    const line = distanceLine({ min: 12, max: 15, estimated: true })!;
    expect(line).toContain('מחושב');
    expect(line.endsWith(ISOLATE_END)).toBe(true);
  });

  it('prints one number when both ends match', () => {
    // "12-12 ק״מ" reads as a mistake.
    expect(distanceLine({ min: 12, max: 12, estimated: false })!.slice(1, -1)).toBe('12 ק״מ');
  });

  it('uses an ASCII hyphen, not an en-dash', () => {
    // The hyphen keeps the two ends bound to the number; an en-dash lets the
    // surrounding Hebrew flip them into a countdown.
    expect(distanceLine({ min: 11, max: 13, estimated: false })).not.toContain('–');
  });

  it('rounds to one decimal rather than printing the summing dust', () => {
    expect(distanceLine({ min: 13.400000000000006, max: 20.700000000000003, estimated: true })).toContain(
      '13.4-20.7',
    );
  });

  it('has no line at all for a session with no distance in it', () => {
    // A drills or strength evening. A blank row is worse than no row.
    expect(distanceLine(undefined)).toBeNull();
    expect(distanceLine({ min: 0, max: 0, estimated: false })).toBeNull();
  });
});

describe('what reaches the board', () => {
  const workout = (steps: unknown[]): ParsedWorkout =>
    ({ dayOfWeek: 3, name: 'יום רביעי', steps } as ParsedWorkout);

  it('carries a stated distance across unmarked', () => {
    const card = parsedWorkoutToClipboard(
      workout([
        { order: 1, type: 'active', durationType: 'distance', durationValue: 14000, targetType: 'pace' },
      ]),
    );
    expect(card.distanceKm).toMatchObject({ estimated: false });
    expect(distanceLine(card.distanceKm)).not.toContain('מחושב');
  });

  it('carries a time-only session across as a calculated range', () => {
    // 70–90 minutes of easy running: no kilometres anywhere in the session, and
    // the athlete still wants to know roughly how far they are going.
    const card = parsedWorkoutToClipboard(
      workout([
        {
          order: 1,
          type: 'active',
          durationType: 'time',
          durationValue: 4200,
          durationMaxValue: 5400,
          targetType: 'no_target',
          notes: '70-90 דק׳ ריצת שחרור קלה',
        },
      ]),
    );
    expect(card.distanceKm!.estimated).toBe(true);
    expect(card.distanceKm!.max).toBeGreaterThan(card.distanceKm!.min);
    expect(distanceLine(card.distanceKm)).toContain('מחושב');
  });

  it('leaves a drills session without a distance', () => {
    const card = parsedWorkoutToClipboard(
      workout([{ order: 1, type: 'active', durationType: 'open', targetType: 'no_target', notes: 'תרגילי כוח' }]),
    );
    expect(card.distanceKm).toBeUndefined();
  });
});
