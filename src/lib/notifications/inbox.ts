import { upgradeLegacyAcademyUrl } from '@/lib/academy/deep-links';
import { DEFAULT_NOTIFICATION_LOCALE, type NotificationLocale } from '@/lib/notifications/locale';
import { kudosActivityId, rsvpTarget } from '@/lib/notifications/history';
import { isKindMuted } from '@/lib/notifications/prefs';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fallback for an actor whose name we couldn't load. */
const SOMEONE: Record<NotificationLocale, string> = { he: 'מישהו', en: 'Someone' };

export interface RawItem {
  id: string; kind: string; title: string; body: string; url: string; sentAt: string; unread: boolean;
  actorName: string | null; actorAvatarUrl: string | null;
  /** Prefetched row state — see applyRowActions. `undefined` = not prefetched. */
  kudosGiven?: boolean;
  rsvpAttending?: boolean | null;
  /** Sent to the whole club (audience "all") — a broadcast belongs on the club tab. */
  toAll?: boolean;
}

interface InboxRow {
  id: string;
  kind: string;
  title_he: string;
  body_he: string;
  url: string | null;
  last_sent_at: string | null;
  actor_athlete_id?: string | null;
  actor?: { name?: string | null; avatar_url?: string | null } | null;
  audience_type?: string | null;
}

// Shapes one raw DB row into the inbox's item shape: drops the `#`-prefixed
// internal urls (ledger sentinels, already excluded at the query level, but a
// defense-in-depth filter belongs here too) back to a safe '/dashboard'
// fallback, and derives `unread` from the single last_seen_at cutoff.
//
// `viewer` upgrades the academy rows sent before their deep links existed: a
// thread or review notification stored as the bare `/dashboard/academy` opens the
// conversation instead (see lib/academy/deep-links.ts). Optional, so a caller that
// doesn't know the viewer's staffness gets the stored url unchanged.
export function shapeInboxItem(
  row: InboxRow,
  sinceIso: string,
  viewer?: { isStaff: boolean },
): RawItem {
  const stored = row.url && !row.url.startsWith('#') ? row.url : '/dashboard';
  return {
    id: row.id,
    kind: row.kind,
    title: row.title_he,
    body: row.body_he,
    url: viewer
      ? upgradeLegacyAcademyUrl(row.kind, stored, { viewerIsStaff: viewer.isStaff, actorAthleteId: row.actor_athlete_id ?? null })
      : stored,
    sentAt: row.last_sent_at || '',
    unread: !!row.last_sent_at && row.last_sent_at > sinceIso,
    actorName: row.actor?.name || null,
    actorAvatarUrl: row.actor?.avatar_url || null,
    toAll: row.audience_type === 'all',
  };
}

/**
 * Rows that are bookkeeping, not messages: each "דיווח טופל" push wrote a twin row
 * titled "review resolved" with the review's key as its body (Ofer's inbox, 2026-10-16:
 * four of each). Dropped like the ledger rows.
 */
export function isPlaceholderRow(row: { title_he?: string | null; body_he?: string | null }): boolean {
  return (row.title_he || '').trim() === 'review resolved' || /^review-resolved-/.test(row.body_he || '');
}

/** "@[Shay Noam](uuid)" → "Shay Noam": a feed mention, as plain text for a notification row. */
export function plainMentions(text: string): string {
  return text.replace(/@\[([^\]]+)\]\([^)]*\)/g, '$1');
}

/**
 * The club's own posts on the feed (announcements — a release, a congratulation, a
 * birthday) as rows of the inbox's club tab (Ofer 2026-10-19, notifications mockup):
 * "what happened in the club" was empty while the club was saying things. A post the
 * club ALSO pushed (same first line as a broadcast row) is left out — one thing, once.
 */
export function clubPostItems(
  posts: Array<{ id: string; body: string | null; occurred_at: string }>,
  sinceIso: string,
  pushedTitles: Set<string>,
): RawItem[] {
  const out: RawItem[] = [];
  for (const p of posts) {
    const text = plainMentions((p.body || '').trim());
    if (!text) continue;
    const [first, ...rest] = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (pushedTitles.has(first)) continue;
    out.push({
      id: `post:${p.id}`, kind: 'club_post', title: first, body: rest.join(' '), url: `/feed?item=${p.id}`,
      sentAt: p.occurred_at, unread: p.occurred_at > sinceIso, actorName: null, actorAvatarUrl: null, toAll: true,
    });
  }
  return out;
}

/**
 * A muted category is not unread.
 *
 * The app-icon badge has applied this rule since `countsTowardBadge` (push.ts);
 * the history did not, so the two numbers on screen disagreed — turning a channel
 * off in Settings stopped the push and left the blue dots behind, on rows that
 * were deliberately never delivered. An athlete who muted teammates saw a bell
 * reading 0 above a page with six unread dots.
 *
 * The row STAYS in the list. Muting a channel means "don't ping me", not "hide
 * the history"; it just stops claiming to be new.
 *
 * Same inputs as the badge — this athlete's saved prefs plus their staffness, for
 * the staff defaults in `defaultsFor` — so the two agree even for someone who has
 * never saved a preference, and it fails open the same way: unreadable prefs mute
 * nothing.
 */
export function clearMutedUnread(
  items: RawItem[],
  prefs: Record<string, boolean> | null | undefined,
  isStaff: boolean,
  // The role too, as the badge passes it: the club account (CLUB_ACCOUNT_ROLE) has
  // everything but management muted. Without it the bell said 0 while the inbox
  // showed unread dots on every club-wide broadcast.
  role?: string | null,
): RawItem[] {
  return items.map((it) =>
    it.unread && isKindMuted(it.kind, prefs, isStaff, role) ? { ...it, unread: false } : it,
  );
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
