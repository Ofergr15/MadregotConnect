import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { isClubItem } from '@/lib/notifications/history';

/** The inbox's two tabs (Ofer, 2026-10-19): what is about you, and what happened in the club. */
describe('which tab a notification goes to', () => {
  it('puts teammates\' runs, birthdays and the club\'s photos in the club', () => {
    for (const kind of ['kudos_activity', 'quality_session', 'birthday_post', 'club_update']) expect(isClubItem({ kind })).toBe(true);
  });
  it('keeps everything about you — and anything new — in "for you"', () => {
    for (const kind of ['like', 'day_session', 'review_resolved', 'training_before', 'custom', 'post_workout_prompt', 'something_new']) expect(isClubItem({ kind })).toBe(false);
  });
  it('is a tab row on the inbox, each with its own unread count', () => {
    const page = readFileSync('src/app/(app)/dashboard/notifications/page.tsx', 'utf8');
    expect(page).toMatch(/allItems\.filter\(\(it\) => isClubItem\(it\) === \(tab === 'club'\)\)/);
    expect(page).toMatch(/const n = unreadOf\(k === 'club'\);/);
  });
});
