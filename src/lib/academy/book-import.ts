/**
 * "כל האימונים שכבר באפליקציה ייובאו לכאן" — every workout the app has ever planned, as a
 * book entry, deduplicated, counted, and reviewed before anything is written.
 *
 * Two sources, both `weekly_plans`:
 *
 *   - the club's weeks (`athlete_id IS NULL`) — lane 1, made relative to lane 1's reference
 *     threshold (senior-pick.ts). One lane and not three: the lanes are the same session at
 *     three squads' paces, so after conversion they are the same entry three times.
 *   - academy trainees' weeks — made relative to THAT trainee's own 30-minute test, which is
 *     the threshold their paces were written from. A trainee with no test has paces nobody
 *     can state as a share of anything; those sessions are listed as needing review and
 *     cannot be saved, rather than converted against a guess.
 *
 * Deduplicated by `structureKey` (the steps' shape and effort tones, not their exact
 * percentages), so `5×1000 @ 4:05` in August and `5×1000 @ 4:00` in September are one entry
 * used twice. The merged entry's intensities are the MEDIAN of its occurrences, which keeps
 * one unusually fast week from defining the session.
 *
 * Pure: plans, thresholds and the existing book in; a review list out. The route writes
 * only the candidates the manager confirmed, re-derived server-side from the same inputs.
 */

import type { ParsedWorkout } from '@/lib/ai/types';
import { hasAbsolutePaces, type LibraryEntry, type LibraryKind, type LibraryStep } from './library';
import { laneWorkouts, type Lane } from './group-lane';
import { absoluteToLibrary, fromLibrarySteps, guessKind, structureKey, structureName } from './book-steps';

export interface ImportPlanRow {
  id: string;
  athleteId: string | null;
  weekStart: string;
  parsed: unknown;
}

export type ImportStatus = 'new' | 'existing' | 'review';

export type ImportReason =
  | 'no-test'            // an academy plan whose trainee has no threshold to state it against
  | 'pace-from-note'     // the only pace was in the step's note
  | 'length-from-note'   // an open step's length was read from its note
  | 'open-length'        // a step with no length at all (lap button)
  | 'not-editable';      // richer than the adjust screen can draw — saved as is

export interface ImportSource {
  planId: string;
  weekStart: string;
  dayOfWeek: number;
  origin: 'club' | 'academy';
  athleteId: string | null;
  /** The source's own title (`שלישי`, `אינטרוולים`). */
  title: string;
}

export interface ImportCandidate {
  key: string;
  name: string;
  kind: LibraryKind;
  /** Null when it could not be converted (`no-test`) — such a row is never saveable. */
  steps: LibraryStep[] | null;
  uses: number;
  lastWeek: string;
  status: ImportStatus;
  reasons: ImportReason[];
  sources: ImportSource[];
  existingId: string | null;
  saveable: boolean;
}

function workoutsOf(row: ImportPlanRow): ParsedWorkout[] {
  if (row.athleteId) {
    const flat = (row.parsed as { workouts?: ParsedWorkout[] } | null)?.workouts;
    if (Array.isArray(flat)) return flat;
  }
  return laneWorkouts(row.parsed, 1 as Lane);
}

function hasRealWork(w: ParsedWorkout): boolean {
  return Array.isArray(w?.steps) && w.steps.some(s => s.type !== 'rest' && s.type !== 'recovery');
}

/** The same tree with each intensity replaced by the median of the group's. */
function mergeIntensities(group: LibraryStep[][]): LibraryStep[] {
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
  };
  const base = JSON.parse(JSON.stringify(group[0])) as LibraryStep[];
  const walk = (steps: LibraryStep[], path: number[]) => {
    steps.forEach((step, i) => {
      const here = [...path, i];
      if (step.intensity) {
        const at = (list: LibraryStep[]) => {
          let nodes: LibraryStep[] | undefined = list;
          let node: LibraryStep | undefined;
          for (const idx of here) { node = nodes?.[idx]; nodes = node?.repeatSteps; }
          return node;
        };
        const fast: number[] = [];
        const slow: number[] = [];
        for (const other of group) {
          const node = at(other);
          if (node?.intensity) { fast.push(node.intensity.fastPct); slow.push(node.intensity.slowPct); }
        }
        if (fast.length) step.intensity = { fastPct: median(fast), slowPct: median(slow) };
      }
      if (step.repeatSteps?.length) walk(step.repeatSteps, here);
    });
  };
  walk(base, []);
  return base;
}

