import { describe, expect, it } from 'vitest';
import { migrationRow, migrationSummary } from '@/lib/academy/migration';

// The move-in board (migration plan, screens A–B): where each moved-in trainee is.

const base = { status: 'active', hasWatch: true, test: 'ok' as const, answered: true, hasPersonalWeek: true, movedOn: '2026-10-10' };
const T = '2026-10-17';

describe('where a moved-in trainee is', () => {
  it('done when every step is', () => {
    expect(migrationRow(base, T)).toMatchObject({ step: 'done', at: 6, owner: null, stuck: false });
  });
  it('the first step not done is where they are, in order', () => {
    expect(migrationRow({ ...base, status: 'invited', hasWatch: false }, T).step).toBe('joined');
    expect(migrationRow({ ...base, hasWatch: false, test: 'none' }, T).step).toBe('watch');
    expect(migrationRow({ ...base, test: 'none', answered: false }, T).step).toBe('test');
    expect(migrationRow({ ...base, answered: false }, T).step).toBe('questions');
    expect(migrationRow({ ...base, hasPersonalWeek: false }, T).step).toBe('firstWeek');
  });
  it('a test waiting for approval, and the first week, are the coach\'s move', () => {
    expect(migrationRow({ ...base, test: 'pending' }, T)).toMatchObject({ step: 'test', owner: 'coach', stuck: false });
    expect(migrationRow({ ...base, hasPersonalWeek: false }, T)).toMatchObject({ owner: 'coach', stuck: false });
  });
  it('a trainee step five days after the move is stuck; four is not', () => {
    expect(migrationRow({ ...base, hasWatch: false, movedOn: '2026-10-12' }, T).stuck).toBe(true);
    expect(migrationRow({ ...base, hasWatch: false, movedOn: '2026-10-13' }, T).stuck).toBe(false);
  });
  it('counts done, on the way and stuck without counting anyone twice', () => {
    const rows = [migrationRow(base, T), migrationRow({ ...base, hasWatch: false, movedOn: '2026-10-01' }, T), migrationRow({ ...base, answered: false, movedOn: T }, T)];
    expect(migrationSummary(rows)).toEqual({ done: 1, onTheWay: 1, stuck: 1 });
  });
});
