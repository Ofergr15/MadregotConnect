import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
import { missingFrom } from '@/lib/watch/missing';
import { eveningCopy } from '@/lib/watch/evening-reminder';

// What should be on a runner's watch this week and is not (lib/watch/missing.ts) — the
// feed's "השבוע בשעון" card, the 20:00 reminder and the send after a reconnect.

const base = {
  today: '2026-10-20', weekStart: '2026-10-18', planDays: [0, 1, 2, 4, 5], clubSent: true,
  dayDates: [] as string[], dayInFlight: [] as string[], delivered: [] as string[], garminConnected: true, lastError: null as string | null,
};

describe('what is missing from the watch', () => {
  it('only from today on, and only what the club sent', () => {
    const m = missingFrom({ ...base, delivered: ['2026-10-20', '2026-10-22'] });
    expect(m.expected).toEqual(['2026-10-20', '2026-10-22', '2026-10-23']);
    expect(m.missing).toEqual(['2026-10-23']);
    expect(missingFrom({ ...base, clubSent: false }).expected).toEqual([]);
  });
  it('a one-day session counts for the people it was sent to; one still on the way is not missing', () => {
    const m = missingFrom({ ...base, clubSent: false, dayDates: ['2026-10-21'], dayInFlight: ['2026-10-21'] });
    expect(m).toMatchObject({ expected: ['2026-10-21'], missing: [], reason: null });
  });
  it('why: disconnected is always theirs to fix; a failure only when Garmin says the link is gone', () => {
    expect(missingFrom({ ...base, garminConnected: false })).toMatchObject({ reason: 'disconnected', fixable: true });
    expect(missingFrom({ ...base, lastError: '401 Unauthorized' })).toMatchObject({ reason: 'failed', fixable: true });
    expect(missingFrom({ ...base, lastError: '429 Too Many Requests' })).toMatchObject({ reason: 'failed', fixable: false });
  });
  it('the evening text says why, in the runner\'s language', () => {
    expect(eveningCopy('he', 'disconnected').title).toBe('האימון של מחר עוד לא בשעון שלך');
    expect(eveningCopy('he', 'failed').body).toMatch(/פג/);
    expect(eveningCopy('en', 'disconnected').body).toMatch(/not connected/);
  });
});
