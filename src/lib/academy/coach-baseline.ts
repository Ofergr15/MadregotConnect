/**
 * The coach's pace baseline (Ofer, 2026-10-20, mockups/coach-baseline): for a trainee who is
 * already in the academy, the coach sets a distance and a result instead of a test, and every
 * pace follows from it exactly as from a test.
 *
 * Stored as an `academy_tests` row with protocol `coach_baseline`, written as its 30-minute
 * EQUIVALENT (1800 s over the distance a 30-minute effort would cover), so `thresholdPaceSec`
 * — duration over distance — reads it unchanged. The race → 30-minute step is the inverse of
 * `estimateFinish` (goal.ts): Riegel, T2 = T1 · (D2/D1)^1.06. No migration: `protocol` is free
 * text (migration 105 has no CHECK on it).
 *
 * Precedence (Ofer, 2026-10-20): a coach's manual zone > an approved 30-minute test > this
 * baseline > the band's paces. A baseline never enters the test trend or the staleness clock.
 */

export const BASELINE_PROTOCOL = 'coach_baseline';
/** The protocols that may price a trainee's paces, strongest first. */
export const PRICING_PROTOCOLS = ['30min', BASELINE_PROTOCOL] as const;

export type BaselineDistance = '5k' | '10k' | 'hm' | 'm';
export const BASELINE_DISTANCES: Record<BaselineDistance, { km: number; label: string }> = {
  '5k': { km: 5, label: '5 ק״מ' },
  '10k': { km: 10, label: '10 ק״מ' },
  hm: { km: 21.0975, label: 'חצי' },
  m: { km: 42.195, label: 'מרתון' },
};
export const isBaselineDistance = (v: unknown): v is BaselineDistance =>
  typeof v === 'string' && v in BASELINE_DISTANCES;

/** What a coach-set result may be: 1–50 km, and a pace between 2:30 and 10:00 /km. */
export function validResult(km: number, sec: number): boolean {
  if (!(km >= 1 && km <= 50) || !(sec > 0)) return false;
  const pace = sec / km;
  return pace >= 150 && pace <= 600;
}

/** The pace of a 30-minute all-out effort (sec/km) for a known result — Riegel, inverted. */
export function thresholdFromRace(km: number, sec: number): number | null {
  if (!validResult(km, sec)) return null;
  const d30 = km * Math.pow(1800 / sec, 1 / 1.06);
  return Math.round(1800 / d30);
}

/** The row to store: the result's 30-minute equivalent, both halves filled. */
export function baselineTestRow(km: number, sec: number): { duration_sec: number; distance_m: number } | null {
  const thr = thresholdFromRace(km, sec);
  if (!thr) return null;
  return { duration_sec: 1800, distance_m: Math.round((1800 / thr) * 1000) };
}

/** The source result, kept in the row's notes so the coach's numbers can be shown again. */
export interface BaselineSource {
  distance: BaselineDistance | 'other';
  km: number;
  sec: number;
  /** 'sheet' (the academy's file), 'race' (a recent result), 'estimate' (the coach's guess). */
  origin: 'sheet' | 'race' | 'estimate';
}
export const baselineNotes = (s: BaselineSource) => JSON.stringify({ baseline: s });
export function parseBaselineNotes(notes: string | null | undefined): BaselineSource | null {
  try {
    const v = JSON.parse(notes || '');
    const b = v?.baseline;
    if (!b || typeof b.km !== 'number' || typeof b.sec !== 'number') return null;
    return { distance: isBaselineDistance(b.distance) ? b.distance : 'other', km: b.km, sec: b.sec, origin: ['sheet', 'race', 'estimate'].includes(b.origin) ? b.origin : 'estimate' };
  } catch {
    return null;
  }
}

/** The academy file's results (athletes.academy_intake.sheet_results), seconds per distance. */
export type SheetResults = Partial<Record<BaselineDistance, number>>;
export function readSheetResults(intake: unknown): SheetResults | null {
  const raw = intake && typeof intake === 'object' ? (intake as Record<string, unknown>).sheet_results : null;
  if (!raw || typeof raw !== 'object') return null;
  const out: SheetResults = {};
  for (const k of Object.keys(BASELINE_DISTANCES) as BaselineDistance[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'number' && validResult(BASELINE_DISTANCES[k].km, v)) out[k] = Math.round(v);
  }
  return Object.keys(out).length ? out : null;
}

/** How far apart two thresholds may be and still tell the same story (sec/km). */
export const CONSISTENT_SEC = 8;

/**
 * The result to suggest from the file, and the ones that contradict it. Each result is turned
 * into a threshold; the suggestion is the 10 km when it agrees with the median (the distance
 * nearest a threshold effort), else the result closest to the median, and a result whose
 * threshold is more than CONSISTENT_SEC off is flagged rather than averaged in.
 */
export function suggestFromSheet(results: SheetResults | null): { pick: BaselineDistance; sec: number; outliers: BaselineDistance[] } | null {
  if (!results) return null;
  const rows = (Object.keys(results) as BaselineDistance[])
    .map(k => ({ k, sec: results[k]!, thr: thresholdFromRace(BASELINE_DISTANCES[k].km, results[k]!) }))
    .filter((r): r is { k: BaselineDistance; sec: number; thr: number } => r.thr != null);
  if (!rows.length) return null;
  const sorted = [...rows].map(r => r.thr).sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const order: BaselineDistance[] = ['10k', 'hm', '5k', 'm'];
  const preferred = rows.find(r => r.k === '10k' && Math.abs(r.thr - median) <= CONSISTENT_SEC);
  const best = preferred ?? [...rows].sort((a, b) => Math.abs(a.thr - median) - Math.abs(b.thr - median) || order.indexOf(a.k) - order.indexOf(b.k))[0];
  // A marathon run slower than Riegel predicts is normal for anyone but an elite: not a contradiction.
  const outliers = rows.length >= 3
    ? rows.filter(r => Math.abs(r.thr - best.thr) > CONSISTENT_SEC && !(r.k === 'm' && r.thr > best.thr)).map(r => r.k)
    : [];
  return { pick: best.k, sec: best.sec, outliers };
}

export type PricingSource = 'test' | 'coach';

interface PricingRowLike {
  athlete_id: string;
  test_date: string;
  protocol?: string | null;
  status?: string | null;
  excluded_reason?: string | null;
}

/**
 * Which rows may price a trainee, by the precedence: every approved, not-excluded 30-minute
 * test; only when there is none, the newest coach baseline. Rows come back with their source,
 * newest first per athlete. The one rule `loadThresholds`, `loadTestBasis` and `loadTestsFor`
 * share, so the plan, the load and the coach tools stand on the same number.
 */
export function pricingRows<R extends PricingRowLike>(rows: R[]): Array<R & { source: PricingSource }> {
  const ok = (r: R) => !r.excluded_reason && (r.status ?? 'approved') === 'approved';
  const byAthlete = new Map<string, R[]>();
  for (const r of rows) if (ok(r)) byAthlete.set(r.athlete_id, [...(byAthlete.get(r.athlete_id) ?? []), r]);
  const out: Array<R & { source: PricingSource }> = [];
  for (const list of byAthlete.values()) {
    const sorted = [...list].sort((a, b) => String(b.test_date).localeCompare(String(a.test_date)));
    const thirty = sorted.filter(r => (r.protocol ?? '30min') === '30min');
    if (thirty.length) out.push(...thirty.map(r => ({ ...r, source: 'test' as const })));
    else {
      const base = sorted.find(r => r.protocol === BASELINE_PROTOCOL);
      if (base) out.push({ ...base, source: 'coach' as const });
    }
  }
  return out;
}
