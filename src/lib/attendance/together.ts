import { mutualOverlap, MIN_OVERLAP, START_TOLERANCE_S } from '@/lib/feed/group-runs';

/**
 * Who really came to a team session (Ofer, 2026-10-20): the RSVP said 2–9, the GPS
 * says 11–18. A runner came when their run that morning was run WITH someone — the
 * feed's own "רצו יחד" rule (lib/feed/group-runs.ts): starts within 5 minutes and 80%
 * of each route within 250 m of the other. A pack that splits off is its own group;
 * a runner alone, or without GPS, is not counted (their RSVP still shows).
 */

export interface MorningRun { athleteId: string; startMs: number; route: Array<{ lat: number; lng: number }> }

/** Groups of two or more athletes who ran together; each athlete in one group only. */
export function groupsOf(runs: MorningRun[]): string[][] {
  const rs = runs.filter((r) => r.route.length > 5);
  const parent = rs.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      if (rs[i].athleteId === rs[j].athleteId) continue;
      if (Math.abs(rs[i].startMs - rs[j].startMs) > START_TOLERANCE_S * 1000) continue;
      if (mutualOverlap(rs[i].route, rs[j].route) >= MIN_OVERLAP) parent[find(i)] = find(j);
    }
  }
  const byRoot = new Map<number, Set<string>>();
  rs.forEach((r, i) => { const k = find(i); byRoot.set(k, new Set([...(byRoot.get(k) ?? []), r.athleteId])); });
  // Biggest first; somebody found twice — two runs that morning — counts in the bigger one.
  const seen = new Set<string>();
  return [...byRoot.values()]
    .filter((g) => g.size > 1)
    .sort((a, b) => b.size - a.size)
    .map((g) => [...g].filter((id) => !seen.has(id) && (seen.add(id), true)))
    .filter((g) => g.length > 0);
}

/** The team sessions: Tuesday and Friday mornings (the practice-attendance page's TEAM_DAYS). */
export const TEAM_DAYS = [2, 5];
export const isTeamDay = (iso: string) => TEAM_DAYS.includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
