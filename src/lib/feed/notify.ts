import { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
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

export interface MentionNotificationInput {
  body: string;
  actorAthleteId: string;
  actorName: string;
  kind: 'post' | 'comment';
}

/**
 * The mentioned athlete ids to notify plus the shared title/body text, or
 * null when nobody's actually mentioned. Pure — separated so the text
 * construction and the mention-parsing/self-exclusion logic (already
 * covered by uniqueMentionedAthleteIds' own tests) can be tested together
 * without a live DB/push call.
 */
export function buildMentionNotification(
  input: MentionNotificationInput,
): { mentionedIds: string[]; title: string; body: string } | null {
  const { body, actorAthleteId, actorName, kind } = input;
  const mentionedIds = uniqueMentionedAthleteIds(body, actorAthleteId);
  if (mentionedIds.length === 0) return null;

  const who = actorName || 'מישהו';
  const title = `${who} תייג/ה אותך ${kind === 'comment' ? 'בתגובה' : 'בפוסט'} 🏷️`;
  const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body;

  return { mentionedIds, title, body: preview };
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
  const { feedItemId, actorAthleteId } = opts;
  const notification = buildMentionNotification(opts);
  if (!notification) return;
  const { mentionedIds, title, body: preview } = notification;

  await Promise.all(
    mentionedIds.map((athleteId) =>
      notifyAthlete({
        athleteId,
        kind: 'mention',
        actorAthleteId,
        title,
        body: preview,
        url: `/dashboard/feed?item=${feedItemId}`,
        tag: `feed-mention-${feedItemId}-${athleteId}`,
        category: 'teammates',
      }),
    ),
  );
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
