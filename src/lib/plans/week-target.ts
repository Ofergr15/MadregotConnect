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
  /**
   * How many of the ceiling's kilometres are OFFERED rather than prescribed —
   * the width the optional evenings add to the top of the band.
   *
   * On screen it is the sentence that explains why the target is a band at all.
   * Without it the green zone is just a wide green zone, and the athlete reading
   * "45/101–120" has no way to know that the 120 end is only reachable by taking
   * sessions nobody asked them to take.
   *
   * 0 when the plan has no offered sessions, and also 0 on a plan stored before
   * the required/optional split existed — there the split is unknowable, and a
   * missing sentence is better than an invented number.
   */
  optionalKm: number;
}

/** The two ends alone — all the geometry below needs. */
type Band = Pick<WeekTarget, 'min' | 'max'>;

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

  // The prescribed week at its LONG end. Everything above it is on offer, so the
  // gap to the ceiling is what the optional sessions contribute. Absent on the
  // same older plans `weekRequiredMin` is absent on, where it falls back to the
  // ceiling itself and the gap comes out 0 — see `optionalKm`.
  const requiredCeiling = plan.weekRequiredMax && plan.weekRequiredMax > 0 ? plan.weekRequiredMax : max;

  // A floor above the ceiling is nonsense to render. It can only happen on a
  // malformed plan, and clamping is quieter than a bar that draws backwards.
  return {
    min: round1(Math.min(floor, max)),
    max,
    optionalKm: round1(Math.max(0, max - requiredCeiling)),
  };
}

export type WeekTargetState = 'below' | 'in' | 'above';

/** Below the floor, inside the band, or past the ceiling. */
export function weekTargetState(doneKm: number, target: Band): WeekTargetState {
  if (doneKm > target.max) return 'above';
  // `>=` on purpose: hitting the floor exactly is on plan, not one metre short
  // of it. The floor is already the most forgiving reading of the week.
  if (doneKm >= target.min) return 'in';
  return 'below';
}

export interface WeekTargetGeometry {
  /** Where the fill ends. */
  fillPct: number;
  /** Where the green target zone starts. */
  floorPct: number;
  /** Where it ends — 100, unless the week has already run past the ceiling. */
  ceilingPct: number;
}

/**
 * The three coordinates the bar draws, all off ONE scale.
 *
 * One function rather than three, because the bug they invite is drawing the
 * fill and the zone against different maxima — and then the zone no longer means
 * what the fill is measured in.
 *
 * The track runs 0 → the ceiling, and stretches only when the athlete has gone
 * PAST the ceiling. With the track ending there, a week over target filled it end
 * to end and painted over the zone, so the one bar whose whole job is "did I land
 * in the band" stopped showing the band at the moment the answer got interesting.
 * Stretching to the kilometres actually run keeps the zone on screen and makes the
 * overshoot the part you see.
 */
export function weekTargetGeometry(doneKm: number, target: Band): WeekTargetGeometry {
  const scale = Math.max(target.max, doneKm);
  if (scale <= 0) return { fillPct: 0, floorPct: 0, ceilingPct: 100 };
  const pct = (km: number) => Math.max(0, Math.min(100, Math.round((km / scale) * 100)));
  return { fillPct: pct(doneKm), floorPct: pct(target.min), ceilingPct: pct(target.max) };
}

export interface WeekTargetSegments extends WeekTargetGeometry {
  /** Where the kilometres that landed INSIDE the band stop. */
  inEndPct: number;
  /** Is there a stretch inside the band to paint at all? */
  inBand: boolean;
  /** Only while nothing has crossed the floor — past that the colour marks it. */
  showFloorTick: boolean;
}

/**
 * The bar's segments: the fill cut at the band's edges.
 *
 * Here rather than in the component because the clamp is the whole correctness of
 * the drawing — `inEndPct` has to stop at the ceiling, or a week that ran past the
 * band paints bright green over the overshoot and reports being on plan.
 */
export function weekTargetSegments(doneKm: number, target: Band): WeekTargetSegments {
  const geometry = weekTargetGeometry(doneKm, target);
  const inEndPct = Math.min(geometry.fillPct, geometry.ceilingPct);
  const inBand = inEndPct > geometry.floorPct;
  return { ...geometry, inEndPct, inBand, showFloorTick: !inBand };
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

