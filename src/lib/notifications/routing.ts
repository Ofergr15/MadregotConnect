import { createServerClient } from '@/lib/supabase/server';

// ═════════════════════════════════════════════════════════════════════════════
// WHO RECEIVES EACH MANAGEMENT ALERT — as data, not as code.
//
// The club's staff alerts (a bug report, a pain flag, a store order, a stalled
// sync) used to have their recipient list compiled in: `staffRecipientIds()`.
// That list has now been narrowed twice in two days, each time by editing and
// deploying a function, and each time the club owner only found out it was wrong
// by counting pushes on his own phones. Two things were missing and neither is a
// code problem:
//
//   1. Nothing in the app said who an alert goes to. It was invisible.
//   2. Changing it needed a deploy, so "should the coach hear about pain?" was a
//      question nobody could answer by trying it.
//
// So the rule lives in `notification_routing` (migration 099): one row per
// (kind, role), edited from the Control Room → התראות screen. `recipientsForKind`
// is the single read, and every management sender goes through it.
//
// ── THREE PROPERTIES THAT ARE LOAD-BEARING ──────────────────────────────────
//
// • `null` and `[]` are different answers. `null` = "this kind has no routing
//   rows" (the migration isn't applied yet, or the table can't be read), and the
//   caller must fall back to its own hardcoded list — an unapplied migration must
//   never silence a bug report. `[]` = "configured, and configured to nobody",
//   which is a choice the screen let somebody make and must be honoured.
//
// • ROLES ONLY, and only staff-ish ones. A management alert names a person ("Dana
//   reported pain") and links into admin screens; routing one to `runner` would
//   fan a private report out to 23 people, which is one mis-tap away if the
//   screen offers the row at all. The screen doesn't offer it and this module
//   won't resolve it.
//
// • A recipient still has to WANT it. Routing decides who is on the list;
//   `notification_prefs` (the `management` category) still lets each of them turn
//   it off for themselves, exactly as before — filterByCategory on the send path
//   is unchanged. Routing is the club's decision, prefs are the person's.
// ═════════════════════════════════════════════════════════════════════════════

/** Postgres: relation does not exist — migration 099 not pasted in yet. */
const UNDEFINED_TABLE = '42P01';
/** Postgres: column does not exist — a partially applied 099. */
const UNDEFINED_COLUMN = '42703';

export const ROUTABLE_ROLES = ['admin', 'coach', 'academy_coach'] as const;
export type RoutableRole = (typeof ROUTABLE_ROLES)[number];

export interface RoutedKind {
  /** `scheduled_notifications.kind`, and the routing table's key. */
  kind: string;
  /** Hebrew label for the admin screen. */
  label: string;
  /** What actually triggers it — the screen shows this, because "sync_stalled" alone doesn't say when. */
  hint: string;
  /** Where it is sent from, so a reader can find the caller. */
  source: string;
}

/**
 * Every alert whose recipients are configurable, in the order the screen shows
 * them: the ones a human must act on first, the automatic health checks last.
 *
 * `program_week_missing` is the odd one out — it is not a
 * `scheduled_notifications.kind` (it's push-only, tagged `rollover:<week>`), so
 * here it is purely a routing key. It's on the list because it was the LAST
 * recipient rule still resolved by email address (`APPROVER_EMAILS`), which mails
 * every account a person holds rather than the one they run the club from.
 */
export const ROUTED_KINDS: RoutedKind[] = [
  {
    kind: 'problem_report',
    label: 'דיווח על באג',
    hint: 'אתלט שלח דיווח מתוך האפליקציה',
    source: 'api/feedback',
  },
  {
    kind: 'feedback_alert',
    label: 'דיווח על כאב',
    hint: 'אתלט סימן כאב או פציעה במשוב על אימון',
    source: 'api/workout-feedback',
  },
  {
    kind: 'signup_request',
    label: 'בקשת הרשמה',
    hint: 'נרשם חדש ממתין לאישור',
    source: 'api/public/signup · lib/signup-queue',
  },
  {
    kind: 'store_order',
    label: 'הזמנה בחנות',
    hint: 'הזמנה חדשה בחנות המועדון',
    source: 'api/store/orders',
  },
  {
    kind: 'workout_delivery_failed',
    label: 'אימון לא הגיע לשעון',
    hint: 'דחיפת אימון לגרמין נכשלה',
    source: 'api/garmin/push-workouts',
  },
  {
    kind: 'program_week_missing',
    label: 'תוכנית השבוע חסרה',
    hint: 'שבת 20:00 — אימונים או תזונה לשבוע הבא עוד לא הועלו',
    source: 'api/cron/tick',
  },
  {
    kind: 'sync_stalled',
    label: 'הסנכרון נתקע',
    hint: 'פעם ביום ב-09:00 — אם לא נכנסה שום פעילות במשך 24 שעות',
    source: 'api/cron/tick',
  },
];

export const ROUTED_KIND_KEYS = new Set(ROUTED_KINDS.map((k) => k.kind));

export type RoutingMatrix = Record<string, Partial<Record<RoutableRole, boolean>>>;

function isRoutableRole(role: string): role is RoutableRole {
  return (ROUTABLE_ROLES as readonly string[]).includes(role);
}

/**
 * The whole table, as `matrix[kind][role] = enabled`. `null` when the table isn't
 * there — the admin screen renders "run the migration" rather than an empty grid
 * that looks like a club with no alerts configured.
 */
export async function routingMatrix(): Promise<RoutingMatrix | null> {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase.from('notification_routing').select('kind, role, enabled');
    if (error) {
      if (error.code === UNDEFINED_TABLE || error.code === UNDEFINED_COLUMN) return null;
      throw error;
    }
    const matrix: RoutingMatrix = {};
    for (const row of (data || []) as Array<{ kind: string; role: string; enabled: boolean }>) {
      if (!isRoutableRole(row.role)) continue; // a row somebody added by hand
      (matrix[row.kind] ||= {})[row.role] = !!row.enabled;
    }
    return matrix;
  } catch {
    return null; // unreadable is "unconfigured", never a throw on a send path
  }
}

/**
 * The roles configured to receive `kind`, or `null` when the kind has no rows at
 * all. An empty array means "configured to nobody" — see the header.
 */
export async function rolesForKind(kind: string): Promise<RoutableRole[] | null> {
  const matrix = await routingMatrix();
  const row = matrix?.[kind];
  if (!row || Object.keys(row).length === 0) return null;
  return ROUTABLE_ROLES.filter((r) => row[r] === true);
}

/**
 * The athlete ids configured to receive `kind`, or `null` when it has no routing
 * rows and the caller should use its own fallback.
 *
 * No `status` filter, matching `staffRecipientIds()`: a suspended admin is a
 * situation nobody has, and inventing a rule here would make the routing screen's
 * recipient preview disagree with what actually gets sent — which is the exact
 * class of bug this module exists to end.
 */
export async function recipientsForKind(kind: string): Promise<string[] | null> {
  try {
    const roles = await rolesForKind(kind);
    if (roles === null) return null;
    if (roles.length === 0) return [];
    const supabase = createServerClient();
    const { data, error } = await supabase.from('athletes').select('id').in('role', roles);
    if (error) return null; // couldn't resolve → let the caller's fallback answer
    return [...new Set(((data || []) as Array<{ id: string }>).map((r) => r.id))];
  } catch {
    return null;
  }
}
