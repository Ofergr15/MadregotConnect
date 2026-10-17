import { describe, expect, it } from 'vitest';
import { mayViewHrTrace } from '@/lib/athletes/hr-trace-privacy';

describe('mayViewHrTrace', () => {
  it('always shows the runner and staff their own trace', () => {
    expect(mayViewHrTrace({ isSelfOrStaff: true, runnerAllows: false, hiddenOnThisRun: true })).toBe(true);
  });
  it('shows teammates the line only while the runner allows it and this run does not hide it', () => {
    expect(mayViewHrTrace({ isSelfOrStaff: false, runnerAllows: true, hiddenOnThisRun: false })).toBe(true);
    expect(mayViewHrTrace({ isSelfOrStaff: false, runnerAllows: false, hiddenOnThisRun: false })).toBe(false);
    expect(mayViewHrTrace({ isSelfOrStaff: false, runnerAllows: true, hiddenOnThisRun: true })).toBe(false);
  });
});
