/** Pure pieces of GET /api/activities/similar (scope filter, pace at HR 130–140). */

export type SimilarScope = 'same' | 'type' | 'all';

export interface SimilarSession {
  id: string;
  date: string;
  title: string;
  distanceM: number;
  avgPace: number | null;
  avgHr: number | null;
  repPaces: number[];
  repsOnTarget: number | null;
  repsTotal: number | null;
  paceAtHr: number | null;
  today?: true;
}

export interface SimilarFacts { quality: boolean; repLen: number; repCount: number; distanceM: number }

const HR_LO = 130;
const HR_HI = 140;

const within = (a: number, b: number, frac: number) => b > 0 && Math.abs(a - b) / b <= frac;

/** Does a past run belong in this scope, against today's run? */
export function matchesScope(scope: SimilarScope, today: SimilarFacts, past: SimilarFacts): boolean {
  if (today.quality) {
    if (!past.quality) return false;
    if (scope === 'all') return true;
    if (!within(past.repLen, today.repLen, 0.25)) return false;
    return scope === 'type' || Math.abs(past.repCount - today.repCount) <= 1;
  }
  if (past.quality) return false;
  if (scope === 'same') return within(past.distanceM, today.distanceM, 0.15);
  if (scope === 'type') return within(past.distanceM, today.distanceM, 0.30);
  return past.distanceM >= 0.6 * today.distanceM;
}

/** Moving pace (s/km) over the samples whose HR sits in [130, 140]; pauses (≥5 s gaps) skipped. */
export function paceAtHrOf(series: { t?: number[]; d?: number[]; hr?: number[] } | null | undefined): number | null {
  const { t, d, hr } = series || {};
  if (!t || !d || !hr || t.length < 2 || d.length !== t.length || hr.length !== t.length) return null;
  let sec = 0; let m = 0;
  for (let i = 1; i < t.length; i++) {
    const h = hr[i]; const dt = t[i] - t[i - 1]; const dd = d[i] - d[i - 1];
    if (h == null || h < HR_LO || h > HR_HI || dt <= 0 || dt >= 5 || dd <= 0) continue;
    sec += dt; m += dd;
  }
  return m >= 500 ? Math.round(sec / (m / 1000)) : null;
}
