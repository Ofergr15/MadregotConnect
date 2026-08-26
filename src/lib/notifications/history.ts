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
export type StyleKind = 'coach' | 'race' | 'achievement' | 'workout' | 'default';
export function styleKindFor(it: Pick<HistoryItem, 'title' | 'body'>): StyleKind {
  const s = it.title + ' ' + it.body;
  if (/מאמן|תשובה|💬/.test(s)) return 'coach';
  if (/מרוץ|מרתון|הרשמה|🏆/.test(s)) return 'race';
  if (/שיא|רצף|הישג|🎉|🔥|🎖/.test(s)) return 'achievement';
  if (/אימון|נוכחות|מגיעים/.test(s)) return 'workout';
  return 'default';
}

// "kudos_activity" rows carry the real activity id as a ?kudos= query param
// (see notifyTeammatesOfActivity in src/lib/push.ts) so kudos can be given
// directly from the notification, with no teammate-visible activity-detail
// page needed at all.
export function kudosActivityId(it: Pick<HistoryItem, 'kind' | 'url'>): string | null {
  if (it.kind !== 'kudos_activity') return null;
  const m = it.url.match(/[?&]kudos=([^&]+)/);
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
