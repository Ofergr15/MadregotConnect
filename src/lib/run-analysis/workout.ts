/**
 * The workout a run actually was, read off the watch (mockup ~/.cache/madregot/run-page-v4.html,
 * Ofer 2026-10-20). Pure, so it can be tested.
 *
 * The laps are Garmin's, each stamped with the workout step it belongs to (`wktStepIndex`).
 * A watch with Auto Lap on cuts a 1600 m step into 1000 + 600, one without leaves it whole —
 * so laps are MERGED by step before anything is counted: a rep is a step, never a lap.
 * The target is the step's note in the club's notation, "3:30 (3:40) ((3:50))", read for the
 * runner's pack (lib/activities/rep-target packPaces).
 */
import { packPaces } from '@/lib/activities/rep-target';

export interface WLap {
  distance: number; duration: number;
  averageHR?: number | null; maxHR?: number | null;
  intensityType?: string | null; wktStepIndex?: number | null;
  gradeAdjustedPace?: number | null;
}
export interface WStep { stepIndex?: number; intensity?: string | null; durationType?: string | null; distanceM?: number | null; durationSec?: number | null; notes?: string | null; iterations?: number | null; repeatFrom?: number | null }

export type SegKind = 'warmup' | 'stride' | 'rep' | 'recovery' | 'cooldown' | 'run';
export interface Seg {
  kind: SegKind;
  step: number | null;
  /** Seconds from the start, and how long. */
  start: number; seconds: number;
  meters: number;
  /** sec/km */
  pace: number | null;
  hr: number | null; maxHr: number | null;
  /** Grade-adjusted pace, sec/km, time-weighted over the merged laps. */
  gap: number | null;
  /** The pack's target, sec/km, when the step names one. */
  target: number | null;
  onTarget: boolean | null;
}
export interface Workout {
  title: string;
  /** "400 ג׳וג" — what the recoveries were, when they were a distance. */
  recoveryMeters: number | null;
  segments: Seg[];
  reps: Seg[];
  strides: Seg[];
  hit: number;
  avgPace: number;
  avgTarget: number | null;
  avgHr: number | null;
  /** ±3 s/km counts as on target. */
  tolerance: number;
}

export const TOLERANCE = 3;
/** How far short of its planned length or time an iteration may close and still count as one. */
const ITERATION_SLACK = 0.03;

const weighted = (parts: Array<[number | null | undefined, number]>) => {
  const ok = parts.filter(([v, w]) => v != null && v > 0 && w > 0) as Array<[number, number]>;
  const w = ok.reduce((s, [, x]) => s + x, 0);
  return w ? Math.round(ok.reduce((s, [v, x]) => s + v * x, 0) / w) : null;
};

/**
 * The run the watch filed under an OPEN step (Ofer, 10-23): a "הליכה" that waits for the
 * Lap button, the button never pressed, and the whole main part — 28.7 km of 14 + 7 + 7 —
 * logged as "recovery" in Auto Lap kilometres; the press then skipped the planned steps in
 * seconds (10 m, 4 m, 9 m). Spotted as running-pace laps under an open recovery step,
 * followed by near-empty laps of later steps. Those laps are handed to the steps that were
 * skipped, in order, by each step's planned length — so the session reads as it was run.
 */
