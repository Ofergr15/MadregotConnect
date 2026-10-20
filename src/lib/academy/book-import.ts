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
 *
 * ── The whole history (Ofer, 2026-10-20: "maybe run over all the workouts we put into
 * the app historically?") ─────────────────────────────────────────────────────────────────
 *
 * Two more sources ride the same pipeline: the one-day sessions (`day_sessions`, steps at
 * lane 1's paces like a club week) and the legacy templates (`academy_workouts`). An easy
 * run is merged by its LENGTH alone — `60 דקות קל` written at 5:00 and at 5:10 is one
 * session, not "60 דקות קל (2)" — and the most-used variant is the one kept. `fillRows`
 * turns the whole list into book rows in one go, every one UNCLASSIFIED: the guessed type
 * is a hint, never the label, until a manager chooses it (kind-choice.ts, library.ts).
 */

import type { ParsedWorkout } from '@/lib/ai/types';
import { hasAbsolutePaces, type LibraryEntry, type LibraryKind, type LibraryStep } from './library';
import { laneWorkouts, type Lane } from './group-lane';
import { absoluteToLibrary, centrePct, fromLibrarySteps, guessKind, structureKey, structureName, toneOfPct } from './book-steps';

export interface ImportPlanRow {
  id: string;
  athleteId: string | null;
  weekStart: string;
  parsed: unknown;
  /**
   * The workouts themselves, for a source that is not a week (`day_sessions`, a legacy
   * template) — taken as written at lane 1's paces, like the club's week. Wins over `parsed`.
   */
  workouts?: ParsedWorkout[];
  /** Which store the row came from; a week's origin follows from `athleteId`. */
  origin?: ImportOrigin;
}

export type ImportOrigin = 'club' | 'academy' | 'day' | 'template';

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
  origin: ImportOrigin;
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
  if (Array.isArray(row.workouts)) return row.workouts;
  if (row.athleteId) {
    const flat = (row.parsed as { workouts?: ParsedWorkout[] } | null)?.workouts;
    if (Array.isArray(flat)) return flat;
  }
  return laneWorkouts(row.parsed, 1 as Lane);
}

function hasRealWork(w: ParsedWorkout): boolean {
  return Array.isArray(w?.steps) && w.steps.some(s => s.type !== 'rest' && s.type !== 'recovery');
}

/** The tree that occurs most often in the group (by exact structure), the first on a tie. */
function mostUsedVariant(group: LibraryStep[][]): LibraryStep[] {
  const counts = new Map<string, { n: number; steps: LibraryStep[] }>();
  for (const steps of group) {
    const k = structureKey(steps);
    const c = counts.get(k) ?? { n: 0, steps };
    c.n += 1;
    counts.set(k, c);
  }
  let best: { n: number; steps: LibraryStep[] } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return JSON.parse(JSON.stringify(best!.steps)) as LibraryStep[];
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
  existing: Array<Pick<LibraryEntry, 'id' | 'name' | 'steps'> & { importKey?: string | null }>;
}

/** Every non-rest step, flattened through repeats (count times). */
function workSteps(steps: LibraryStep[], times = 1, out: Array<{ step: LibraryStep; times: number }> = []) {
  for (const s of steps) {
    if (s.repeatSteps?.length) workSteps(s.repeatSteps, times * (s.repeatCount ?? 1), out);
    else if (s.type !== 'rest' && s.type !== 'recovery') out.push({ step: s, times });
  }
  return out;
}

/**
 * An easy run's identity is its length: every step easy (or untargeted), no repeat of real
 * work. Returns `easy:t<sec>` / `easy:d<m>` — the pace it was written at does not make it a
 * different session — or null when the session has any faster work.
 */
export function easyRunKey(steps: LibraryStep[]): string | null {
  const work = workSteps(steps);
  if (!work.length) return null;
  let sec = 0; let m = 0;
  for (const { step, times } of work) {
    const tone = step.intensity ? toneOfPct(centrePct(step.intensity)) : 'e';
    if (tone !== 'e' || step.targetType === 'heart_rate') return null;
    if (!step.durationValue || step.durationType === 'open') continue;
    if (step.durationType === 'distance') m += step.durationValue * times;
    else sec += step.durationValue * times;
  }
  if (sec && m) return null; // a mixed run is a structure, not one length
  if (sec) return `easy:t${Math.round(sec / 300) * 300}`;
  if (m) return `easy:d${Math.round(m / 500) * 500}`;
  return null;
}

/** The key an entry is matched on: an easy run's length, else its structure. */
export function importKeyOf(steps: LibraryStep[]): string {
  return easyRunKey(steps) ?? structureKey(steps);
}

const lenText = (s: LibraryStep): string => {
  if (!s.durationValue || s.durationType === 'open') return '';
  if (s.durationType === 'distance') return s.durationValue >= 1000 ? `${Math.round(s.durationValue / 100) / 10} ק״מ` : `${s.durationValue} מ׳`;
  return s.durationValue >= 60 && s.durationValue % 60 === 0 ? `${s.durationValue / 60} דק׳` : s.durationValue >= 120 ? `${Math.round(s.durationValue / 60)} דק׳` : `${s.durationValue} שנ׳`;
};

/**
 * A name for a session the editor cannot draw (`not-editable`: open laps, untargeted reps):
 * its repeat blocks, else its length — never the weekday it happened to be written on
 * ("יום ראשון (7)" said nothing about the workout). `hint` adds "עליות" when the plan said so.
 */
export function roughName(steps: LibraryStep[], hint = ''): string {
  // Each repeat block with how much work it holds; the short accents (≤ 30 s / ≤ 150 m —
  // the warm-up strides every club session opens with) only when nothing else is there.
  const blocks = steps.filter(s => s.repeatSteps?.length).map(s => {
    const lead = s.repeatSteps!.find(c => c.type !== 'rest' && c.type !== 'recovery');
    const v = lead?.durationValue ?? 0;
    const short = !lead || lead.durationType === 'open' || !v
      || (lead.durationType === 'distance' ? v <= 150 : v <= 30);
    const weight = (s.repeatCount ?? 1) * (lead?.durationType === 'distance' ? v * 0.3 : v);
    const len = lead ? lenText(lead) : '';
    return { text: len ? `${s.repeatCount ?? 1} × ${len}` : `${s.repeatCount ?? 1} חזרות`, short, weight };
  });
  const main = blocks.filter(b => !b.short).sort((a, b) => b.weight - a.weight);
  const parts = (main.length ? main : blocks).slice(0, 2).map(b => b.text);
  const hills = /גבע|עליות|עליה|hill/i.test(hint) ? ' עליות' : '';
  if (parts.length) return `${parts.join(' + ')}${hills}`;
  let sec = 0; let m = 0;
  for (const { step, times } of workSteps(steps)) {
    if (!step.durationValue || step.durationType === 'open') continue;
    if (step.durationType === 'distance') m += step.durationValue * times; else sec += step.durationValue * times;
  }
  if (m >= 1000) return `ריצה ${Math.round(m / 100) / 10} ק״מ${hills}`;
  if (sec) return `ריצה ${Math.round(sec / 60)} דק׳${hills}`;
  return `אימון${hills}`;
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
    const origin: ImportOrigin = row.origin ?? (row.athleteId ? 'academy' : 'club');
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
      const key = importKeyOf(converted.steps);
      const g = groups.get(key) ?? { key, steps: [], reasons: new Set<ImportReason>(), sources: [], hint, saveable: true };
      g.steps.push(converted.steps);
      for (const r of converted.review) g.reasons.add(r as ImportReason);
      if (!fromLibrarySteps(converted.steps)) g.reasons.add('not-editable');
      g.sources.push(source);
      groups.set(key, g);
    }
  }

  // An entry is "already in the book" by its own steps' key OR the key it was imported under:
  // a coach who edited an imported entry has changed its steps, and re-running the fill must
  // not bring the original back beside it.
  const existingByKey = new Map<string, string>();
  for (const e of existing) {
    existingByKey.set(importKeyOf(e.steps), e.id);
    existingByKey.set(structureKey(e.steps), e.id);
    if (e.importKey) existingByKey.set(e.importKey, e.id);
  }
  const takenNames = new Set(existing.map(e => e.name.trim().toLowerCase()));

  const candidates = [...groups.values()].map((g): ImportCandidate => {
    // An easy run merged across paces keeps the variant written most often, whole — a
    // median of differently shaped trees is not a tree.
    const steps = !g.steps.length ? null
      : g.key.startsWith('easy:') ? mostUsedVariant(g.steps)
      : mergeIntensities(g.steps);
    const model = steps ? fromLibrarySteps(steps) : null;
    const name = model ? structureName(model) : steps ? roughName(steps, g.hint) : (g.sources[0]?.title || 'אימון');
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

/**
 * Ticked to begin with in the manager's review: a new, saveable candidate — except the
 * duplicate easy-run variants ("60 דקות קל (2)"): the same easy run under a second name is
 * noise on the shelf (Ofer, 2026-10-20). They stay listed, one tap from ticked.
 */
export function importTickedByDefault(c: Pick<ImportCandidate, 'status' | 'saveable' | 'kind' | 'name'>): boolean {
  if (c.status !== 'new' || !c.saveable) return false;
  return !isDuplicateVariant(c);
}

/** "<name> (2)" — the importer's suffix for a second session under the same name. */
export function isDuplicateVariant(c: Pick<ImportCandidate, 'kind' | 'name'>): boolean {
  return c.kind === 'easy' && /\(\d+\)\s*$/.test(c.name.trim());
}

/** A row the history fill writes: the candidate as is, its type left for a manager to choose. */
export interface FillRow {
  key: string;
  name: string;
  /** The import's guess, stored because the column needs a value; `kindConfirmed: false` says so. */
  kind: LibraryKind;
  kindConfirmed: false;
  steps: LibraryStep[];
  uses: number;
  lastWeek: string;
}

/**
 * Everything the history holds that the book does not: every saveable, not-yet-present
 * candidate, review reasons included (they are notes on the row, not a reason to leave a
 * session out of the book — a manager sees them on the classify screen). Idempotent by
 * construction: a second run rebuilds the list against the book the first run wrote, and
 * every candidate comes back `existing`.
 */
export function fillRows(candidates: ImportCandidate[]): FillRow[] {
  return candidates
    .filter(c => c.saveable && c.status !== 'existing' && c.steps && c.steps.length && !hasAbsolutePaces(c.steps))
    .map(c => ({ key: c.key, name: c.name, kind: c.kind, kindConfirmed: false as const, steps: c.steps!, uses: c.uses, lastWeek: c.lastWeek }));
}

/** The source counts the fill screen shows ("18 שבועות · 2 אימונים ליום אחד"). */
export function sourceCounts(rows: ImportPlanRow[]): Record<ImportOrigin, number> {
  const out: Record<ImportOrigin, number> = { club: 0, academy: 0, day: 0, template: 0 };
  for (const r of rows) out[r.origin ?? (r.athleteId ? 'academy' : 'club')] += 1;
  return out;
}

/** A one-day session (`day_sessions`) as an import row: its steps are lane 1's, like a club week. */
export function daySessionRow(row: { id: string; session_date: string; title?: string | null; steps?: unknown }): ImportPlanRow | null {
  if (!Array.isArray(row.steps) || !row.steps.length || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.session_date))) return null;
  const dayOfWeek = new Date(`${row.session_date}T12:00:00Z`).getUTCDay();
  return {
    id: `day:${row.id}`,
    athleteId: null,
    weekStart: String(row.session_date),
    parsed: null,
    origin: 'day',
    workouts: [{ dayOfWeek, name: String(row.title || ''), steps: row.steps } as ParsedWorkout],
  };
}

/** A legacy template (`academy_workouts.workout`, a ParsedWorkout) as an import row. */
export function templateRow(row: { id: string; name?: string | null; workout?: unknown; created_at?: string | null }): ImportPlanRow | null {
  const w = row.workout as Partial<ParsedWorkout> | null;
  if (!w || !Array.isArray(w.steps) || !w.steps.length) return null;
  return {
    id: `template:${row.id}`,
    athleteId: null,
    weekStart: String(row.created_at || '').slice(0, 10),
    parsed: null,
    origin: 'template',
    workouts: [{ ...(w as ParsedWorkout), dayOfWeek: typeof w.dayOfWeek === 'number' ? w.dayOfWeek : 0, name: String(row.name || w.name || '') }],
  };
}
