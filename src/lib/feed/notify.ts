import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { feedInteractionCopy, kudosCopy, mentionCopy } from '@/lib/notifications/copy';
import { uniqueMentionedAthleteIds } from '@/lib/feed/mentions';

export interface FeedInteractionInput {
  authorAthleteId: string | null;
  actorAthleteId: string;
  actorName: string;
  kind: 'like' | 'comment';
  /** Comment text, used to preview the comment in the notification body. */
  commentBody?: string;
}

/**
 * How a like is announced, which depends on what was liked.
 *
 * A like on a run is a kudos and has always been called one — that is the
 * wording on the push button, in the Notification Center row, and in Hebrew
 * ("כיף", not "לייק"). Now that the 👍 on a notification and the ❤️ on a feed
 * card write the same `feed_likes` row, they have to say the same thing too:
 * without this the same gesture read as "נתן/ה לך כיף על הריצה" from one entry
 * point and "אהב את הפוסט שלך" from the other, on a run, which isn't a post.
 *
 * `historyKind` is what lands in the notification history — kept as 'kudos' for
 * runs so the Notification Center keeps grouping them the way it already does.
 */
export function likeAnnouncement(itemType: string | null | undefined): {
  isKudos: boolean;
  historyKind: 'like' | 'kudos';
} {
  const isKudos = itemType === 'activity';
  return { isKudos, historyKind: isKudos ? 'kudos' : 'like' };
}

/**
 * Whether this feed interaction is worth a notification at all — false for a
 * system item with no author, or for someone interacting with their own item.
 *
 * This used to also build the title and body, but the recipient's notification
 * language isn't known until the send path resolves it, and this function is
 * called before that. So it keeps the guard (the part with a decision in it)
 * and hands the wording to feedInteractionCopy.
 */
export function shouldNotifyFeedInteraction(input: FeedInteractionInput): boolean {
  const { authorAthleteId, actorAthleteId } = input;
  return !!authorAthleteId && authorAthleteId !== actorAthleteId;
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
  /** `feed_items.type`, so a like on a run is announced as a kudos. */
  itemType?: string | null;
}): Promise<void> {
  const { feedItemId, authorAthleteId, actorAthleteId, actorName, kind, commentBody, itemType } = opts;
  if (!shouldNotifyFeedInteraction(opts)) return;

  const { isKudos, historyKind } = likeAnnouncement(itemType);
  const asKudos = kind === 'like' && isKudos;

  await notifyAthlete({
    athleteId: authorAthleteId as string,
    kind: kind === 'like' ? historyKind : kind,
    actorAthleteId,
    copy: (locale) => (asKudos
      ? kudosCopy(locale, { name: actorName })
      : feedInteractionCopy(locale, { name: actorName, kind, commentBody })),
    url: `/feed?item=${feedItemId}`,
    // Per item, not per pair. Two teammates reacting to the same run replace
    // each other's card on the lock screen rather than stacking two — which is
    // what the feed's own likes have always done, and is why the kudos path's
    // old per-pair tag isn't kept here.
    tag: `feed-${kind}-${feedItemId}`,
    // Same "what my teammates are up to" bucket as notifyTeammatesOfActivity
    // — a like/comment is exactly this kind of low-stakes social ping, and
    // it shouldn't be forced-on when nothing else here is.
    category: 'teammates',
  });
}

export interface MentionNotificationInput {
  body: string;
  actorAthleteId: string;
  actorName: string;
  kind: 'post' | 'comment';
}

/**
 * Who to notify about a mention, plus the preview of the text they were
 * mentioned in — or null when nobody's actually mentioned. The body IS the
 * mention's own text, so unlike the title there is nothing here to translate;
 * the title comes from mentionCopy on the send path, once the recipient's
 * language is known.
 */
export function buildMentionNotification(
  input: MentionNotificationInput,
): { mentionedIds: string[]; body: string } | null {
  const { body, actorAthleteId } = input;
  const mentionedIds = uniqueMentionedAthleteIds(body, actorAthleteId);
  if (mentionedIds.length === 0) return null;

  const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body;

  return { mentionedIds, body: preview };
}

/**
 * Best-effort push to every athlete @mentioned in a new post/comment body
 * (excluding a self-mention). One push per mentioned athlete — a mention is
 * a direct "someone tagged you" ping, not a group broadcast, so this always
 * runs regardless of who else got notified for the same post/comment (a
 * like/comment notifies only the author; a mention can reach anyone tagged,
 * author included if they're one of the people tagged by someone else).
 */
export async function notifyMentions(opts: {
  feedItemId: string;
  body: string;
  actorAthleteId: string;
  actorName: string;
  kind: 'post' | 'comment';
}): Promise<void> {
  const { feedItemId, actorAthleteId, actorName, kind } = opts;
  const notification = buildMentionNotification(opts);
  if (!notification) return;
  const { mentionedIds, body: preview } = notification;

  await Promise.all(
    mentionedIds.map((athleteId) =>
      notifyAthlete({
        athleteId,
        kind: 'mention',
        actorAthleteId,
        // One preview shared by everyone tagged; only the title follows each
        // recipient's own language.
        copy: (locale) => ({ ...mentionCopy(locale, { name: actorName, kind }), body: preview }),
        url: `/feed?item=${feedItemId}`,
        tag: `feed-mention-${feedItemId}-${athleteId}`,
        category: 'teammates',
      }),
    ),
  );
}

export async function loadFeedItemMeta(
  feedItemId: string,
): Promise<{ authorAthleteId: string | null; type: string | null } | null> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('feed_items')
    .select('author_athlete_id, type, deleted_at')
    .eq('id', feedItemId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!data) return null;
  return { authorAthleteId: data.author_athlete_id, type: (data.type as string) ?? null };
}
