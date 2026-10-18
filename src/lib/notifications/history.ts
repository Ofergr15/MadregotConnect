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
}

/**
 * The inbox's two tabs (Ofer, 2026-10-19, mockups/morning-1019): "בשבילך" is what is
 * about this athlete — their coach, their run, their report, a like on their post;
 * "המועדון" is what happened in the club — teammates' runs (874 of the month's rows),
 * birthdays, the quality-session photos, the club updates. Everything not listed here
 * is personal, so a new kind lands where it can't be missed.
 */
const CLUB_KIND = /^(kudos_activity|quality_session|birthday|club_update|celebrat|run_together|pack_stor)/;
export function isClubItem(it: Pick<HistoryItem, 'kind'>): boolean {
  return CLUB_KIND.test(it.kind || '');
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
  | { type: 'runs'; key: string; items: HistoryItem[] };

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
