// ═════════════════════════════════════════════════════════════════════════════
// The Content hub, v4 (mockup ~/.cache/madregot/mockups/content-hub-v2/content-v4.html,
// Ofer 10-20): one block per kind of content, each in its own colour, and every
// published post with ITS OWN results. Nothing here mixes kinds: a survey never
// sits in the photos block, a photo never in a shared queue. Pure, so the rules
// that decide what is "waiting", what is locked and what a post's numbers are
// can be tested without a screen.
// ═════════════════════════════════════════════════════════════════════════════

export type ContentType = 'photos' | 'messages' | 'surveys' | 'cheers' | 'circle';

export interface TypeMeta {
  key: ContentType;
  label: string;
  href: string;
  /** The block's colour, its wash, and the ink on the wash. */
  color: string;
  wash: string;
  ink: string;
}

export const CONTENT_TYPES: Record<ContentType, TypeMeta> = {
  photos: { key: 'photos', label: 'תמונות', href: '/dashboard/content/photos', color: '#f2690d', wash: '#fff1e6', ink: '#a3410a' },
  messages: { key: 'messages', label: 'הודעות', href: '/dashboard/content/messages', color: '#1f6feb', wash: '#e8f0fe', ink: '#174ea6' },
  surveys: { key: 'surveys', label: 'סקרים', href: '/dashboard/content/surveys', color: '#0f9d6b', wash: '#e3f6ee', ink: '#0b6b49' },
  cheers: { key: 'cheers', label: 'ברכות', href: '/dashboard/content/cheers', color: '#e0306e', wash: '#fde8ef', ink: '#a01d4c' },
  circle: { key: 'circle', label: 'עיגול מדרגות', href: '/dashboard/content/circle', color: '#1c1c1e', wash: '#ececf0', ink: '#1c1c1e' },
};

export const TYPE_ORDER: ContentType[] = ['photos', 'messages', 'surveys', 'cheers', 'circle'];

/** A club post as `recentPublished` returns it (lib/publish/server.ts). */
export interface PublishedPost {
  id: string;
  kind: 'message' | 'cheer' | 'survey' | 'photos';
  text: string;
  at: string;
  likes: number;
  comments: number;
  /** Survey answers; null for anything else. */
  answers: number | null;
  /** Phones the post's push reached, when it was recorded; null = not known. */
  delivered: number | null;
  emoji: string;
  thumb?: string | null;
  photos?: number;
}

const POST_TYPE: Record<PublishedPost['kind'], ContentType> = { message: 'messages', cheer: 'cheers', survey: 'surveys', photos: 'photos' };
export const postType = (p: Pick<PublishedPost, 'kind'>): ContentType => POST_TYPE[p.kind];

/** One kind's posts, newest first. */
export function postsOf(posts: PublishedPost[], type: ContentType): PublishedPost[] {
  return posts.filter((p) => postType(p) === type).sort((a, b) => b.at.localeCompare(a.at));
}

/** The chips a published row carries: only the numbers this post has. */
export interface ResultChip { key: 'likes' | 'delivered' | 'answers' | 'comments' | 'photos'; text: string }
export function resultChips(p: PublishedPost, members: number): ResultChip[] {
  const out: ResultChip[] = [];
  if (p.answers != null) out.push({ key: 'answers', text: `${p.answers} ענו` });
  else out.push({ key: 'likes', text: String(p.likes) });
  if (p.delivered != null && p.delivered > 0) out.push({ key: 'delivered', text: members > 0 ? `${Math.min(p.delivered, members)}/${members}` : String(p.delivered) });
  if (p.comments > 0) out.push({ key: 'comments', text: String(p.comments) });
  if (p.photos) out.push({ key: 'photos', text: `${p.photos} תמונות` });
  return out;
}

// ── Photos: the week's folders, one list ────────────────────────────────────

export interface MadeFolder { date: string; name: string; link: string; manual: boolean; autoFeed: boolean; photos: number; inFeed: boolean; createdAt?: string | null; found?: number | null }
export interface FolderProposal {
  date: string; name: string; workout: string | null; kind: string; tags: string[];
  createsAt: string; enabled: boolean; source: 'plan' | 'race' | 'manual';
}
export type WeekFolder =
  | { state: 'opened'; date: string; folder: MadeFolder }
  | { state: 'upcoming'; date: string; proposal: FolderProposal };

/**
 * "תיקיות השבוע" (Ofer 10-20): what was already opened is shown as opened and
 * cannot be changed; what is still to open keeps its switch and its edit. From the
 * week's Sunday on, by date — opened and upcoming in one list.
 */
export function weekFolders(made: MadeFolder[], upcoming: FolderProposal[], weekStart: string): WeekFolder[] {
  const opened: WeekFolder[] = made.filter((m) => m.date >= weekStart).map((m) => ({ state: 'opened', date: m.date, folder: m }));
  const openedDays = new Set(opened.map((o) => o.date));
  const next: WeekFolder[] = upcoming.filter((u) => !openedDays.has(u.date)).map((u) => ({ state: 'upcoming', date: u.date, proposal: u }));
  return [...opened, ...next].sort((a, b) => a.date.localeCompare(b.date));
}
export const isLocked = (w: WeekFolder) => w.state === 'opened';

