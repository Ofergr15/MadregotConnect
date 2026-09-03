import { DEFAULT_NOTIFICATION_LOCALE, type NotificationLocale } from '@/lib/notifications/locale';
import { kudosActivityId, rsvpTarget } from '@/lib/notifications/history';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fallback for an actor whose name we couldn't load. */
const SOMEONE: Record<NotificationLocale, string> = { he: 'מישהו', en: 'Someone' };

export interface RawItem {
  id: string; kind: string; title: string; body: string; url: string; sentAt: string; unread: boolean;
  actorName: string | null; actorAvatarUrl: string | null;
  /** Prefetched row state — see applyRowActions. `undefined` = not prefetched. */
  kudosGiven?: boolean;
  rsvpAttending?: boolean | null;
}

interface InboxRow {
  id: string;
  kind: string;
  title_he: string;
  body_he: string;
  url: string | null;
  last_sent_at: string | null;
  actor?: { name?: string | null; avatar_url?: string | null } | null;
}

// Shapes one raw DB row into the inbox's item shape: drops the `#`-prefixed
// internal urls (ledger sentinels, already excluded at the query level, but a
// defense-in-depth filter belongs here too) back to a safe '/dashboard'
// fallback, and derives `unread` from the single last_seen_at cutoff.
export function shapeInboxItem(row: InboxRow, sinceIso: string): RawItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title_he,
    body: row.body_he,
    url: row.url && !row.url.startsWith('#') ? row.url : '/dashboard',
    sentAt: row.last_sent_at || '',
    unread: !!row.last_sent_at && row.last_sent_at > sinceIso,
    actorName: row.actor?.name || null,
    actorAvatarUrl: row.actor?.avatar_url || null,
  };
}

// Kinds worth collapsing into "X and N others…" when they burst — low-content
// social pings where only the count matters. Deliberately excludes kinds
// whose body carries unique information a merge would destroy (a comment's
// actual text, a badge's name, a coach's actual reply, a teammate's specific
// run stats) — matching how Strava/Instagram themselves only ever collapse
// likes/follows, never comments or achievements.
export const GROUPABLE_KINDS = new Set(['like', 'follow']);
// Plural forms — the singular case never reaches here (a run of one isn't
// merged), so unlike feedInteractionCopy/followCopy these are only ever the
// "several people did this" wording.
export const GROUP_VERB: Record<NotificationLocale, Record<string, string>> = {
  he: {
    like: 'אהבו את הפוסט שלך ❤️',
    follow: 'התחילו לעקוב אחריך 👋',
  },
  en: {
    like: 'liked your post ❤️',
    follow: 'started following you 👋',
  },
};

// "X and 4 others" / "X ועוד 4 אחרים" — the only string the inbox composes at
// read time. Every other row was already written in the recipient's language
// when it was persisted, so this one has to follow suit or a merged burst would
// be the single Hebrew row in an English inbox.
function othersPhrase(locale: NotificationLocale, who: string, others: number): string {
  if (locale === 'he') {
    return `${who} ו${others === 1 ? 'עוד אחד' : `${others} אחרים`}`;
  }
  return `${who} and ${others === 1 ? '1 other' : `${others} others`}`;
}

// Merge contiguous runs (already sorted newest-first) sharing the same
// kind+url into one row — e.g. 5 separate "X liked your post" rows on the
// same feed item become one "X and 4 others liked your post". Only ever
// merges ADJACENT items, so an old like from months ago can never absorb
// into today's burst just because they target the same url.
export function aggregate(
  items: RawItem[],
  locale: NotificationLocale = DEFAULT_NOTIFICATION_LOCALE,
): RawItem[] {
  const result: RawItem[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (!GROUPABLE_KINDS.has(cur.kind)) { result.push(cur); i++; continue; }
    let j = i + 1;
    while (j < items.length && items[j].kind === cur.kind && items[j].url === cur.url) j++;
    const run = items.slice(i, j);
    if (run.length === 1) {
      result.push(cur);
    } else {
      const others = run.length - 1;
      const who = cur.actorName || SOMEONE[locale];
      result.push({
        ...cur,
        title: `${othersPhrase(locale, who, others)} ${GROUP_VERB[locale][cur.kind]}`,
      });
    }
    i = j;
  }
  return result;
}

// ─── Row actions, resolved in bulk ──────────────────────────────────────────
// Two of the inbox's row types are interactive, and each used to load its own
// state on mount: every `kudos_activity` row fetched /api/activities/{id}/kudos
// and every `training_before` row fetched /api/attendance. Nothing merges them
// (aggregate() only collapses adjacent like/follow runs), so a normal 50-row
// window meant ~45 extra round trips on top of this response — each a separate
// serverless invocation, and each attendance one paying a session verification.
// The page now gets all of it from the single request it was already waiting on.

/** Composite key for one RSVP-able practice: a week plus a day within it. */
export function rsvpKey(weekStart: string, day: number): string {
  return `${weekStart}:${day}`;
}

/**
 * What the interactive rows in this window need looked up: activity ids for
 * kudos, and the week_start_dates covering the RSVP rows. Deduped, since a
 * burst of reminders about the same week is one query either way.
 *
 * Weeks rather than exact week+day pairs because PostgREST has no tuple `IN`:
 * fetching the whole week (at most 7 rows per week) and matching the day in JS
 * beats one query per row.
 */
export function rowActionTargets(items: RawItem[]): { activityIds: string[]; weekStarts: string[] } {
  const activityIds = new Set<string>();
  const weekStarts = new Set<string>();
  for (const it of items) {
    const activityId = kudosActivityId(it);
    if (activityId) activityIds.add(activityId);
    const rsvp = rsvpTarget(it);
    if (rsvp) weekStarts.add(rsvp.weekStart);
  }
  return { activityIds: [...activityIds], weekStarts: [...weekStarts] };
}

/**
 * Attach each interactive row's own state to it.
 *
 * A null/omitted lookup means "that query didn't happen or failed" and leaves
 * the field `undefined` rather than guessing — the row then falls back to
 * fetching for itself, which matters for kudos: a button that wrongly starts
 * un-given turns a second tap into a DELETE of a real prior reaction.
 *
 * A missing entry in a lookup that DID happen is a genuine answer: no kudos
 * given (false), or no RSVP yet (null).
 */
export function applyRowActions(
  items: RawItem[],
  lookups: { kudosGiven?: Set<string> | null; rsvpByKey?: Map<string, boolean> | null },
): RawItem[] {
  const { kudosGiven, rsvpByKey } = lookups;
  return items.map((it) => {
    if (kudosGiven) {
      const activityId = kudosActivityId(it);
      if (activityId) return { ...it, kudosGiven: kudosGiven.has(activityId) };
    }
    if (rsvpByKey) {
      const rsvp = rsvpTarget(it);
      if (rsvp) {
        const answer = rsvpByKey.get(rsvpKey(rsvp.weekStart, rsvp.day));
        return { ...it, rsvpAttending: answer === undefined ? null : answer };
      }
    }
    return it;
  });
}
