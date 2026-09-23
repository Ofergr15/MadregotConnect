import { describe, expect, it } from 'vitest';
import {
  initialLogFilter, logCounts, logLoadErrorText, logState, matchesLogFilter, sortForLogFilter, type LogRow,
} from '@/lib/admin/registrations-log';

const row = (status: LogRow['status'], stage: LogRow['stage'] = status, createdAt = '2026-09-20T10:00:00Z'): LogRow =>
  ({ status, stage, createdAt });

describe('logState', () => {
  it('shows an approved row by its stage', () => {
    expect(logState(row('approved', 'emailed'))).toBe('emailed');
    expect(logState(row('approved', 'connected'))).toBe('connected');
    expect(logState(row('approved', 'done'))).toBe('done');
  });
  it('treats an approved row with no stage as not started', () => {
    expect(logState(row('approved', 'approved'))).toBe('emailed');
  });
  it('passes the other statuses through', () => {
    for (const s of ['pending', 'rejected', 'member'] as const) expect(logState(row(s))).toBe(s);
  });
});

describe('filters', () => {
  const rows = [
    row('pending'), row('pending'),
    row('approved', 'emailed'), row('approved', 'connected'), row('approved', 'done'),
    row('rejected'), row('member'),
  ];
  it('counts agree with the filter', () => {
    const c = logCounts(rows);
    expect(c).toEqual({ pending: 2, stuck: 2, in: 1, all: 7 });
    expect(rows.filter(r => matchesLogFilter(r, 'stuck')).length).toBe(c.stuck);
  });
  it('opens on the first filter with anybody in it', () => {
    expect(initialLogFilter(rows)).toBe('pending');
    expect(initialLogFilter([row('approved', 'emailed'), row('member')])).toBe('stuck');
    expect(initialLogFilter([row('member')])).toBe('all');
    expect(initialLogFilter([])).toBe('all');
  });
});

describe('sortForLogFilter', () => {
  const a = row('pending', 'pending', '2026-09-01T00:00:00Z');
  const b = row('pending', 'pending', '2026-09-05T00:00:00Z');
  it('puts the longest wait first on a worklist and the newest first on a history', () => {
    expect(sortForLogFilter([b, a], 'pending')).toEqual([a, b]);
    expect(sortForLogFilter([a, b], 'all')).toEqual([b, a]);
  });
});

describe('logLoadErrorText', () => {
  it('names a refusal as a refusal, not as an empty log (#82)', () => {
    expect(logLoadErrorText(403).title).toContain('לא מאשר');
    expect(logLoadErrorText(500).title).toBe('היומן לא נטען');
  });
});
