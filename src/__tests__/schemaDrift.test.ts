import { describe, expect, it } from 'vitest';
import { isMissingColumn, withoutColumns } from '@/lib/supabase/schema-drift';

// Real shapes, because the whole point of this predicate is that the app keeps
// working in the window between a deploy and someone applying the migration by
// hand in the Supabase SQL editor. Misreading one of these either breaks the
// request or silently drops a column that does exist.
const POSTGREST = {
  code: 'PGRST204',
  message: "Could not find the 'workout_key' column of 'workout_deliveries' in the schema cache",
};
const POSTGRES = {
  code: '42703',
  message: 'column athlete_activities.garmin_workout_id does not exist',
};

describe('isMissingColumn', () => {
  it('recognises both the PostgREST and the Postgres form', () => {
    expect(isMissingColumn(POSTGREST)).toBe(true);
    expect(isMissingColumn(POSTGRES)).toBe(true);
  });

  it('requires the named column when one is given', () => {
    expect(isMissingColumn(POSTGREST, 'workout_key')).toBe(true);
    expect(isMissingColumn(POSTGREST, 'garmin_workout_id')).toBe(false);
    expect(isMissingColumn(POSTGRES, 'garmin_workout_id')).toBe(true);
  });

  // A foreign-key violation, a missing table and a null are all different
  // problems; treating them as drift would retry a write that has to fail.
  it('is false for anything else', () => {
    expect(isMissingColumn({ code: '23503', message: 'violates foreign key constraint' })).toBe(false);
    expect(isMissingColumn({ code: 'PGRST205', message: 'Could not find the table' })).toBe(false);
    expect(isMissingColumn(new Error('boom'))).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
    expect(isMissingColumn(undefined)).toBe(false);
  });
});

describe('withoutColumns', () => {
  it('drops the columns from every row without touching the originals', () => {
    const rows = [
      { id: 'a', garmin_workout_id: '1', shoe_id: 's1' },
      { id: 'b', garmin_workout_id: '2', shoe_id: null },
    ];
    expect(withoutColumns(rows, ['garmin_workout_id', 'shoe_id'])).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
    expect(rows[0]).toEqual({ id: 'a', garmin_workout_id: '1', shoe_id: 's1' });
  });

  it('leaves a row alone when it never had the column', () => {
    expect(withoutColumns([{ id: 'a' }], ['garmin_workout_id'])).toEqual([{ id: 'a' }]);
  });
});
