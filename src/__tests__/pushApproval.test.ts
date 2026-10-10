import { describe, expect, it } from 'vitest';
import { gateState, parseApprovals, shouldAsk, stageDue, withDecision } from '@/lib/notifications/approval';

describe('push approval gate', () => {
  const store = parseApprovals(JSON.stringify({ mode: 'quality', days: { '2026-10-13': { status: 'approved', by: 'Ofer', at: 'x' } } }));

  it('defaults to quality mode with nothing approved', () => {
    expect(parseApprovals(null)).toEqual({ mode: 'quality', days: {} });
    expect(parseApprovals('not json').mode).toBe('quality');
  });

  it('needs an approval only for quality days in quality mode', () => {
    expect(gateState(store, '2026-10-16', false)).toBe('not_needed');
    expect(gateState(store, '2026-10-16', true)).toBe('pending');
    expect(gateState(store, '2026-10-13', true)).toBe('approved');
    expect(gateState({ ...store, mode: 'team' }, '2026-10-16', false)).toBe('pending');
    expect(gateState({ ...store, mode: 'off' }, '2026-10-16', true)).toBe('not_needed');
  });

  it('without a gate fires in the stage hour only, as before', () => {
    expect(stageDue('not_needed', 8, 8, 18)).toBe(true);
    expect(stageDue('not_needed', 9, 8, 18)).toBe(false);
  });

  it('never fires while pending or skipped', () => {
    for (const h of [7, 8, 12, 18]) {
      expect(stageDue('pending', h, 8, 18)).toBe(false);
      expect(stageDue('skipped', h, 8, 18)).toBe(false);
    }
  });

  it('a late approval still sends what is left of the window', () => {
    expect(stageDue('approved', 10, 8, 18)).toBe(true);
    expect(stageDue('approved', 18, 8, 18)).toBe(false);
    expect(stageDue('approved', 7, 8, 18)).toBe(false);
    expect(stageDue('approved', 20, 18, 21)).toBe(true);
    expect(stageDue('approved', 21, 18, 21)).toBe(false);
  });

  it('asks from the hour before the first push until the last one', () => {
    expect(shouldAsk('pending', 6, 8, 18)).toBe(false);
    expect(shouldAsk('pending', 7, 8, 18)).toBe(true);
    expect(shouldAsk('pending', 18, 8, 18)).toBe(true);
    expect(shouldAsk('pending', 19, 8, 18)).toBe(false);
    expect(shouldAsk('approved', 7, 8, 18)).toBe(false);
  });

  it('writes, replaces and drops decisions; prunes old ones', () => {
    const s1 = withDecision(store, '2026-10-16', { status: 'skipped', by: 'A', at: 'y' }, '2026-10-10');
    expect(s1.days['2026-10-16'].status).toBe('skipped');
    expect(s1.days['2026-10-13'].status).toBe('approved');
    expect(withDecision(s1, '2026-10-16', null, '2026-10-10').days['2026-10-16']).toBeUndefined();
    const old = withDecision({ mode: 'quality', days: { '2026-08-01': { status: 'approved', by: '', at: '' } } }, '2026-10-13', null, '2026-10-10');
    expect(old.days['2026-08-01']).toBeUndefined();
  });
});
