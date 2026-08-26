export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RawItem {
  id: string; kind: string; title: string; body: string; url: string; sentAt: string; unread: boolean;
  actorName: string | null; actorAvatarUrl: string | null;
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
export const GROUP_VERB: Record<string, string> = {
  like: 'אהבו את הפוסט שלך ❤️',
  follow: 'התחילו לעקוב אחריך 👋',
};

// Merge contiguous runs (already sorted newest-first) sharing the same
// kind+url into one row — e.g. 5 separate "X liked your post" rows on the
// same feed item become one "X and 4 others liked your post". Only ever
// merges ADJACENT items, so an old like from months ago can never absorb
// into today's burst just because they target the same url.
export function aggregate(items: RawItem[]): RawItem[] {
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
      const who = cur.actorName || 'מישהו';
      result.push({
        ...cur,
        title: `${who} ו${others === 1 ? 'עוד אחד' : `${others} אחרים`} ${GROUP_VERB[cur.kind]}`,
      });
    }
    i = j;
  }
  return result;
}
