/**
 * The pure half of POST /api/admin/pack-move (task 152): reading the body, and the effect
 * summary a coach sees before (dry run) and after a move — "what changes on the watch".
 */
import { laneOfName } from './pack-history';
import type { WatchEffect } from './pack-move';

export const MIGRATION_326 = 'migration-326';
export const MIGRATION_326_TEXT = 'צריך להריץ מיגרציה 326';
export const REASON_MAX = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MoveBody { athleteId: string; toGroupId: string | null; dryRun: boolean; reason: string | null }

export function readMoveBody(raw: unknown): MoveBody | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'invalid body' };
  const b = raw as Record<string, unknown>;
  if (typeof b.athleteId !== 'string' || !UUID_RE.test(b.athleteId)) return { error: 'athleteId is required' };
  if (!('toGroupId' in b)) return { error: 'toGroupId is required (null = no pack)' };
  if (b.toGroupId !== null && (typeof b.toGroupId !== 'string' || !UUID_RE.test(b.toGroupId))) return { error: 'toGroupId must be a pack id or null' };
  if (b.dryRun !== undefined && typeof b.dryRun !== 'boolean') return { error: 'dryRun must be a boolean' };
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length > REASON_MAX) return { error: `reason is limited to ${REASON_MAX} characters` };
  return { athleteId: b.athleteId, toGroupId: (b.toGroupId as string | null), dryRun: b.dryRun === true, reason: reason || null };
}

/** What the function returns (migration 326). */
export interface MoveRpcResult {
  status: 'moved' | 'unchanged' | 'not_found';
  from_group_id?: string | null;
  to_group_id?: string | null;
  cancelled_pending_group_id?: string | null;
  move_id?: string;
}

/** PostgREST "no such function" (PGRST202) / Postgres undefined_function (42883). */
export const isMissingMoveFunction = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /move_athlete_group/.test(e.message || ''));

const PACE_KEY_LANE: Record<string, number> = { group1: 1, group2: 2, group3: 3 };

export interface PackRef { id: string | null; name: string | null; lane: number | null }

export interface MoveSummary {
  from: PackRef;
  to: PackRef;
  /** Runs before this day keep the old pack (athlete_pack_history). */
  fromDate: string;
  watch: {
    /** The watch's paces come from another plan variant after the move. */
    paceVariantChanges: boolean;
    /** Plan-week days (0 = Sunday) ahead already on the watch. */
    onWatchDays: number[];
    /** Of those, the ones that are re-sent because the new pack's workout is a different workout. */
    resendDays: number[];
    reason: WatchEffect['reason'] | 'unknown';
    /** One line for the screen, Hebrew. */
    summaryHe: string;
  };
  /** A Saturday change the member had scheduled, which this move cancels. */
  cancelsPending: { groupId: string; name: string | null; from: string | null } | null;
  /** A coach's move to a pack pushes "עברת לדבוקה N" to the runner; to no pack, nothing. */
  notifiesRunner: boolean;
}

const DAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function watchLine(w: WatchEffect | null): string {
  if (!w) return 'לא הצלחנו לבדוק את השעון — המעבר עצמו לא מושפע.';
  switch (w.reason) {
    case 'no_plan': return 'אין תוכנית שבועית שנשלחה לשעון השבוע — אין מה לעדכן.';
    case 'flat_plan': return 'התוכנית השבוע זהה לכל הדבוקות — השעון לא משתנה.';
    case 'nothing_on_watch': return 'לא נשלחו אימונים לשעון לימים שנשארו השבוע — אין מה לעדכן.';
    case 'same_variant': return 'הקצבים בשעון מגיעים מאותה דבוקה — השעון לא משתנה.';
    case 'same_workouts': return 'אותם אימונים, רק קצבים אחרים — והשעון כבר מציג את הקצבים של כל הדבוקות. לא נשלח מחדש.';
    case 'resend': return `יישלחו מחדש לשעון: ${w.resendDays.map((d) => `יום ${DAY_HE[d]}`).join(', ')} (אימון שונה בדבוקה החדשה).`;
  }
}

export function summariseMove(p: {
  packs: Array<{ id: string; name: string | null }>;
  fromGroupId: string | null;
  toGroupId: string | null;
  fromDate: string;
  watch: WatchEffect | null;
  pending: { groupId: string; from: string | null } | null;
}): MoveSummary {
  const ref = (id: string | null): PackRef => {
    const name = id ? p.packs.find((g) => g.id === id)?.name ?? null : null;
    return { id, name, lane: id ? laneOfName(name) : null };
  };
  const w = p.watch;
  return {
    from: ref(p.fromGroupId),
    to: ref(p.toGroupId),
    fromDate: p.fromDate,
    watch: {
      paceVariantChanges: !!w && !!w.fromKey && !!w.toKey && PACE_KEY_LANE[w.fromKey] !== PACE_KEY_LANE[w.toKey],
      onWatchDays: w?.onWatchDays ?? [],
      resendDays: w?.resendDays ?? [],
      reason: w?.reason ?? 'unknown',
      summaryHe: watchLine(w),
    },
    cancelsPending: p.pending ? { groupId: p.pending.groupId, name: ref(p.pending.groupId).name, from: p.pending.from } : null,
    notifiesRunner: p.toGroupId !== null,
  };
}
