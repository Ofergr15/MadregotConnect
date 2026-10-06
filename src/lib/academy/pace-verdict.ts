// ── The pace rule, one implementation ───────────────────────────────────────
//
// The trainee's academy screens (the home's workout rows, the plan-vs-actual
// sheet, its chart) all answer the same question about a number — "was that what
// the plan asked for?" — and they must answer it identically, or the row says
// green while the sheet it opens says orange. So the decision lives here, pure
// and tested, and the components only draw it.
//
// THE RULE (approved mockups academy-trainee-home-v4 / academy-plan-vs-actual):
//   on plan  — inside the planned band widened by the manager's tolerance →
//              green, no arrow, "✓ בתוכנית"
//   faster   — green with an UP arrow, "▲ 7 שנ׳ מהר"
//   slower   — orange with a DOWN arrow, "▼ 9 שנ׳ לאט"
// The arrow is a shape, never colour alone, so it reads without telling green
// from orange — and in the sun.
//
// The tolerance DECIDES on/off; the printed delta is measured from the band the
// coach wrote, not from the tolerance edge. A 4:10 target run at 4:03 is "7 שנ׳
// מהר", which is the sentence the trainee can check against their watch — "2
// seconds outside a ±5 window" is arithmetic about our settings.
//
// Units: pace sec/km (smaller = faster), distance metres, time seconds.

export type PaceKind = 'on' | 'fast' | 'slow';

export interface PaceVerdict {
  kind: PaceKind;
  /** Whole seconds per km away from the planned band; 0 when on plan. */
  deltaSec: number;
}

/**
 * Pace against a planned band. `min`/`max` are the coach's band (min = faster
 * limit); a one-sided target passes the same number twice. Null when either side
 * is missing — no target is not "on plan".
 */
export function paceVerdict(
  actual: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
  toleranceSec: number,
): PaceVerdict | null {
  if (actual == null || !Number.isFinite(actual) || actual <= 0) return null;
  const lo = min ?? max;
  const hi = max ?? min;
  if (lo == null || hi == null || lo <= 0) return null;
  const fast = Math.min(lo, hi);
  const slow = Math.max(lo, hi);
  const tol = Math.max(0, toleranceSec);
  if (actual < fast - tol) return { kind: 'fast', deltaSec: Math.round(fast - actual) };
  if (actual > slow + tol) return { kind: 'slow', deltaSec: Math.round(actual - slow) };
  return { kind: 'on', deltaSec: 0 };
}

/** Distance and time: doing less of the session, or more of it. */
export type AmountKind = 'on' | 'more' | 'less';

export interface AmountVerdict {
  kind: AmountKind;
  /** Absolute distance (metres) or time (seconds) away from the planned range; 0 when on plan. */
  delta: number;
}

/**
 * An amount (distance or duration) against a planned range, with a FRACTIONAL
 * tolerance — the same ±15% the adherence engine grades with (`assessRange`), so
 * a run the coach's compliance table calls on-target is on-target here too.
 */
export function amountVerdict(
  actual: number | null | undefined,
  plannedMin: number | null | undefined,
  plannedMax: number | null | undefined,
  toleranceFraction: number,
): AmountVerdict | null {
  if (actual == null || !Number.isFinite(actual)) return null;
  const lo = plannedMin ?? plannedMax;
  const hi = plannedMax ?? plannedMin;
  if (lo == null || hi == null || hi <= 0) return null;
  const tol = Math.max(0, toleranceFraction);
  if (actual < lo * (1 - tol)) return { kind: 'less', delta: lo - actual };
  if (actual > hi * (1 + tol)) return { kind: 'more', delta: actual - hi };
  return { kind: 'on', delta: 0 };
}

/**
 * The amount verdict in the pace rule's three looks. Less of the session is the
 * slow look (orange ▼), more of it the fast look (green ▲) — the same pairing
 * `DIRECTION_COLOR` settled on for too_short / too_long, so a run cut short never
 * reads calmer than one that overshot.
 */
export function amountLook(kind: AmountKind): PaceKind {
  return kind === 'less' ? 'slow' : kind === 'more' ? 'fast' : 'on';
}

// ── Words ───────────────────────────────────────────────────────────────────
// The pill text WITHOUT its symbol: the arrow / check is drawn as an SVG by the
// component, never typed as a ▲ glyph a screen reader reads as "black up-pointing
// triangle".

export const ON_PLAN_LABEL = 'בתוכנית';

/** "בתוכנית" · "7 שנ׳ מהר" · "9 שנ׳ לאט". `short` drops the word: "7 שנ׳" (table cells). */
export function pacePillText(v: PaceVerdict, short = false): string {
  if (v.kind === 'on') return ON_PLAN_LABEL;
  const n = `${v.deltaSec} שנ׳`;
  if (short) return n;
  return v.kind === 'fast' ? `${n} מהר` : `${n} לאט`;
}

/** One decimal, no trailing ".0" — "3.8", "12". */
function km1(meters: number): string {
  const v = Math.round(meters / 100) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** "בתוכנית" · "3.8 ק״מ חסר" · "0.4 ק״מ יותר". */
export function distancePillText(v: AmountVerdict): string {
  if (v.kind === 'on') return ON_PLAN_LABEL;
  return `${km1(v.delta)} ק״מ ${v.kind === 'less' ? 'חסר' : 'יותר'}`;
}

/** "בתוכנית" · "20 דק׳ חסר" · "4 דק׳ יותר". Whole minutes, at least 1. */
export function timePillText(v: AmountVerdict): string {
  if (v.kind === 'on') return ON_PLAN_LABEL;
  const minutes = Math.max(1, Math.round(v.delta / 60));
  return `${minutes} דק׳ ${v.kind === 'less' ? 'חסר' : 'יותר'}`;
}

// ── Presentation ────────────────────────────────────────────────────────────
// Next to the enum it keys off, like verdict.ts's DIRECTION_COLOR, because four
// surfaces draw it. Values straight from the approved mockups: the on/fast green
// is the mockup's #0F7A3D (5.6:1 on white), the slow orange its #B54708 (5.1:1)
// — the band-3 orange family, at the darkness text needs.

export const PACE_INK: Record<PaceKind, string> = {
  on: '#0F7A3D',
  fast: '#0F7A3D',
  slow: '#B54708',
};

export const PACE_TINT: Record<PaceKind, string> = {
  on: '#E2F4E8',
  fast: '#E2F4E8',
  slow: '#FDEBDD',
};

/** Chart dot fills: a brighter green for on-plan, the ink green for faster, orange for slower. */
export const PACE_DOT: Record<PaceKind, string> = {
  on: '#1FA55B',
  fast: '#0F7A3D',
  slow: '#E8893A',
};

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * sec/km → "4:08". Rounds the TOTAL first: formatting minutes and rounded
 * seconds separately prints 239.6 s as "3:60".
 */
export function fmtPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return '—';
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** seconds → "54:20" or "1:05:03". */
export function fmtClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** metres → "10.3" (km, one decimal, trailing ".0" dropped). */
export function fmtKm(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  return km1(meters);
}
