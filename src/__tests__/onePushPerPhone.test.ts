import { describe, expect, it } from 'vitest';
import { duplicateInstalls, type SubDevice } from '@/lib/push-ghosts';

const NOW = Date.parse('2026-10-16T15:00:00Z');
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15';
const sub = (id: string, last: string | null, ua: string | null = IOS, athlete = 'ofer'): SubDevice =>
  ({ id, athlete_id: athlete, created_at: '2026-10-01T00:00:00Z', last_success_at: last, user_agent: ua });

describe('one notification per phone', () => {
  // Ofer's account on 2026-10-16: two installs on one iPhone, both live.
  it('sends to the install that confirmed most recently, not both', () => {
    expect(duplicateInstalls([sub('3e728f14', '2026-10-16T13:16:10Z'), sub('9d456182', '2026-10-16T13:16:05Z')], NOW)).toEqual(['9d456182']);
  });

  it('sends to all again when even the freshest install has shown nothing for 3 days', () => {
    expect(duplicateInstalls([sub('a', '2026-10-12T00:00:00Z'), sub('b', '2026-10-11T00:00:00Z')], NOW)).toEqual([]);
  });

  it('never merges different phones, different people, or a device with no user agent', () => {
    const ipad = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X)';
    expect(duplicateInstalls([sub('a', '2026-10-16T10:00:00Z'), sub('b', '2026-10-16T09:00:00Z', ipad)], NOW)).toEqual([]);
    expect(duplicateInstalls([sub('a', '2026-10-16T10:00:00Z'), sub('b', '2026-10-16T09:00:00Z', IOS, 'dana')], NOW)).toEqual([]);
    expect(duplicateInstalls([sub('a', '2026-10-16T10:00:00Z', null), sub('b', '2026-10-16T09:00:00Z', null)], NOW)).toEqual([]);
  });

  it('an install that never confirmed is skipped beside one that does', () => {
    expect(duplicateInstalls([sub('live', '2026-10-16T10:00:00Z'), sub('new', null)], NOW)).toEqual(['new']);
  });
});
