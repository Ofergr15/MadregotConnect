import { describe, expect, it } from 'vitest';
import { clock, equivalent, kmh, packGoal, paceOf, parseTime, recommend } from '@/lib/join/pace';

/** The unified sign-up: a marathon time — or the next best — picks the pack or the academy (2026-10-20). */
describe('times', () => {
  it('reads h:mm:ss and mm:ss, refuses the rest', () => {
    expect(parseTime('2:41:20')).toBe(9680);
    expect(parseTime('41:20')).toBe(2480);
    expect(parseTime('2:61:00')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(clock(9680)).toBe('2:41:20');
  });
  it('the pack paces as the mockup shows them', () => {
    expect(paceOf(9000, 42.195)).toBe('3:33');
    expect(paceOf(9300, 42.195)).toBe('3:40');
    expect(paceOf(9900, 42.195)).toBe('3:55');
    expect(paceOf(9680, 42.195)).toBe('3:49');
    expect(kmh(9000, 42.195)).toBe(16.9);
  });
  it('a half or a 10K becomes a marathon equivalent', () => {
    expect(clock(equivalent(9000, 'marathon', '10k'))).toBe('32:36');
    expect(clock(equivalent(9000, 'marathon', 'half'))).toBe('1:11:57');
    expect(Math.round(equivalent(4720, 'half', 'marathon'))).toBeGreaterThan(9800);
  });
});

describe('which pack', () => {
  const packs = [{ id: 'c', goal: packGoal('Group C - SUB 2:45')! }, { id: 'a', goal: packGoal('Group A - SUB 2:30')! }, { id: 'b', goal: packGoal('Group B - SUB 2:35')! }];
  it('reads the goal from the pack name', () => expect(packGoal('Group B - SUB 2:35')).toBe(9300));
  it('the fastest pack the time is within; slower than all → the academy', () => {
    expect(recommend(8900, packs)?.id).toBe('a');
    expect(recommend(9250, packs)?.id).toBe('b');
    expect(recommend(9680, packs)?.id).toBe('c');
    expect(recommend(12600, packs)).toBeNull();
  });
});
