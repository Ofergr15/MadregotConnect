/**
 * "Did they do the strength session" — yes/no plus duration, no accuracy score (plan.md, b22).
 * Rule: a strength activity on the planned day OR the day after counts. One activity answers
 * one planned day at most (two planned sessions on Sun and Mon can't both be closed by a
 * single Monday workout).
 */
export interface StrengthDay { date: string; durationSec: number; activityId: string }
export interface StrengthVerdict { plannedDate: string; done: boolean; durationSec: number | null; activityId: string | null }

/** Calendar days between two YYYY-MM-DD keys (b − a). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
}

export function strengthVerdicts(plannedDates: string[], sessions: StrengthDay[]): StrengthVerdict[] {
  const used = new Set<string>();
  return [...plannedDates].sort().map(p => {
    const hit = sessions
      .filter(s => !used.has(s.activityId) && (dayDiff(p, s.date) === 0 || dayDiff(p, s.date) === 1))
      .sort((a, b) => dayDiff(p, a.date) - dayDiff(p, b.date) || b.durationSec - a.durationSec)[0];
    if (!hit) return { plannedDate: p, done: false, durationSec: null, activityId: null };
    used.add(hit.activityId);
    return { plannedDate: p, done: true, durationSec: hit.durationSec, activityId: hit.activityId };
  });
}