// ── "מחכה לך": one row per block, never shared ─────────────────────────────

export interface PhotosStatus { date: string; name: string; found: number; published: number; previews: string[] }
export interface OpenSurvey { id: string; title: string; until: string; answers: number }
export interface CheerSuggestion { athleteId: string; name: string; detail: string; line: string }

export type Waiting =
  | { type: 'photos'; title: string; sub: string; previews: string[]; action: 'publish' }
  | { type: 'surveys'; title: string; sub: string; surveyId: string; action: 'open' }
  | { type: 'cheers'; title: string; sub: string; athleteId: string; action: 'approve' };

/** Photos in the folder the club hasn't seen yet. Nothing found, or all of it out: nothing waits. */
export function photosWaiting(s: PhotosStatus | null | undefined): Waiting | null {
  if (!s) return null;
  const fresh = s.found - s.published;
  if (fresh <= 0) return null;
  return {
    type: 'photos', action: 'publish', previews: s.previews,
    title: s.published ? `${fresh} תמונות חדשות · ${s.name}` : `${s.found} תמונות · ${s.name}`,
    sub: s.published ? 'להוסיף לכרטיס בפיד' : 'מחכות לאישור',
  };
}

/** The survey that closes soonest and still has people who haven't answered. */
export function surveyWaiting(open: OpenSurvey[], members: number, today: string): Waiting | null {
  const pending = open.filter((s) => members <= 0 || s.answers < members);
  if (!pending.length) return null;
  const s = [...pending].sort((a, b) => (a.until || '9999').localeCompare(b.until || '9999'))[0];
  const missing = members > 0 ? members - s.answers : null;
  const closes = !s.until ? 'פתוח' : s.until === today ? 'נסגר היום' : s.until === nextDay(today) ? 'נסגר מחר' : `נסגר ${shortDay(s.until)}`;
  return { type: 'surveys', action: 'open', surveyId: s.id, title: s.title, sub: missing != null ? `${closes} · ${missing} עוד לא ענו` : closes };
}

/** The newest suggestion nobody has posted a cheer for yet. */
export function cheerWaiting(suggestions: CheerSuggestion[]): Waiting | null {
  const s = suggestions[0];
  if (!s) return null;
  return { type: 'cheers', action: 'approve', athleteId: s.athleteId, title: `${s.name} · ${s.detail}`, sub: suggestions.length > 1 ? `ברכה מוצעת · ועוד ${suggestions.length - 1}` : 'ברכה מוצעת' };
}

function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
}
export function shortDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(d)}.${Number(m)}`;
}

// ── One post's results ──────────────────────────────────────────────────────

export interface Member { id: string; name: string; lastSeenAt: string | null }
export interface PostResults {
  likes: number;
  likers: Array<{ id: string; name: string }>;
  comments: number;
  delivered: number | null;
  members: number;
  votes: Array<{ option: string; count: number; leading: boolean }> | null;
  answered: number | null;
  /** Members who haven't opened the app since it was posted. */
  notSeen: Array<{ id: string; name: string; lastSeenAt: string | null }>;
}

/**
 * The numbers for ONE post. "Didn't see" is the honest version of a view count the
 * app does not keep: nobody who hasn't opened the app since the post went up can
 * have seen it. (Somebody who opened it may still have scrolled past — that is
 * why the screen says "לא פתחו מאז", not "לא ראו".)
 */
export function shapePostResults(p: {
  postedAt: string;
  likerIds: string[];
  comments: number;
  delivered: number | null;
  members: Member[];
  survey?: { options: string[]; responses: number[]; voters?: number } | null;
}): PostResults {
  const byId = new Map(p.members.map((m) => [m.id, m]));
  const likers = [...new Set(p.likerIds)].map((id) => ({ id, name: byId.get(id)?.name ?? '' })).filter((l) => l.name);
  const posted = Date.parse(p.postedAt);
  const notSeen = p.members
    .filter((m) => !m.lastSeenAt || Date.parse(m.lastSeenAt) < posted)
    .sort((a, b) => (a.lastSeenAt ?? '').localeCompare(b.lastSeenAt ?? ''))
    .map((m) => ({ id: m.id, name: m.name, lastSeenAt: m.lastSeenAt }));
  let votes: PostResults['votes'] = null;
  let answered: number | null = null;
  if (p.survey) {
    const counts = p.survey.options.map((_, i) => p.survey!.responses.filter((r) => r === i).length);
    const top = Math.max(0, ...counts);
    votes = p.survey.options.map((option, i) => ({ option, count: counts[i], leading: top > 0 && counts[i] === top }));
    // People, not rows: with more than one answer a person has a row per answer (160).
    answered = p.survey.voters ?? p.survey.responses.length;
  }
  return { likes: new Set(p.likerIds).size, likers, comments: p.comments, delivered: p.delivered, members: p.members.length, votes, answered, notSeen };
}
