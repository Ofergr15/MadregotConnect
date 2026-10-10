import { describe, expect, it } from 'vitest';
import type { ParsedWorkout } from '@/lib/ai/types';
import { slotKey, watchOnWatchCopy, watchSentCopy, workoutLine } from '@/lib/notifications/watch-push-copy';

// Shapes from the real week of 2026-10-04 (group 1).
const w = (o: Partial<ParsedWorkout>): ParsedWorkout => ({ dayOfWeek: 0, name: '', steps: [], ...o } as ParsedWorkout);
const easy = { steps: [{ type: 'active', durationType: 'time', durationValue: 3600 }] } as Partial<ParsedWorkout>;
const reps = { steps: [{ type: 'interval', repeatCount: 10, repeatSteps: [{ type: 'interval', durationType: 'time', durationValue: 30 }, { type: 'rest', durationType: 'time', durationValue: 60 }] }] } as Partial<ParsedWorkout>;
const sun = w({ ...reps, dayOfWeek: 0, name: 'יום ראשון', distanceMinKm: 17, distanceMaxKm: 19, expectedDurationSec: 4500, partKind: 'single' });
const monAm = w({ ...easy, dayOfWeek: 1, name: 'שני', distanceMinKm: 11, distanceMaxKm: 13, expectedDurationSec: 3600, partKind: 'morning', partIndex: 1 });
const monPm = w({ ...easy, dayOfWeek: 1, name: 'שני - ערב אופציה', expectedDurationSec: 2400, partKind: 'evening', partIndex: 2, optional: true });
const tue = w({ ...reps, dayOfWeek: 2, name: 'שלישי', distanceMinKm: 22, distanceMaxKm: 24, expectedDurationSec: 6640, partKind: 'single', optional: true });
const fri = w({ ...easy, dayOfWeek: 5, name: 'שישי - חצי מרתון מרוץ הסרגל', distanceMinKm: 25, distanceMaxKm: 25, expectedDurationSec: 6156 });

describe('watch push copy', () => {
  it('one workout: the day in the title, type · km · duration in the body', () => {
    expect(watchSentCopy('he', [sun])).toEqual({ title: '⌚ אימון יום ראשון נשלח לשעון', body: 'אימון חזרות · 17–19 ק״מ · 75 דק׳' });
  });

  it("uses the coach's name from the plan, never a bare day name", () => {
    expect(watchSentCopy('he', [fri]).body).toBe('חצי מרתון מרוץ הסרגל · 25 ק״מ · 1:45 ש׳');
    expect(workoutLine(sun, 'he')).not.toContain('ראשון');
  });

  it('stars a quality day and ignores the main session’s optional flag', () => {
    expect(watchSentCopy('he', [tue], { qualityDows: [2] }).body).toBe('⭐ אימון חזרות · 22–24 ק״מ · 1:50 ש׳');
    expect(watchSentCopy('he', [tue]).body).not.toContain('אופציה');
  });

  it("the coach's own line wins", () => {
    expect(watchSentCopy('he', [sun], { lines: { [slotKey(sun)]: 'עליות בפארק הירקון' } }).body).toBe('עליות בפארק הירקון');
  });

  it('morning + evening of one day', () => {
    expect(watchSentCopy('he', [monPm, monAm])).toEqual({
      title: '⌚ 2 אימוני יום שני נשלחו לשעון',
      body: 'בוקר: ריצה קלה 11–13 ק״מ · ערב אופציה: ריצה קלה 40 דק׳',
    });
  });

  it('two days: one short line each', () => {
    expect(watchSentCopy('he', [monAm, sun]).body).toBe('ראשון: אימון חזרות 17–19 ק״מ · שני: ריצה קלה 11–13 ק״מ');
  });

  it('four or more: total km (optional evenings out) and tomorrow', () => {
    const c = watchSentCopy('he', [sun, monAm, monPm, tue, fri], { weekStartDate: '2026-10-04', today: '2026-10-03' });
    expect(c.title).toBe('⌚ 5 אימונים נשלחו לשעון');
    expect(c.body).toBe('סה״כ 75–81 ק״מ · מחר: אימון חזרות 17–19 ק״מ');
  });

  it('English too', () => {
    expect(watchSentCopy('en', [sun]).title).toBe("⌚ Sunday's workout sent to your watch");
    expect(watchSentCopy('en', [sun]).body).toBe('Intervals · 17–19 km · 75 min');
  });

  it('Apple step 2: on the watch', () => {
    expect(watchOnWatchCopy('he', [0]).title).toBe('✅ אימון יום ראשון נכנס לשעון');
    expect(watchOnWatchCopy('he', [0, 1]).title).toBe('✅ 2 אימונים נכנסו לשעון');
  });
});
