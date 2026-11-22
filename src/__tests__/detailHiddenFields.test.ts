import { describe, expect, it } from 'vitest';
import { maskDetailForViewer, readHiddenFields } from '@/lib/feed/project';

/**
 * GET /api/activities/details honours the share sheet's hiddenFields for every viewer
 * but the athlete: calories, HR (avg + max + per-km) and pace (avg + per-km splits).
 * Synthetic values only.
 */

const row = { id: 'r1', calories: 640, average_hr: 151, max_hr: 172, average_pace: 275, distance: 10000 };
const splits = [{ distance: 1000, duration: 270, averagePace: 270, averageHR: 150, elevationGain: null, elevationLoss: null, averageCadence: null, averagePower: null }];

describe('activity detail honours hiddenFields for other viewers', () => {
  it('hides exactly what was hidden', () => {
    const all = maskDetailForViewer(row, splits, readHiddenFields({ hiddenFields: ['calories', 'heart_rate', 'pace'] }));
    expect(all.row).toMatchObject({ calories: null, average_hr: null, max_hr: null, average_pace: null, distance: 10000 });
    expect(all.splits).toEqual([]);
  });

  it('heart rate only: splits keep pace, lose HR', () => {
    const hr = maskDetailForViewer(row, splits, readHiddenFields({ hiddenFields: ['heart_rate'] }));
    expect(hr.row).toMatchObject({ average_hr: null, max_hr: null, calories: 640, average_pace: 275 });
    expect(hr.splits[0]).toMatchObject({ averagePace: 270, averageHR: null });
  });

  it('nothing hidden / junk payload changes nothing', () => {
    expect(maskDetailForViewer(row, splits, readHiddenFields({ hiddenFields: ['gps', 42] })).row).toBe(row);
    expect(maskDetailForViewer(row, splits, readHiddenFields(null)).splits).toBe(splits);
  });
});