export function repairStuckOpenStep(laps: WLap[], steps: Map<number, WStep>): WLap[] {
  const RUNNING = 7 * 60; // faster than 7:00/km is running, not a walk
  const isOpenRest = (st?: WStep) => !!st && (st.durationType || '').toUpperCase() === 'OPEN'
    && /RECOVERY|REST/.test((st.intensity || '').toUpperCase());
  const out = laps.slice();
  for (let i = 0; i < out.length; i++) {
    const idx = out[i].wktStepIndex;
    const st = idx != null ? steps.get(idx) : undefined;
    if (!isOpenRest(st)) continue;
    // The run of laps still on this open step, from the first that is running.
    let j = i; while (j < out.length && out[j].wktStepIndex === idx) j++;
    const runFrom = out.slice(i, j).findIndex((l) => l.distance >= 300 && l.duration / (l.distance / 1000) < RUNNING);
    if (runFrom < 0) { i = j - 1; continue; }
    let running = out.slice(i + runFrom, j);
    // What was really run, not only the plan: a first kilometre far slower than the rest is
    // the walk ending into the block (10-23: 5:37, then 4:03–4:10) — it stays a recovery.
    const paceOf = (l: WLap) => l.duration / (l.distance / 1000);
    const med = running.map(paceOf).sort((x, y) => x - y)[Math.floor(running.length / 2)];
    let lead = 0;
    while (lead < running.length - 1 && paceOf(running[lead]) > med * 1.2) lead++;
    if (lead) { running = running.slice(lead); }
    const startAt = i + runFrom + lead;
    const runM = running.reduce((a, l) => a + l.distance, 0);
    if (runM < 2000) { i = j - 1; continue; }
    // The skipped steps: the planned distance / time steps after this one whose laps are near-empty.
    const skipped: number[] = [];
    let k = j;
    while (k < out.length && out[k].distance < 150 && out[k].duration < 30 && out[k].wktStepIndex != null) { skipped.push(out[k].wktStepIndex!); k++; }
    const plan = [...new Set(skipped)].map((n) => steps.get(n)).filter((x): x is WStep => !!x && !!(x.distanceM || x.durationSec));
    if (!plan.length) { i = j - 1; continue; }
    // Hand the running laps to the skipped steps, each until its planned length is covered.
    // The slow lead-in still covered the block's first kilometre, so it counts toward its length.
    let p = 0, done = out.slice(i + runFrom, startAt).reduce((x, l) => x + l.distance, 0);
    const handed = running.map((l) => {
      const step = plan[Math.min(p, plan.length - 1)];
      const lap = { ...l, wktStepIndex: step.stepIndex ?? null, intensityType: step.intensity || 'ACTIVE' };
      done += step.distanceM ? l.distance : l.duration;
      const goal = step.distanceM || step.durationSec || 0;
      if (p < plan.length - 1 && done >= goal * (1 - ITERATION_SLACK)) { p++; done = 0; }
      return lap;
    });
    out.splice(startAt, j - startAt, ...handed);
    // The seconds-long laps the late press made are not part of the session.
    const tail = startAt + handed.length;
    out.splice(tail, skipped.length);
    i = tail - 1;
  }
  return out;
}

