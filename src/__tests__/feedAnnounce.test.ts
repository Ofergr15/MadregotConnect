import { describe, expect, it } from 'vitest';
import { isFeedWorthyAnnouncement } from '@/lib/feed/announce';

describe('isFeedWorthyAnnouncement', () => {
  it('takes a one-off staff broadcast', () => {
    expect(isFeedWorthyAnnouncement({ id: 'n1', kind: 'custom', schedule_type: 'now' })).toBe(true);
    expect(isFeedWorthyAnnouncement({ id: 'n1', kind: 'custom', schedule_type: 'once_at' })).toBe(true);
  });

  it('leaves recurring reminders out of the feed', () => {
    // "אימון קבוצתי מחר" every Monday is a nag, not news.
    expect(isFeedWorthyAnnouncement({ id: 'n1', kind: 'custom', schedule_type: 'recurring' })).toBe(false);
  });

  it('leaves the app-generated kinds out — an announcement is from the staff', () => {
    expect(isFeedWorthyAnnouncement({ id: 'n1', kind: 'reminder', schedule_type: 'now' })).toBe(false);
  });

  it('treats a missing kind as custom, which is what the compose form sends', () => {
    expect(isFeedWorthyAnnouncement({ id: 'n1', schedule_type: 'now' })).toBe(true);
  });
});
