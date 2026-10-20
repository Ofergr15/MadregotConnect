import { addDaysToDateStr } from '@/lib/utils';

// ═════════════════════════════════════════════════════════════════════════════
// THE MADREGOT CIRCLE (Ofer, 2026-10-18; mockup celebrations-control, 1-2 and 6)
//
// A message from the club drawn as the FIRST circle of "חוגגים השבוע": the logo in a
// blue ring, a red dot until it is opened, and a tap pops the message up. Not a feed
// post (a circle-only message is kept out of feed_items altogether, so it can never
// show up as one) and quiet by default: the circle is the gentle channel, the push
// stays for the big things. Kept in app_settings as one short list, newest first.
// ═════════════════════════════════════════════════════════════════════════════

export const CLUB_STORIES_KEY = 'club-stories';

export interface ClubStory {
  id: string;
  title: string;
  text: string;
  /** First and last Israel day it is on the row, YYYY-MM-DD, inclusive. */
  from: string;
  until: string;
  createdAt: string;
  createdBy?: string | null;
}

/** How long it stays: today only, or N days counting today. */
export const STORY_DAYS = [1, 2, 7] as const;

export function untilFor(from: string, days: number): string {
  return addDaysToDateStr(from, Math.max(1, Math.round(days)) - 1);
}

export function readClubStories(raw: string | null | undefined): ClubStory[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((s): s is ClubStory => !!s && typeof s.id === 'string' && typeof s.text === 'string') : [];
  } catch {
    return [];
  }
}

/** On the row today, newest first. */
export function activeClubStories(list: ClubStory[], today: string): ClubStory[] {
  return list.filter((s) => s.from <= today && today <= s.until).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** What is kept when one is added: nothing that ended more than two weeks ago. */
export function pruneClubStories(list: ClubStory[], today: string): ClubStory[] {
  const cutoff = addDaysToDateStr(today, -14);
  return list.filter((s) => s.until >= cutoff).slice(0, 50);
}
