export interface HistoryItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  sentAt: string;
  unread: boolean;
  actorName?: string | null;
  actorAvatarUrl?: string | null;
  /** This athlete's own state on an interactive row, resolved server-side in
   *  bulk (see applyRowActions) so the row needs no request of its own.
   *  `undefined` = not prefetched, and the row loads it itself. */
  kudosGiven?: boolean;
  rsvpAttending?: boolean | null;
  /** Sent to the whole club — a broadcast belongs on the club tab. */
  toAll?: boolean;
}

/**
 * The inbox's two tabs (Ofer, 2026-10-19, mockups/morning-1019): "בשבילך" is what is
 * about this athlete — their coach, their run, their report, a like on their post;
 * "המועדון" is what happened in the club — teammates' runs (874 of the month's rows),
 * birthdays, the quality-session photos, the club updates. Everything not listed here
 * is personal, so a new kind lands where it can't be missed.
 */
const CLUB_KIND = /^(kudos_activity|quality_session|birthday|club_update|celebrat|run_together|pack_stor)/;
export function isClubItem(it: Pick<HistoryItem, 'kind'> & { toAll?: boolean }): boolean {
  // The club's own posts, and a message the club sent to everyone (the release note),
  // are the club speaking — not something about this athlete (2026-10-19).
  return CLUB_KIND.test(it.kind || '') || it.kind === 'club_post' || (it.kind === 'custom' && !!it.toAll);
}

// Real native notification-history UIs are a static chronological list —
// you can't collapse "Today". Date bucket is the section; category (via
// styleFor below) is now only a per-row icon/color, not a grouping axis.
export type DateBucket = 'today' | 'yesterday' | 'thisWeek' | 'older';
export const DATE_BUCKETS: DateBucket[] = ['today', 'yesterday', 'thisWeek', 'older'];

export function dateBucketFor(iso: string): DateBucket {
  const then = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  if (then >= startOfToday) return 'today';
  if (then >= startOfYesterday) return 'yesterday';
  if (then >= startOfWeek) return 'thisWeek';
  return 'older';
}

// localStorage key for this athlete's locally-dismissed (group "X") notification
// ids. There's no per-notification read column in the DB — the server's `unread`
// flag is derived from a single athletes.last_seen_at cutoff (see inbox route),
// so per-group "mark read" has nothing server-side to toggle. Persisting the
// dismissed ids client-side (same pattern as the app's other *_dismissed flags,
// e.g. pwa_install_dismissed) lets the group X clear the highlight without
// deleting history, and without a new DB table just for this.
export function readStoreKey(athleteId: string): string {
  return `notif_read_ids_${athleteId}`;
}

// Icon/color "kind" by notification content — a light heuristic on the title
// so custom coach messages still get a sensible glyph. Returned as a string
// key rather than a component reference so this stays a pure, UI-free
// function; the page maps the key to an actual icon + Tailwind class.
// Colors mirror the design deck: coach=blue, race=gold, achievement=green,
// workout=indigo.
// Each pattern carries the English words matching its Hebrew ones, because
// notification rows are now persisted in the recipient's own language (see
// lib/notifications/copy.ts) — a Hebrew-only heuristic would drop every row in
// an English athlete's history to the generic icon. The English side is kept
// deliberately narrow, so both languages bucket the same notification the same
// way (e.g. a kudos push is 'default' in both, not 'workout' in one).
export type StyleKind = 'coach' | 'race' | 'achievement' | 'workout' | 'default';
export function styleKindFor(it: Pick<HistoryItem, 'title' | 'body'>): StyleKind {
  const s = it.title + ' ' + it.body;
  if (/מאמן|תשובה|💬|coach|reply/i.test(s)) return 'coach';
  if (/מרוץ|מרתון|הרשמה|🏆|race|marathon|registration/i.test(s)) return 'race';
  if (/שיא|רצף|הישג|🎉|🔥|🎖|record|streak|achievement/i.test(s)) return 'achievement';
  if (/אימון|נוכחות|מגיעים|session|training|attendance/i.test(s)) return 'workout';
  return 'default';
}

