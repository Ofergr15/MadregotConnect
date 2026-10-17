import { describe, expect, it } from 'vitest';
import { findNewRecords, newRecordUrl, RECENT_DAYS } from '@/lib/prs/new-record-alert';
import { newRecordCopy } from '@/lib/notifications/copy';
import type { RunActivityRow } from '@/lib/prs/pr-buckets';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const run = (id: string, date: string, seconds: number, type = 'running'): RunActivityRow =>
  ({ id, activity_name: id, activity_type: type, start_time: date, distance: 5000, duration: seconds });
const old = run('march', '2026-03-27T06:00:00Z', 1117);
const today = run('today', '2026-09-23T05:53:17Z', 1092);

describe('findNewRecords', () => {
  it('a fresh run that beats the record is news, with what it beat it by', () => {
    expect(findNewRecords([old, today], { now: NOW })).toEqual([{ activityId: 'today', bucket: '5k', seconds: 1092, gainSec: 25 }]);
  });

  it('the first record at a distance is not — that is the "first 5K" badge', () => {
    expect(findNewRecords([today], { now: NOW })).toEqual([]);
  });

  it(`a run older than ${RECENT_DAYS} days is not, however it got here (a backfill)`, () => {
    expect(findNewRecords([old, today], { now: NOW + (RECENT_DAYS + 1) * 86_400_000 })).toEqual([]);
  });

  it('a stated record still faster keeps the record: nothing moved', () => {
    expect(findNewRecords([old, today], { now: NOW, stated: new Map([['5k', 1000]]) })).toEqual([]);
  });

  it('a run taken out of the records is not news, and neither is a treadmill run', () => {
    expect(findNewRecords([old, today], { now: NOW, excluded: new Map([['today', new Set(['*'])]]) })).toEqual([]);
    expect(findNewRecords([old, run('tm', '2026-09-23T05:00:00Z', 900, 'treadmill_running')], { now: NOW })).toEqual([]);
  });

  it('opens the record screen on that run', () => {
    expect(newRecordUrl('me', { bucket: '5k', activityId: 'today' })).toBe('/dashboard/teammate/me/records/5k?new=today');
  });
});

describe('newRecordCopy', () => {
  it('says the distance in Hebrew — "5K" beside a colon flips on a lock screen', () => {
    const c = newRecordCopy('he', { distancesHe: ['5 ק״מ'], distancesEn: ['5K'], time: '18:12', gainSec: 25 });
    expect(c.title).toBe('🏆 שיא חדש ב־5 ק״מ: 18:12');
    expect(c.title + c.body).not.toMatch(/5K/);
    expect(c.body).toContain('25 שניות');
  });

  it('one push for a run that broke two', () => {
    const c = newRecordCopy('he', { distancesHe: ['5 ק״מ', '10 ק״מ'], distancesEn: ['5K', '10K'], time: '18:12', gainSec: 25 });
    expect(c.title).toContain('2 שיאים חדשים');
  });
});
