// The reps' target pace for THIS runner, from the workout that was on their watch
// (athlete_activities.executed_workout, the Garmin steps): the repeated distance step's note
// in the club's notation "3:15 (3:25) ((3:35))" — pack 1 plain, pack 2 in (), pack 3 in (()).
// The run page draws the reps against it (mockup run-page-b, "15 החזרות מול היעד").

export interface RepTarget {
  /** sec/km for the runner's own pack. */
  pace: number;
  /** The packs' range, fastest to slowest. */
  min: number;
  max: number;
  /** The rep length, metres. */
  meters: number;
  reps: number;
}

const sec = (t: string) => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };

/** "3:15 (3:25) ((3:35))" → [195, 205, 215]; a range "3:15-3:20" takes its middle. */
export function packPaces(note: string): Array<number | null> {
  const one = (s: string | undefined) => {
    if (!s) return null;
    const r = s.match(/(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?/);
    if (!r) return null;
    return r[2] ? Math.round((sec(r[1]) + sec(r[2])) / 2) : sec(r[1]);
  };
  const p3 = note.match(/\(\(\s*([^()]+?)\s*\)\)/)?.[1];
  const rest = note.replace(/\(\([^()]*\)\)/g, ' ');
  const p2 = rest.match(/\(\s*([^()]+?)\s*\)/)?.[1];
  const p1 = rest.replace(/\([^()]*\)/g, ' ').trim();
  return [one(p1), one(p2), one(p3)];
}

/** Each pack's target as a RANGE, sec/km: "3:50–3:55" → [230, 235], "4:00" → [240, 240]. */
export function packRanges(note: string): Array<[number, number] | null> {
  const one = (s: string | undefined): [number, number] | null => {
    if (!s) return null;
    const r = s.match(/(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?/);
    if (!r) return null;
    const a = sec(r[1]); const b = r[2] ? sec(r[2]) : a;
    return [Math.min(a, b), Math.max(a, b)];
  };
  const p3 = note.match(/\(\(\s*([^()]+?)\s*\)\)/)?.[1];
  const rest = note.replace(/\(\([^()]*\)\)/g, ' ');
  const p2 = rest.match(/\(\s*([^()]+?)\s*\)/)?.[1];
  const p1 = rest.replace(/\([^()]*\)/g, ' ').trim();
  return [one(p1), one(p2), one(p3)];
}

interface Step { stepIndex?: number; notes?: string | null; distanceM?: number | null; durationType?: string | null; iterations?: number | null; repeatFrom?: number | null }

export function repTarget(executed: unknown, packIndex: number): RepTarget | null {
  const steps = ((executed as { steps?: Step[] } | null)?.steps || []) as Step[];
  for (const rep of steps.filter((s) => (s.iterations ?? 0) > 1 && s.repeatFrom != null)) {
    const work = steps.find((s) => s.stepIndex != null && s.stepIndex >= (rep.repeatFrom as number) && s.distanceM && s.notes && packPaces(s.notes).some(Boolean));
    if (!work) continue;
    const all = packPaces(work.notes as string);
    const known = all.filter((p): p is number => p != null);
    const mine = all[packIndex] ?? all.find((p) => p != null)!;
    return { pace: mine, min: Math.min(...known), max: Math.max(...known), meters: work.distanceM as number, reps: rep.iterations as number };
  }
  return null;
}
