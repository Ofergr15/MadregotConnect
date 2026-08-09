import { createServerClient } from '@/lib/supabase/server';
import { sendPushToSubscriptions, subscriptionsForAthletes } from '@/lib/push';

/**
 * Push the author of a feed item when someone likes or comments on it (PRD §16
 * "תגובות ולייקים"). Reuses the existing web-push pipeline.
 *
 * Best-effort by design: a push failure must never fail the like/comment write that
 * the user is waiting on. Callers do not await the result for correctness.
 */
export async function notifyFeedInteraction(opts: {
  feedItemId: string;
  authorAthleteId: string | null;
  actorAthleteId: string;
  actorName: string;
  kind: 'like' | 'comment';
  /** Comment text, used to preview the comment in the notification body. */
  commentBody?: string;
}): Promise<void> {
  const { feedItemId, authorAthleteId, actorAthleteId, actorName, kind, commentBody } = opts;

  // No author (system item), or you interacted with your own item — nothing to send.
  if (!authorAthleteId || authorAthleteId === actorAthleteId) return;

  try {
    const subs = await subscriptionsForAthletes([authorAthleteId]);
    if (subs.length === 0) return;

    const who = actorName || 'מישהו';
    const title = kind === 'like' ? `${who} אהב את הפוסט שלך ❤️` : `${who} הגיב לך 💬`;
    const preview = (commentBody || '').trim();
    const body =
      kind === 'like'
        ? 'היכנסו לפיד כדי לראות'
        : preview.length > 80
          ? `${preview.slice(0, 80)}…`
          : preview || 'היכנסו לפיד כדי לראות';

    await sendPushToSubscriptions(subs, {
      title,
      body,
      url: `/dashboard/feed?item=${feedItemId}`,
      // Collapse a burst of likes on the same item into one notification per kind
      // instead of buzzing the phone once per liker.
      tag: `feed-${kind}-${feedItemId}`,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Look up a feed item's author and type. Used by the interaction routes to decide
 * who to notify and to reject writes against deleted items.
 */
export async function loadFeedItemMeta(
  feedItemId: string,
): Promise<{ authorAthleteId: string | null; type: string } | null> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('feed_items')
    .select('author_athlete_id, type, deleted_at')
    .eq('id', feedItemId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!data) return null;
  return { authorAthleteId: data.author_athlete_id, type: data.type };
}
