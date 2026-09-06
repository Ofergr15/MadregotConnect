/**
 * The week's kilometre target as a RANGE rather than a single number.
 *
 * ── WHY A RANGE ──────────────────────────────────────────────────────────────
 * The club's plan is a menu, not a prescription: most days carry a span ("11–13
 * ק״מ") and some carry a second, offered session ("ערב אופציה") that nobody is
 * expected to always take. Collapsing all of that into one figure never worked.
 * The top of the range made the bar unfinishable — run every session at the
 * middle of its span and it sat near 85% — and the midpoint that replaced it
 * came out at 146.3 km for a week whose prescribed sessions add up to about 115,
 * because it counted every optional evening as half-mandatory.
 *
 * So the target is the band the athlete is on plan inside:
 *   floor — every PRESCRIBED session at the short end of its span. Take none of
 *           the offered extras and you are still on plan.
 *   ceiling — every session, offered ones included, at the long end.
 * Anywhere between the two is "on plan"; that is the whole point of the range.
 */

export interface WeekPlanTotals {
  hasPlan?: boolean;
  weekTotalMin?: number;
  weekTotalMax?: number;
  weekRequiredMin?: number;
  weekRequiredMax?: number;
}

export interface WeekTarget {
  /** Prescribed sessions only, short end. */
  min: number;
  /** Everything on offer, long end. */
  max: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * `null` when there is nothing honest to measure against — no plan for the week,
 * or a plan whose sessions carry no distance at all. The caller hides the bar
 * rather than drawing one against zero.
 */
export function weekTargetRange(plan: WeekPlanTotals | null | undefined): WeekTarget | null {
  if (!plan?.hasPlan) return null;

  const max = round1(plan.weekTotalMax || 0);
  if (max <= 0) return null;

  // `weekRequiredMin` is missing on a plan stored before the required/optional
  // split existed, and it is 0 on the (odd but possible) week where every
  // session is marked optional. Both fall back to the plain minimum, which is
  // the same figure with nothing excluded — a wider floor is better than a
  // floor of zero, which would make every athlete "on plan" from their first km.
  const floor = plan.weekRequiredMin && plan.weekRequiredMin > 0
    ? plan.weekRequiredMin
    : plan.weekTotalMin || 0;

  // A floor above the ceiling is nonsense to render. It can only happen on a
  // malformed plan, and clamping is quieter than a bar that draws backwards.
  return { min: round1(Math.min(floor, max)), max };
}

export type WeekTargetState = 'below' | 'in' | 'above';

/** Below the floor, inside the band, or past the ceiling. */
export function weekTargetState(doneKm: number, target: WeekTarget): WeekTargetState {
  if (doneKm > target.max) return 'above';
  // `>=` on purpose: hitting the floor exactly is on plan, not one metre short
  // of it. The floor is already the most forgiving reading of the week.
  if (doneKm >= target.min) return 'in';
  return 'below';
}

/** Where the fill ends, as a percentage of the ceiling. Capped at 100. */
export function weekTargetProgressPct(doneKm: number, target: WeekTarget): number {
  if (target.max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((doneKm / target.max) * 100)));
}

/** The shape `buildWeekBreakdown` gives each day of the week. */
export interface DayTotals {
  min: number;
  max: number;
  requiredMin?: number;
  requiredMax?: number;
  sessions?: Array<{ optional?: boolean }>;
}

/**
 * A single day's kilometres, written the same way the week's band is: what is
 * actually prescribed, plus a note that more is on offer.
 *
 * Without this a Tuesday of a 23.6–24.5 morning and a 15.8–16.6 optional evening
 * printed "39.4–41.1", a number nobody in the club runs on a Tuesday — and it
 * contradicted the week band right above it on the same screen, whose floor
 * excludes exactly that evening. So the range is the prescribed session and the
 * offered one is flagged rather than added in.
 */
export function dayTargetLabel(d: DayTotals): { km: string; hasOptional: boolean } {
  const hasOptional = (d.sessions || []).some((s) => s.optional);
  // Older `parsed_workouts` have no required split at all; their totals already
  // are the prescribed figure because nothing was ever marked optional.
  const min = d.requiredMin ?? d.min;
  const max = d.requiredMax ?? d.max;
  const km = min === max ? `${round1(max)}` : `${round1(min)}–${round1(max)}`;
  return { km, hasOptional };
}

/** Where the floor sits on that same track, so the band can be drawn behind it. */
export function weekTargetFloorPct(target: WeekTarget): number {
  if (target.max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((target.min / target.max) * 100)));
}
