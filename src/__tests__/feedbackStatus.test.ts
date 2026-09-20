import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_STATUS_ORDER, normalizeStatus, splitByPhase, statusPhase,
  STATUS_LABEL_KEY, STATUS_PILL, type FeedbackStatus,
} from '@/lib/feedback/status';

// 2d076a9c — "hard to tell which bugs were fixed". The grouping rule both the
// staff inbox and the athlete's own list read from is here, so it is tested here.
describe('feedback status phases', () => {
  it('treats done and denied as resolved and everything else as open', () => {
    expect(statusPhase('done')).toBe('resolved');
    expect(statusPhase('denied')).toBe('resolved');
    expect(statusPhase('new')).toBe('open');
    expect(statusPhase('sprint')).toBe('open');
    expect(statusPhase('idea')).toBe('open');
  });

  it('treats an unknown or missing status as open', () => {
    // Rows predating the status column, and anything a future migration adds
    // without telling this file, must not be able to hide in the closed pile.
    expect(statusPhase(null)).toBe('open');
    expect(statusPhase(undefined)).toBe('open');
    expect(statusPhase('')).toBe('open');
    expect(statusPhase('triaged')).toBe('open');
  });

  it('normalizes an unreadable status to new', () => {
    expect(normalizeStatus(null)).toBe('new');
    expect(normalizeStatus('nonsense')).toBe('new');
    expect(normalizeStatus('done')).toBe('done');
  });

  it('orders open states before resolved ones', () => {
    const phases = FEEDBACK_STATUS_ORDER.map(statusPhase);
    expect(phases).toEqual(['open', 'open', 'open', 'resolved', 'resolved']);
  });

  it('has a label key and a pill for every status, and no extras', () => {
    expect(Object.keys(STATUS_LABEL_KEY).sort()).toEqual([...FEEDBACK_STATUS_ORDER].sort());
    expect(Object.keys(STATUS_PILL).sort()).toEqual([...FEEDBACK_STATUS_ORDER].sort());
  });

  it('splits a list in two, keeping the order it was given', () => {
    const rows: { id: string; status: FeedbackStatus | null }[] = [
      { id: 'a', status: 'done' },
      { id: 'b', status: 'new' },
      { id: 'c', status: null },
      { id: 'd', status: 'denied' },
      { id: 'e', status: 'sprint' },
    ];
    const { open, resolved } = splitByPhase(rows, r => r.status);
    expect(open.map(r => r.id)).toEqual(['b', 'c', 'e']);
    expect(resolved.map(r => r.id)).toEqual(['a', 'd']);
  });
});