/** The workout's laps merged into its steps, or null when the watch did not run a workout. */
export function readWorkout(laps: WLap[] | null | undefined, executed: { steps?: WStep[] } | null | undefined, packIndex: number): Workout | null {
  const stepMap = new Map<number, WStep>();
  for (const s of executed?.steps || []) if (s.stepIndex != null) stepMap.set(s.stepIndex, s);
  const ls = repairStuckOpenStep((laps || []).filter((l) => l && l.distance >= 0 && l.duration > 0), stepMap);
  if (ls.length < 3 || !ls.some((l) => l.wktStepIndex != null)) return null;
  const steps = new Map<number, WStep>();
  for (const s of executed?.steps || []) if (s.stepIndex != null) steps.set(s.stepIndex, s);

  const segs: Seg[] = [];
  let at = 0;
  let open: { step: number | null; laps: WLap[]; start: number } | null = null;
  const close = () => {
    if (!open) return;
    const m = open.laps.reduce((s, l) => s + l.distance, 0);
    const t = open.laps.reduce((s, l) => s + l.duration, 0);
    const it = (open.laps[0].intensityType || '').toUpperCase();
    const st = open.step != null ? steps.get(open.step) : undefined;
    const note = st?.notes || '';
    const paces = note ? packPaces(note) : [];
    const target = paces[packIndex] ?? paces.find((p) => p != null) ?? null;
    const pace = m > 0 ? t / (m / 1000) : null;
    let kind: SegKind = it === 'WARMUP' ? 'warmup' : it === 'COOLDOWN' ? 'cooldown' : it === 'RECOVERY' || it === 'REST' ? 'recovery' : 'run';
    if (kind === 'run' && (it === 'ACTIVE' || it === 'INTERVAL')) {
      kind = st?.distanceM && st.distanceM >= 300 ? 'rep' : (st?.durationSec && st.durationSec <= 90) || m < 300 ? 'stride' : 'rep';
    }
    segs.push({
      kind, step: open.step, start: open.start, seconds: Math.round(t), meters: Math.round(m), pace: pace ? Math.round(pace) : null,
      hr: weighted(open.laps.map((l) => [l.averageHR, l.duration])),
      maxHr: open.laps.reduce((x, l) => Math.max(x, l.maxHR ?? 0), 0) || null,
      gap: weighted(open.laps.map((l) => [l.gradeAdjustedPace, l.duration])),
      target: kind === 'rep' || kind === 'stride' ? target : null,
      onTarget: target != null && pace != null && (kind === 'rep' || kind === 'stride') ? Math.abs(pace - target) <= TOLERANCE : null,
    });
    open = null;
  };
  for (const l of ls) {
    const step = l.wktStepIndex ?? null;
    const st = step != null ? steps.get(step) : undefined;
    // Auto Lap cuts a step with a length OR a time into 1 km laps ("45 דק׳ קל" came out as
    // "8 × 1000", 2026-10-20): its laps are one pass until that length or time is covered,
    // and the next lap with the same index is the next iteration of a repeat. An open step
    // has no length to close it, and its iterations are always parted by another step — so
    // its laps back to back are one run cut by Auto Lap ("יום רביעי", 13 × 1000), too.
    const sameStep = !!open && open.step === step && (l.intensityType || '') === (open.laps[0].intensityType || '');
    const doneM = open ? open.laps.reduce((x, y) => x + y.distance, 0) : 0;
    const doneSec = open ? open.laps.reduce((x, y) => x + y.duration, 0) : 0;
    const unfinished = st?.distanceM ? doneM < st.distanceM * (1 - ITERATION_SLACK)
      : st?.durationSec ? doneSec < st.durationSec * (1 - ITERATION_SLACK) : true;
    if (!(sameStep && unfinished)) { close(); open = { step, laps: [], start: at }; }
    open!.laps.push(l);
    at += l.duration;
  }
  close();

  // The reps are the distance reps of the length that repeats most (10 × 1600, not the 2 km out).
  const cand = segs.filter((s) => s.kind === 'rep');
  const byLen = new Map<number, Seg[]>();
  for (const s of cand) { const k = Math.round(s.meters / 100) * 100; byLen.set(k, [...(byLen.get(k) || []), s]); }
  const [len, full] = [...byLen].sort((a, b) => b[1].length - a[1].length || b[0] - a[0])[0] ?? [0, []];
  if (full.length < 2) return null;
  // A last rep the watch was stopped inside (2026-10-20: 10 × 1600 ending at 1,143 m) is
  // still a rep of the session — named and scored with the rest, as the share card does.
  const last = cand[cand.length - 1];
  const reps = last && !full.includes(last) && last === segs[segs.length - 1] && last.meters >= len * 0.6 && last.meters < len ? [...full, last] : full;
  for (const s of cand) if (!reps.includes(s)) s.kind = 'run';
  const recs = segs.filter((s, i) => s.kind === 'recovery' && segs[i - 1]?.kind === 'rep');
  const recLen = recs.length >= 2 ? Math.round(recs.map((r) => r.meters).sort((a, b) => a - b)[recs.length >> 1] / 50) * 50 : null;
  const targets = reps.map((r) => r.target).filter((v): v is number => v != null);
  return {
    // The share card's spelling (lib/share/plan-segments workoutHeadline): 7 × 5K, 10 × 1600.
    title: `${reps.length} × ${len >= 3000 && len % 1000 === 0 ? `${len / 1000}K` : len}`,
    recoveryMeters: recLen && recLen >= 100 ? recLen : null,
    segments: segs, reps, strides: segs.filter((s) => s.kind === 'stride'),
    hit: reps.filter((r) => r.onTarget).length,
    avgPace: Math.round(reps.reduce((s, r) => s + r.seconds, 0) / (reps.reduce((s, r) => s + r.meters, 0) / 1000)),
    avgTarget: targets.length ? Math.round(targets.reduce((s, v) => s + v, 0) / targets.length) : null,
    avgHr: weighted(reps.map((r) => [r.hr, r.seconds])),
    tolerance: TOLERANCE,
  };
}

