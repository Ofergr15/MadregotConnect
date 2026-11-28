/** The public home page's stats band (/api/public/stats). */
export interface PublicStats {
  since?: string;
  athletes: number;
  totalKm: number;
  workouts: number;
  totalHours: number;
  topResults: { name: string; timeSeconds: number; test: string }[];
  testDate?: string | null;
}

/**
 * /api/public/stats as the page can use it, or null. A partial/empty body ({}) used to be
 * stored as-is and `stats.topResults.length` threw, so the public home page showed the
 * crash screen. Missing numbers are 0 and a missing list is [], which hides the band.
 */
export function normalizePublicStats(d: unknown): PublicStats | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const r = d as Partial<PublicStats>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    since: typeof r.since === 'string' ? r.since : undefined,
    athletes: num(r.athletes),
    totalKm: num(r.totalKm),
    workouts: num(r.workouts),
    totalHours: num(r.totalHours),
    topResults: Array.isArray(r.topResults)
      ? r.topResults.filter((x) => x && typeof x.name === 'string' && typeof x.timeSeconds === 'number')
      : [],
    testDate: typeof r.testDate === 'string' ? r.testDate : null,
  };
}