export interface BuildImportInput {
  plans: ImportPlanRow[];
  /** 30-minute-test threshold per academy trainee, sec/km. */
  thresholds: Record<string, number | null>;
  /** Lane 1's reference threshold, from senior-pick's `laneReferences`. */
  clubReferenceSec: number;
  existing: Pick<LibraryEntry, 'id' | 'name' | 'steps'>[];
}

export function buildImport({ plans, thresholds, clubReferenceSec, existing }: BuildImportInput): ImportCandidate[] {
  interface Group {
    key: string;
    steps: LibraryStep[][];
    reasons: Set<ImportReason>;
    sources: ImportSource[];
    hint: string;
    saveable: boolean;
  }
  const groups = new Map<string, Group>();

  for (const row of plans) {
    const origin = row.athleteId ? 'academy' : 'club';
    const reference = row.athleteId ? thresholds[row.athleteId] ?? null : clubReferenceSec;
    for (const w of workoutsOf(row)) {
      if (!hasRealWork(w) || typeof w.dayOfWeek !== 'number') continue;
      const source: ImportSource = {
        planId: row.id, weekStart: row.weekStart, dayOfWeek: w.dayOfWeek, origin,
        athleteId: row.athleteId, title: w.name || '',
      };
      const hint = `${w.name ?? ''} ${w.description ?? ''}`;

      if (!reference) {
        // Grouped per trainee and session title, so the review list shows one row a trainee
        // needs a test for, not one per week.
        const key = `no-test:${row.athleteId}:${w.name}`;
        const g = groups.get(key) ?? { key, steps: [], reasons: new Set<ImportReason>(['no-test']), sources: [], hint, saveable: false };
        g.sources.push(source);
        groups.set(key, g);
        continue;
      }

      const converted = absoluteToLibrary(w.steps, reference);
      if (hasAbsolutePaces(converted.steps)) continue;
      const key = structureKey(converted.steps);
      const g = groups.get(key) ?? { key, steps: [], reasons: new Set<ImportReason>(), sources: [], hint, saveable: true };
      g.steps.push(converted.steps);
      for (const r of converted.review) g.reasons.add(r as ImportReason);
      if (!fromLibrarySteps(converted.steps)) g.reasons.add('not-editable');
      g.sources.push(source);
      groups.set(key, g);
    }
  }

  const existingByKey = new Map(existing.map(e => [structureKey(e.steps), e.id]));
  const takenNames = new Set(existing.map(e => e.name.trim().toLowerCase()));

  const candidates = [...groups.values()].map((g): ImportCandidate => {
    const steps = g.steps.length ? mergeIntensities(g.steps) : null;
    const model = steps ? fromLibrarySteps(steps) : null;
    const name = model ? structureName(model) : (g.sources[0]?.title || 'אימון');
    const existingId = steps ? existingByKey.get(g.key) ?? null : null;
    const reasons = [...g.reasons];
    const status: ImportStatus = existingId ? 'existing' : reasons.length ? 'review' : 'new';
    const lastWeek = g.sources.map(s => s.weekStart).sort().at(-1) ?? '';
    return {
      key: g.key,
      name,
      kind: guessKind(model ?? [], g.hint),
      steps,
      uses: g.sources.length,
      lastWeek,
      status,
      reasons,
      sources: g.sources,
      existingId,
      saveable: g.saveable && !existingId,
    };
  });

  candidates.sort((a, b) => b.uses - a.uses || b.lastWeek.localeCompare(a.lastWeek) || a.name.localeCompare(b.name));

  // Unique names on the shelf: the index is (owner, scope, lower(name)) and two different
  // sessions often share a structure name (`6 × 800 מ׳` at two efforts).
  for (const c of candidates) {
    if (c.status === 'existing') continue;
    let name = c.name;
    for (let n = 2; takenNames.has(name.trim().toLowerCase()); n++) name = `${c.name} (${n})`;
    c.name = name;
    takenNames.add(name.trim().toLowerCase());
  }
  return candidates;
}

/** The counts the review list's header shows. */
export function importSummary(candidates: ImportCandidate[]): Record<ImportStatus, number> {
  const out: Record<ImportStatus, number> = { new: 0, existing: 0, review: 0 };
  for (const c of candidates) out[c.status] += 1;
  return out;
}
