import { describe, expect, it } from 'vitest';
import { rsvpOpen, sessionDate } from '@/lib/attendance/rsvp-open';

describe('the RSVP comes down when the session starts (10-27)', () => {
  const at = (iso: string) => new Date(iso);
  it('open the evening before and until 05:00', () => {
    expect(rsvpOpen('2026-10-27', 5, at('2026-10-26T18:00:00Z'))).toBe(true); // Mon 21:00 IL
    expect(rsvpOpen('2026-10-27', 5, at('2026-10-27T01:30:00Z'))).toBe(true); // 04:30 IL
  });
  it('gone from 05:00, and after', () => {
    expect(rsvpOpen('2026-10-27', 5, at('2026-10-27T03:05:00Z'))).toBe(false); // 05:05 IL (winter time, UTC+2)
    expect(rsvpOpen('2026-10-27', 5, at('2026-10-28T03:00:00Z'))).toBe(false);
  });
  it('a 19:00 session stays open through the day', () => expect(rsvpOpen('2026-10-27', 19, at('2026-10-27T10:00:00Z'))).toBe(true));
  it('Tuesday of the week of 10-25', () => expect(sessionDate('2026-10-25', 2)).toBe('2026-10-27'));
});