// "kudos_activity" rows carry the real activity id as a query param (see
// notifyTeammatesOfActivity in src/lib/push.ts) so kudos can be given straight
// from the inbox row, with no navigation.
//
// Both spellings are accepted on purpose. Current rows use ?activity=, which
// /feed reads to pull that run's card up; rows written before that
// link existed use ?kudos= and point at /dashboard/activities. Those older rows
// are already in every athlete's history, and their kudos button is worth
// keeping alive even though their link goes somewhere useless.
export function kudosActivityId(it: Pick<HistoryItem, 'kind' | 'url'>): string | null {
  if (it.kind !== 'kudos_activity') return null;
  const m = it.url.match(/[?&](?:activity|kudos)=([^&]+)/);
  return m ? m[1] : null;
}

// "training_before" rows (day-before / evening-before RSVP reminders) carry
// the target week+day as a ?rsvp=weekStart:day query param (see cron/tick)
// so the reminder can be answered right from the inbox row, no navigation.
export function rsvpTarget(it: Pick<HistoryItem, 'kind' | 'url'>): { weekStart: string; day: number } | null {
  if (it.kind !== 'training_before') return null;
  const m = it.url.match(/[?&]rsvp=([^&:]+):(\d)/);
  return m ? { weekStart: m[1], day: Number(m[2]) } : null;
}

// ─── Folding "X finished a run" ────────────────────────────────────────────
// Eyal, 2026-10-11: 296 `kudos_activity` rows since 10-01, about 30 a day, in a
// 50-row inbox — so a coach reply, a "sent to Garmin", a reminder or a survey was
// gone within two days. A day with FOLD_MIN or more of them becomes one row,
// placed where the newest of them was, that opens in place to the runs (each
// keeping its kudos button). Fewer than that stay as they are.

export const FOLD_MIN = 3;

export type InboxEntry =
  | { type: 'item'; item: HistoryItem }
  | { type: 'runs'; key: string; items: HistoryItem[] }
  /** Likes on my posts and runs, or my reports that were handled — one row each (foldInbox). */
  | { type: 'group'; key: string; kind: 'likes' | 'reports'; items: HistoryItem[] }
  /** The same notice sent again within a short while — shown once, with how many times. */
  | { type: 'repeat'; key: string; item: HistoryItem; count: number };

/** The calendar day in Israel, which is the day the club lives in. */
function israelDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(iso));
}

/** `items` newest-first, as the inbox returns them. */
export function foldRuns(items: HistoryItem[]): InboxEntry[] {
  const perDay = new Map<string, HistoryItem[]>();
  for (const it of items) {
    if (it.kind !== 'kudos_activity') continue;
    const d = israelDay(it.sentAt);
    perDay.set(d, [...(perDay.get(d) ?? []), it]);
  }
  const out: InboxEntry[] = [];
  const placed = new Set<string>();
  for (const it of items) {
    if (it.kind === 'kudos_activity') {
      const d = israelDay(it.sentAt);
      const day = perDay.get(d)!;
      if (day.length >= FOLD_MIN) {
        if (!placed.has(d)) { placed.add(d); out.push({ type: 'runs', key: `runs:${d}`, items: day }); }
        continue;
      }
    }
    out.push({ type: 'item', item: it });
  }
  return out;
}

/** Distinct first names of the runners in a fold, newest first. */
export function foldNames(items: HistoryItem[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const it of items) {
    const n = (it.actorName || '').trim().split(/\s+/)[0];
    if (n && !seen.has(n)) { seen.add(n); names.push(n); }
  }
  return names;
}

// ─── The inbox as one person reads it (Ofer 2026-10-19, notifications mockup) ──────────
// His real week: "מחר אימון קבוצתי" twice in the same minute, "נשלח לשעון" five times in
// 45 minutes while the coach edited, "תזכורת" three times at 05:00, the same 05:00 poll
// fifteen times since 24.8 (none of them ever closes), four "נתנו לך כיף" and four
// "דיווח טופל". What is asked of the athlete goes on top; repeats fold; old polls close.

/** A poll is answerable for this long after it was sent: its question is about tomorrow. */
export const SURVEY_OPEN_HOURS = 36;
/** The same kind and title again within this window is the same notice. */
export const REPEAT_WINDOW_MIN = 120;
/** "איך היה?" stays a question this long after the run. */
export const PROMPT_OPEN_HOURS = 48;

const hoursSince = (iso: string, now: number) => (now - new Date(iso).getTime()) / 3_600_000;