// ── from the 1 Hz trace ───────────────────────────────────────────────────────────

export interface Trace { t: number[]; d: number[]; hr?: number[]; cad?: number[] }

/** The fastest stretch of `meters` anywhere in the run (two-pointer over the trace). */
export function bestEffort(tr: Trace, meters: number): { seconds: number; start: number } | null {
  const { t, d } = tr; let j = 0; let best: { seconds: number; start: number } | null = null;
  for (let i = 0; i < d.length; i++) {
    while (j < d.length && d[j] - d[i] < meters) j++;
    if (j >= d.length) break;
    const s = t[j] - t[i];
    if (s > 0 && (!best || s < best.seconds)) best = { seconds: s, start: t[i] };
  }
  return best;
}

/** Per rep: heart rate at the end of it and the lowest in the recovery after it. */
export function recoveries(tr: Trace, w: Workout): Array<{ rep: number; from: number; to: number }> {
  if (!tr.hr) return [];
  const out: Array<{ rep: number; from: number; to: number }> = [];
  const segs = w.segments;
  w.reps.forEach((r, k) => {
    const next = segs[segs.indexOf(r) + 1];
    if (!next || next.kind !== 'recovery') return;
    const end = r.start + r.seconds;
    let from = 0; let to = Infinity;
    for (let i = 0; i < tr.t.length; i++) {
      const tt = tr.t[i]; const h = tr.hr![i];
      if (!h) continue;
      if (tt >= end - 30 && tt <= end) from = Math.max(from, h);
      if (tt > end && tt <= next.start + next.seconds) to = Math.min(to, h);
    }
    if (from && to < Infinity) out.push({ rep: k + 1, from, to });
  });
  return out;
}

/** Per rep: median cadence and the stride it implies (metres). */
export function technique(tr: Trace, w: Workout): Array<{ rep: number; cadence: number; stride: number }> {
  if (!tr.cad) return [];
  return w.reps.map((r, k) => {
    const c = tr.t.map((tt, i) => (tt >= r.start && tt <= r.start + r.seconds ? tr.cad![i] : 0)).filter((v) => v > 100).sort((a, b) => a - b);
    const cad = c.length ? c[c.length >> 1] : 0;
    return { rep: k + 1, cadence: cad, stride: cad ? Math.round(((r.meters / r.seconds) * 60 / cad) * 100) / 100 : 0 };
  }).filter((x) => x.cadence > 0);
}

// ── conditions ─────────────────────────────────────────────────────────────────────

/**
 * What the heat and humidity cost, in sec/km, by the runners' rule of thumb on temperature +
 * dew point in °F (the "Hadley" table, the one most heat calculators use).
 */
export function heatCostPct(tempC: number, dewC: number): number {
  const sum = (tempC * 9 / 5 + 32) + (dewC * 9 / 5 + 32);
  const table: Array<[number, number]> = [[100, 0], [110, 0.5], [120, 1], [130, 2], [140, 3], [150, 4.5], [160, 6], [170, 8], [180, 10]];
  if (sum <= 100) return 0;
  for (let i = 1; i < table.length; i++) {
    const [s1, p1] = table[i - 1]; const [s2, p2] = table[i];
    if (sum <= s2) return Math.round((p1 + ((sum - s1) / (s2 - s1)) * (p2 - p1)) * 10) / 10;
  }
  return 12;
}
export const heatCostSec = (tempC: number, dewC: number, pace: number) => Math.round((heatCostPct(tempC, dewC) / 100) * pace);

/**
 * What the run was, as a searchable line ("10 × 1600"), or null for a run that was not
 * a workout with repeats. Stored at sync (athlete_activities.workout_title, migration 165)
 * so search finds a run by its workout, not by the name the watch gave it ("שלישי").
 * The pack only moves the targets, never the title, so any pack index reads the same.
 */
export function workoutTitleOf(laps: WLap[] | null | undefined, executed: { steps?: WStep[] } | null | undefined): string | null {
  try { return readWorkout(laps, executed, 0)?.title ?? null; } catch { return null; }
}
