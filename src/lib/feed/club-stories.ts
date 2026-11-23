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
  /** Where the message's button goes ("לתמונות ›" → the session's photo folder). */
  href?: string | null;
  /** What it is, under the circle instead of "הודעה" ("📸 תמונות"). */
  label?: string | null;
}

/** The session-photos message of a day (lib/quality-session/photos-server), by its id. */
export const PHOTOS_STORY_PREFIX = 'photos-';
export const PHOTOS_STORY_LABEL = '📸 תמונות';
/** The session's photo folder in the app — the photos themselves, one tap from the circle. */
export const photosFolderHref = (folderId: string) => `/dashboard/photos?folder=${encodeURIComponent(folderId)}`;

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

/** Who posted a circle message, as members may see it (night queue #81, TOMORROW 9). */
export interface StoryAuthor { name: string; avatarUrl: string | null }

/**
 * `createdBy` is the staff email the admin route stamped. Resolved to a name + avatar ONLY for a visible
 * member: an active, approved athlete who is not a test account (migration 201). Anyone else — a pending
 * row, a removed member, a test account, an address with no athlete — gets null, and the circle shows the
 * message without a "who". The email itself never leaves the server.
 */
export async function storyAuthors(db: any, emails: Array<string | null | undefined>): Promise<Map<string, StoryAuthor>> {
  const want = [...new Set(emails.filter((e): e is string => typeof e === 'string' && e.includes('@')).map((e) => e.trim().toLowerCase()))];
  const out = new Map<string, StoryAuthor>();
  if (!want.length) return out;
  try {
    const { data, error } = await db.from('athletes').select('id, email, name, avatar_url, status, approved').in('email', want);
    if (error) return out;
    const { testAccountIds } = await import('@/lib/athletes/test-accounts');
    const tests = await testAccountIds(db);
    for (const a of (data || []) as Array<{ id: string; email: string; name: string | null; avatar_url: string | null; status: string | null; approved: boolean | null }>) {
      if (a.status !== 'active' || a.approved === false || tests.has(a.id) || !a.name) continue;
      out.set(String(a.email || '').toLowerCase(), { name: a.name, avatarUrl: a.avatar_url ?? null });
    }
  } catch { /* the circle works without authors */ }
  return out;
}
