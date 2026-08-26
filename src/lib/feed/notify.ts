import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';

export interface FeedInteractionInput {
  authorAthleteId: string | null;
  actorAthleteId: string;
  actorName: string;
  kind: 'like' | 'comment';
  /** Comment text, used to preview the comment in the notification body. */
  commentBody?: string;
}

/**
 * Builds the title/body for a feed like/comment push, or null when there's
 * nothing to send (a system item with no author, or you interacting with
 * your own item). Pure — separated from notifyFeedInteraction below so the
 * actual text-construction logic (and its "skip when own item" guard) has
 * somewhere to be tested without a live DB/push call.
 */
export function buildFeedInteractionNotification(
  input: FeedInteractionInput,
): { title: string; body: string } | null {
  const { authorAthleteId, actorAthleteId, actorName, kind, commentBody } = input;
  if (!authorAthleteId || authorAthleteId === actorAthleteId) return null;

  const who = actorName || 'מישהו';
  const title = kind === 'like' ? `${who} אהב את הפוסט שלך ❤️` : `${who} הגיב לך 💬`;
  const preview = (commentBody || '').trim();
  const body =
    kind === 'like'
      ? 'היכנסו לפיד כדי לראות'
      : preview.length > 80
        ? `${preview.slice(0, 80)}…`
        : preview || 'היכנסו לפיד כדי לראות';

  return { title, body };
}

/** Best-effort push to the author of a liked or commented feed item. */
export async function notifyFeedInteraction(opts: {
  feedItemId: string;
  authorAthleteId: string | null;
  actorAthleteId: string;
  actorName: string;
  kind: 'like' | 'comment';
  /** Comment text, used to preview the comment in the notification body. */
  commentBody?: string;
}): Promise<void> {
  const { feedItemId, authorAthleteId, actorAthleteId, kind } = opts;
  const notification = buildFeedInteractionNotification(opts);
  if (!notification) return;

  await notifyAthlete({
    athleteId: authorAthleteId as string,
    kind,
    actorAthleteId,
    title: notification.title,
    body: notification.body,
    url: `/dashboard/feed?item=${feedItemId}`,
    tag: `feed-${kind}-${feedItemId}`,
    // Same "what my teammates are up to" bucket as notifyTeammatesOfActivity
    // — a like/comment is exactly this kind of low-stakes social ping, and
    // it shouldn't be forced-on when nothing else here is.
    category: 'teammates',
  });
}

export async function loadFeedItemMeta(
  feedItemId: string,
): Promise<{ authorAthleteId: string | null } | null> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('feed_items')
    .select('author_athlete_id, deleted_at')
    .eq('id', feedItemId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!data) return null;
  return { authorAthleteId: data.author_athlete_id };
}
