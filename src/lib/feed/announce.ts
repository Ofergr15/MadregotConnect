/**
 * The producer for `feed_items.type = 'announcement'`.
 *
 * The card, the filter chip and the Profile screen's עידכונים deck were all built
 * for this type and nothing ever wrote a row — so `GET /api/feed?types=announcement`
 * has always come back empty and the deck simply never rendered. Meanwhile the club
 * *does* broadcast: an admin composes a message in the notification centre and it
 * goes out as a push, seen once and then gone.
 *
 * This makes the broadcast leave a trace. The same message an admin already sends
 * now also lands in the feed, where a member who had their phone face-down can still
 * find it, and where the deck has something to show.
 *
 * ── What is deliberately NOT produced ────────────────────────────────────────────
 *  - **Recurring notifications.** "אימון קבוצתי מחר ב-18:00" every Monday is a
 *    reminder, not news; posting it weekly would turn the feed into a nag and train
 *    people to scroll past the one announcement that mattered.
 *  - **Non-`custom` kinds.** The other rows in `scheduled_notifications` are system
 *    reminders the app generates about you, not messages from the staff.
 *
 * ── Language ────────────────────────────────────────────────────────────────────
 * `feed_items.body` is one string and the projection ships it as-is, so a bilingual
 * card would need a payload contract and a render change on both consumers. The
 * Hebrew copy is stored, which is the club's default locale and the only field the
 * compose form requires. The English text the admin may have filled in still lives on
 * the `scheduled_notifications` row, and `payload.notificationId` below is the join
 * back to it — so making the card bilingual later needs no migration and loses
 * nothing in the meantime.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** The subset of a `scheduled_notifications` row this needs. */
export interface AnnouncementSource {
  id: string;
  kind?: string | null;
  schedule_type?: string | null;
  title_he?: string | null;
  body_he?: string | null;
}

/** Whether a broadcast is the kind of thing that belongs in the feed at all. */
export function isFeedWorthyAnnouncement(n: AnnouncementSource): boolean {
  return (n.kind ?? 'custom') === 'custom' && n.schedule_type !== 'recurring';
}

/**
 * Publishes one broadcast to the feed. Never throws — a feed row is a nice-to-have
 * next to actually delivering the push, and must not fail the send that produced it.
 *
 * Authored by nobody: `author_athlete_id` stays null, which the projection renders
 * as "Madregot". An announcement is from the club, not from whichever admin happened
 * to be holding the phone.
 */
export async function publishAnnouncement(
  supabase: SupabaseClient,
  n: AnnouncementSource,
  occurredAt: string = new Date().toISOString(),
): Promise<void> {
  if (!isFeedWorthyAnnouncement(n)) return;

  const title = n.title_he?.trim() || '';
  const body = n.body_he?.trim() || '';
  // The push shows title and body as two lines; the card has one text block, so
  // they are joined the same way they read on the lock screen.
  const text = [title, body].filter(Boolean).join('\n');
  if (!text) return;

  try {
    // A cron tick that died after sending but before marking the row `sent` would
    // otherwise post the same announcement twice.
    const { data: existing } = await supabase
      .from('feed_items')
      .select('id')
      .eq('type', 'announcement')
      .eq('payload->>notificationId', n.id)
      .maybeSingle();
    if (existing) return;

    const { error } = await supabase.from('feed_items').insert({
      type: 'announcement',
      author_athlete_id: null,
      body: text,
      payload: { notificationId: n.id },
      occurred_at: occurredAt,
    });
    if (error) console.warn(`publishAnnouncement ${n.id} failed:`, error.message);
  } catch (err) {
    console.warn(`publishAnnouncement ${n.id} failed:`, err);
  }
}
