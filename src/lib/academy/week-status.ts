/**
 * "This plan week, for the whole academy: whose plan reached the watch, whose did not,
 * and who has no plan yet" — the three tiles at the top of תוכניות → השבוע, and the
 * short list under them of only the people who need something.
 *
 * Pure, so the arithmetic is tested and the component draws. The verdict per slot is
 * NOT re-decided here: `buildDispatchReport` (lib/academy/dispatch.ts) already says
 * which slots are actionable, and this folds those slots into one answer per trainee.
 *
 * Three rules worth stating, because each is a way the tiles could lie:
 *
 *  - **"Delivered" is the dispatch report's word, not ours.** A trainee is delivered when
 *    their week has pushed slots and none of them is a failure the coach can fix
 *    (`send_failed`, `not_sent`, `unconfirmed`). A `blind` slot is delivered — the workout
 *    is on their account; we just cannot see the run come back.
 *  - **A plan that was saved but never pushed is not delivered.** The report has no row
 *    for it at all, which is exactly why the roster carries `planWorkouts`.
 *  - **Unknown is not "no plan".** When the plans read failed, `planWorkouts` is null and
 *    the trainee is never counted under "עוד אין תוכנית".
 */

import type { ConnectionState } from '../providers/health';
import type { DispatchReport, DispatchRow } from './dispatch';

/** One in-scope trainee, as `GET /api/academy/dispatch` reports them beside the verdicts. */
export interface DispatchRosterEntry {
  athleteId: string;
  name: string;
  /** A Garmin credential is stored. Never the credential. */
  hasGarmin: boolean;
  connection: ConnectionState;
  /** Workouts in their OWN plan for this week; 0 = none built; null = could not read. */
  planWorkouts: number | null;
}

/** `{ workouts: [...] }` (an academy plan) or the club's grouped shape — the count either way. */
export function countPlanWorkouts(parsed: unknown): number {
  if (!parsed || typeof parsed !== 'object') return 0;
  const p = parsed as Record<string, unknown>;
  if (Array.isArray(p.workouts)) return p.workouts.length;
  for (const v of Object.values(p)) {
    if (v && typeof v === 'object' && Array.isArray((v as { workouts?: unknown }).workouts)) {
      return ((v as { workouts: unknown[] }).workouts).length;
    }
  }
  return 0;
}

export type WeekStatusKind = 'delivered' | 'undelivered' | 'no_plan';

export interface WeekStatusRow {
  athleteId: string;
  name: string;
  kind: Exclude<WeekStatusKind, 'delivered'>;
  /** The one line under the name, in Hebrew. */
  reason: string;
  /**
   * Whether "לשלוח שוב" can do anything. False for a trainee with no Garmin linked: a
   * resend has nowhere to go, and a button that can only fail is a dead control.
   */
  canResend: boolean;
}

export interface PlanWeekStatus {
  total: number;
  delivered: number;
  undelivered: number;
  noPlan: number;
  /** Not delivered first, then no plan; by name inside each. */
  needs: WeekStatusRow[];
}

/** What a trainee needs to know about themselves beyond the roster, all optional. */
export interface WeekStatusExtras {
  /** 'YYYY-MM-DD' they joined the academy — "new" reads differently from "forgotten". */
  academyJoinedOn?: string | null;
  hasBand?: boolean;
}

const FIX: ReadonlySet<DispatchRow['state']> = new Set(['send_failed', 'not_sent', 'unconfirmed']);

/** Two weeks — the same span the members screen calls somebody new. */
const NEW_DAYS = 14;

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.round((b - a) / 86_400_000);
}

/** The reason line for a trainee whose week did not reach the watch. */
export function undeliveredReason(entry: DispatchRosterEntry, failing: DispatchRow[]): string {
  if (!entry.hasGarmin) return 'אין Garmin מחובר, התוכנית לא יכולה להגיע לשעון';
  const worst = failing[0];
  if (!worst) return 'התוכנית נשמרה ולא נשלחה לשעון';
  const many = failing.length > 1 ? ` · ${failing.length} אימונים` : '';
  switch (worst.state) {
    case 'send_failed':
      // No count: a dead connection fails the whole week, and the line has to fit.
      if (worst.blame === 'reconnect') return 'Garmin לא מחובר, צריך לחבר מחדש';
      if (worst.blame === 'ours') return `תקלה אצל Garmin או אצלנו${many}`;
      return `השליחה נכשלה${many}`;
    case 'unconfirmed':
      return `Garmin קיבל ולא אישר${many}`;
    case 'not_sent':
      return `לא נשלח לשעון${many}`;
    default:
      return 'לא הגיע לשעון';
  }
}

export function buildPlanWeekStatus(
  roster: DispatchRosterEntry[],
  report: Pick<DispatchReport, 'rows'> | null,
  opts: { weekStart: string; extras?: Map<string, WeekStatusExtras> },
): PlanWeekStatus {
  const rowsBy = new Map<string, DispatchRow[]>();
  for (const r of report?.rows ?? []) {
    const list = rowsBy.get(r.athleteId) ?? [];
    list.push(r);
    rowsBy.set(r.athleteId, list);
  }

  let delivered = 0;
  const undelivered: WeekStatusRow[] = [];
  const noPlan: WeekStatusRow[] = [];

  for (const entry of roster) {
    const rows = rowsBy.get(entry.athleteId) ?? [];
    const failing = rows.filter(r => FIX.has(r.state));
    const extra = opts.extras?.get(entry.athleteId);

    // Unknown plan count: judge only on what was pushed. Pushed and clean is delivered;
    // anything else is left out of every tile rather than guessed.
    if (entry.planWorkouts === null) {
      if (failing.length) {
        undelivered.push({ athleteId: entry.athleteId, name: entry.name, kind: 'undelivered', reason: undeliveredReason(entry, failing), canResend: entry.hasGarmin });
      } else if (rows.length) delivered += 1;
      continue;
    }

    if (entry.planWorkouts === 0 && rows.length === 0) {
      const isNew = !!extra?.academyJoinedOn && daysBetween(extra.academyJoinedOn, opts.weekStart) <= NEW_DAYS;
      noPlan.push({
        athleteId: entry.athleteId,
        name: entry.name,
        kind: 'no_plan',
        reason: extra?.hasBand === false
          ? 'עוד אין דבוקה ועוד אין תוכנית'
          : isNew ? 'חדש באקדמיה, עוד אין תוכנית' : 'עוד אין תוכנית לשבוע הזה',
        canResend: false,
      });
      continue;
    }

    if (failing.length || rows.length === 0) {
      undelivered.push({
        athleteId: entry.athleteId,
        name: entry.name,
        kind: 'undelivered',
        reason: undeliveredReason(entry, failing),
        canResend: entry.hasGarmin,
      });
      continue;
    }
    delivered += 1;
  }

  const byName = (a: WeekStatusRow, b: WeekStatusRow) => a.name.localeCompare(b.name);
  return {
    total: roster.length,
    delivered,
    undelivered: undelivered.length,
    noPlan: noPlan.length,
    needs: [...undelivered.sort(byName), ...noPlan.sort(byName)],
  };
}

/** What the resend answered, in the coach's words. */
export function resendErrorText(code: string | null | undefined): string {
  switch (code) {
    case 'garmin-not-connected': return 'אין Garmin מחובר';
    case 'no-plan': return 'אין תוכנית לשבוע הזה';
    case 'not-academy': return 'לא באקדמיה';
    case 'Not your trainee': return 'לא המתאמן שלך';
    default: return 'השליחה נכשלה';
  }
}