/** The polls that are past answering: every one but the newest of a question, and that one after SURVEY_OPEN_HOURS. */
export function closedSurveyIds(items: HistoryItem[], now: number = Date.now()): Set<string> {
  const closed = new Set<string>();
  const newest = new Map<string, HistoryItem>();
  for (const it of items) {
    if (it.kind !== 'survey') continue;
    const k = it.title.trim();
    const n = newest.get(k);
    if (!n || it.sentAt > n.sentAt) { if (n) closed.add(n.id); newest.set(k, it); } else closed.add(it.id);
  }
  for (const it of newest.values()) if (hoursSince(it.sentAt, now) > SURVEY_OPEN_HOURS) closed.add(it.id);
  return closed;
}

export interface Waiting {
  /** Tomorrow's team session to answer for (the newest day-before reminder still ahead). */
  rsvp: { weekStart: string; day: number } | null;
  /** The newest "how was it" prompt still open. */
  prompt: HistoryItem | null;
  /** Rows the "waiting" cards stand in for, left out of the list below. */
  hidden: Set<string>;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};

export function waitingFor(items: HistoryItem[], now: number = Date.now()): Waiting {
  const today = israelDay(new Date(now).toISOString());
  const hidden = new Set<string>();
  let rsvp: Waiting['rsvp'] = null;
  for (const it of items) {
    const t = rsvpTarget(it);
    if (!t || addDays(t.weekStart, t.day) < today || hoursSince(it.sentAt, now) > SURVEY_OPEN_HOURS) continue;
    rsvp ??= t;
    // Every reminder about the same session is the one question on top.
    if (t.weekStart === rsvp.weekStart && t.day === rsvp.day) hidden.add(it.id);
  }
  const prompt = items.find((it) => it.kind === 'post_workout_prompt' && /[?&]activity=/.test(it.url)
    && hoursSince(it.sentAt, now) <= PROMPT_OPEN_HOURS) ?? null;
  if (prompt) hidden.add(prompt.id);
  return { rsvp, prompt, hidden };
}

/**
 * A message the club sent to everyone AND to this athlete (the 18.10 release note went
 * out both ways) — the personal copy, so it shows once, on the club tab.
 */
export function broadcastCopyIds(items: HistoryItem[]): Set<string> {
  const broadcast = new Set(items.filter((it) => it.toAll).map((it) => it.title.trim()));
  return new Set(items.filter((it) => !it.toAll && it.kind === 'custom' && broadcast.has(it.title.trim())).map((it) => it.id));
}

const LIKE_KINDS = new Set(['like', 'kudos']);

/**
 * foldRuns, and then: likes on my posts and runs become one row, my handled reports one
 * row, and the same notice repeated within REPEAT_WINDOW_MIN shows once with its count.
 * `items` newest-first; each folded row sits where its newest member was.
 */
export function foldInbox(items: HistoryItem[]): InboxEntry[] {
  const likes = items.filter((it) => LIKE_KINDS.has(it.kind));
  const reports = items.filter((it) => it.kind === 'review_resolved');
  const out: InboxEntry[] = [];
  let placedLikes = false; let placedReports = false;
  const lastOf = new Map<string, { entry: Extract<InboxEntry, { type: 'repeat' }>; at: number }>();
  for (const entry of foldRuns(items)) {
    if (entry.type !== 'item') { out.push(entry); continue; }
    const it = entry.item;
    if (LIKE_KINDS.has(it.kind) && likes.length >= 2) {
      if (!placedLikes) { placedLikes = true; out.push({ type: 'group', key: `likes:${it.id}`, kind: 'likes', items: likes }); }
      continue;
    }
    if (it.kind === 'review_resolved' && reports.length >= 2) {
      if (!placedReports) { placedReports = true; out.push({ type: 'group', key: `reports:${it.id}`, kind: 'reports', items: reports }); }
      continue;
    }
    const k = `${it.kind}|${it.title.trim()}`;
    const at = new Date(it.sentAt).getTime();
    const prev = lastOf.get(k);
    if (prev && prev.at - at <= REPEAT_WINDOW_MIN * 60_000) { prev.entry.count++; prev.at = at; continue; }
    const rep = { type: 'repeat' as const, key: `rep:${it.id}`, item: it, count: 1 };
    lastOf.set(k, { entry: rep, at });
    out.push(rep);
  }
  // A notice sent once is a plain row.
  return out.map((e) => (e.type === 'repeat' && e.count === 1 ? { type: 'item', item: e.item } : e));
}

