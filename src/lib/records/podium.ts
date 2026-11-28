// Club records podium (task 90): the top three per distance, with tie rules and a sanity gate on
// hand-entered times. Pure; GET /api/club/records/podium feeds it the same filtered table the
// records tab shows, so the podium can never disagree with the table under it.
//
// Tie rules:
//   - Equal times share a place (competition ranking: 1, 1, 3 — never 1, 1, 2).
//   - Inside a tie, whoever ran it FIRST is listed first (earlier date), then by name; a stated
//     time with no date goes after dated ones. Order only — the place is shared.
//   - Everyone tied for 3rd is on the podium, so it may hold more than three names.
// Manual entries: a stated time that fails the per-distance plausibility bounds
// (prSecondsProblem — the same check the entry form runs) is left off the podium and counted in
// `excluded`, so a typo ("4:12" for a 10K) can't take first place.

import { prSecondsProblem } from '@/lib/prs/overrides';

export interface PodiumInput {
  athleteId: string;
  name: string;
  seconds: number;
  date: string | null;
  source?: 'auto' | 'manual';
}

export interface PodiumRow<T extends PodiumInput = PodiumInput> {
  place: 1 | 2 | 3;
  tied: boolean;
  entry: T;
}

export const PODIUM_PLACES = 3;

export function podium<T extends PodiumInput>(bucketKey: string, entries: T[]): { rows: PodiumRow<T>[]; excluded: number } {
  let excluded = 0;
  const valid = entries.filter((e) => {
    if (!Number.isFinite(e.seconds) || e.seconds <= 0) { excluded++; return false; }
    if (e.source === 'manual' && prSecondsProblem(bucketKey, e.seconds)) { excluded++; return false; }
    return true;
  });
  const sorted = [...valid].sort((a, b) =>
    a.seconds - b.seconds
    || (a.date ?? '9999').localeCompare(b.date ?? '9999')
    || a.name.localeCompare(b.name, 'he')
    || a.athleteId.localeCompare(b.athleteId));
  const count = new Map<number, number>();
  for (const e of sorted) count.set(e.seconds, (count.get(e.seconds) ?? 0) + 1);
  const rows: PodiumRow<T>[] = [];
  let place = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].seconds !== sorted[i - 1].seconds) place = i + 1;
    if (place > PODIUM_PLACES) break;
    rows.push({ place: place as 1 | 2 | 3, tied: (count.get(sorted[i].seconds) ?? 0) > 1, entry: sorted[i] });
  }
  return { rows, excluded };
}
