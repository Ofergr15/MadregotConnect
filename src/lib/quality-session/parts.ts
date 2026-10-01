// The parts of a quality workout, read from the watch laps: warm-up, each set of
// reps (4 × 45″, 5 × 300 m), the fartlek's fast kilometres with their floats, the
// running between, cool-down. Pure, and the screen's only reading of the laps:
// a lap is never "a rep" just for being fast. Design:
// ~/.cache/madregot/mockups/quality-session-v2.html.
//
// Units: meters, seconds, seconds per km.

import type { Pack } from '@/lib/pack-stories/model';
import type { QsLap } from './model';

export interface PLap { m: number; s: number; i: number; p: number }
/** R rest, F fast km, f float km, S a short rep, ? running. */
export type Role = 'R' | 'F' | 'f' | 'S' | '?';

export type PartKind = 'warm' | 'set' | 'run' | 'cool';
export interface Part {
  kind: PartKind;
  /** Sets only: by time (45″), by distance (300 m), or the fast/float kilometres. */
  unit?: 'time' | 'dist' | 'fart';
  /** Sets: the reps (the fast kms of a fartlek). */
  reps: PLap[];
  /** Fartlek: the float kms. */
  floats: PLap[];
  /** Everything else: the running laps. */
  laps: PLap[];
  /** Walking or standing seconds inside the part. */
  rest: number;
  from: number;
  to: number;
  /** Over the reps for a set, the laps otherwise. */
  m: number;
  s: number;
  p: number;
}

export interface Parsed { laps: PLap[]; role: Role[]; parts: Part[] }

/** Walking pace: slower than 7:30 per km. */
const WALK = 450;
/** Pace spread inside a run of kilometres that makes it a fartlek. */
const FART_SPREAD = 40;
/** A cut-short float between two fartlek halves, at most this long. */
const FART_GAP = 3000;
/** A "warm-up" or "cool-down" longer than this is just a run. */
const EDGE_MAX = 6000;

const near = (a: number, b: number, f = 0.1, min = 3) => Math.abs(a - b) <= Math.max(min, f * b);
const sum = (ls: PLap[], k: 'm' | 's') => ls.reduce((a, l) => a + l[k], 0);

export function parseParts(raw: QsLap[]): Parsed {
  const L: PLap[] = raw.map(([m, s], i) => ({ m, s, i, p: m > 0 ? (s / m) * 1000 : 9999 }));
  const role: Role[] = L.map(l => (raw[l.i][2] === 'rest' || l.p > WALK || (l.m < 60 && l.s < 40) ? 'R' : '?'));

  // Fartlek: a stretch of ~1 km laps whose paces split in two around the middle of their range.
  for (let i = 0; i < L.length;) {
    if (role[i] !== '?' || !near(L[i].m, 1000, 0.04)) { i++; continue; }
    let j = i;
    while (j < L.length && role[j] === '?' && near(L[j].m, 1000, 0.04)) j++;
    const seg = L.slice(i, j);
    const ps = seg.map(x => x.p), lo = Math.min(...ps), hi = Math.max(...ps), thr = (lo + hi) / 2;
    const fast = seg.filter(x => x.p < thr);
    if (fast.length >= 3 && hi - lo >= FART_SPREAD) {
      const f0 = fast[0].i, f1 = fast[fast.length - 1].i;
      for (const x of seg) if (x.i >= f0 && x.i <= f1) role[x.i] = x.p < thr ? 'F' : 'f';
    }
    i = j;
  }
  // Short reps: up to ~2 minutes, or a round hundred metres, next to a rest.
  L.forEach((l, i) => {
    if (role[i] !== '?') return;
    const byRest = role[i - 1] === 'R' || role[i + 1] === 'R';
    const shortT = l.s <= 125;
    const roundM = l.m >= 150 && l.m <= 1200 && near(l.m, Math.round(l.m / 100) * 100, 0.04, 0) && l.m % 1000 > 50;
    if ((shortT || roundM) && byRest) role[i] = 'S';
  });
  // Reps run back to back (4 × 45″ with no walk between): as long as a rep beside them.
  for (let pass = 0; pass < 3; pass++) {
    L.forEach((l, i) => {
      if (role[i] !== '?' || l.s > 125) return;
      if ((role[i - 1] === 'S' && near(l.s, L[i - 1].s)) || (role[i + 1] === 'S' && near(l.s, L[i + 1].s))) role[i] = 'S';
    });
  }

  const blank = (kind: PartKind, i: number): Part => ({ kind, reps: [], floats: [], laps: [], rest: 0, from: i, to: i, m: 0, s: 0, p: 0 });
  const parts: Part[] = [];
  L.forEach((l, i) => {
    const r = role[i], last = parts[parts.length - 1];
    if (r === 'R') { if (last) { last.rest += l.s; last.to = i; } return; }
    if (r === 'S') {
      if (last && last.kind === 'set' && last.unit !== 'fart'
        && (last.unit === 'time' ? near(l.s, last.reps[0].s) : near(l.m, last.reps[0].m, 0.06))) {
        last.reps.push(l); last.to = i; return;
      }
      const p = blank('set', i);
      p.unit = near(l.m, Math.round(l.m / 100) * 100, 0.05, 0) && l.s > 50 ? 'dist' : 'time';
      p.reps.push(l); parts.push(p); return;
    }
    if (r === 'F' || r === 'f') {
      const into = last && last.kind === 'set' && last.unit === 'fart' ? last : (() => { const p = blank('set', i); p.unit = 'fart'; parts.push(p); return p; })();
      (r === 'F' ? into.reps : into.floats).push(l); into.to = i; return;
    }
    if (last && last.kind === 'run') { last.laps.push(l); last.to = i; return; }
    const p = blank('run', i); p.laps.push(l); parts.push(p);
  });

  // A set of one is just running.
  const out: Part[] = [];
  for (const p of parts) {
    if (p.kind === 'set' && p.reps.length < 2) {
      p.kind = 'run'; p.laps = [...p.reps, ...p.floats].sort((a, b) => a.i - b.i); p.reps = []; p.floats = [];
      for (const l of p.laps) if (role[l.i] !== 'R') role[l.i] = '?';
    }
    const last = out[out.length - 1];
    if (p.kind === 'run' && last && last.kind === 'run') { last.laps.push(...p.laps); last.rest += p.rest; last.to = p.to; continue; }
    out.push(p);
  }
  // A fartlek broken by a cut-short float is one fartlek: the running between is its floats.
  for (let k = 0; k + 2 < out.length; k++) {
    const [x, y, z] = [out[k], out[k + 1], out[k + 2]];
    if (x.unit !== 'fart' || y.kind !== 'run' || z.unit !== 'fart' || sum(y.laps, 'm') > FART_GAP) continue;
    for (const l of y.laps) role[l.i] = 'f';
    x.reps.push(...z.reps); x.floats.push(...y.laps, ...z.floats);
    x.rest += y.rest + z.rest; x.to = z.to;
    out.splice(k + 1, 2); k--;
  }
  const firstSet = out.findIndex(p => p.kind === 'set');
  const lastSet = out.length - 1 - [...out].reverse().findIndex(p => p.kind === 'set');
  out.forEach((p, k) => {
    if (p.kind !== 'run' || firstSet < 0) return;
    if (sum(p.laps, 'm') > EDGE_MAX) return;
    if (k < firstSet) p.kind = 'warm';
    else if (k > lastSet) p.kind = 'cool';
  });
  for (const p of out) {
    const ls = p.kind === 'set' ? p.reps : p.laps;
    p.m = sum(ls, 'm'); p.s = sum(ls, 's'); p.p = p.m > 0 ? (p.s / p.m) * 1000 : 0;
  }
  return { laps: L, role, parts: out };
}

/** The set the morning was about: the one with the most seconds of work. */
export function mainSet(parts: Part[]): Part | null {
  return parts.filter(p => p.kind === 'set').reduce<Part | null>((a, p) => (!a || p.s > a.s ? p : a), null);
}

export const paceOver = (ls: PLap[]) => {
  const m = sum(ls, 'm');
  return m > 0 ? (sum(ls, 's') / m) * 1000 : null;
};

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];

/** "4 × 45″", "5 × 300 מ׳", "10 × 1 ק״מ"; a non-set is its name and distance. */
export function partLabel(p: Part): string {
  if (p.kind !== 'set') return `${PART_NAME[p.kind]} ${(p.m / 1000).toFixed(1)} ק״מ`;
  return `${p.reps.length} × ${repUnit(p)}`;
}
/** One rep of the set: 45″, 2′, 300 מ׳, 1 ק״מ. */
export function repUnit(p: Part): string {
  if (p.unit === 'fart') return '1 ק״מ';
  if (p.unit === 'dist') {
    const m = Math.round(median(p.reps.map(r => r.m)) / 100) * 100;
    return m >= 1000 ? `${m / 1000} ק״מ` : `${m} מ׳`;
  }
  const s = median(p.reps.map(r => r.s));
  return s < 60 ? `${Math.round(s / 5) * 5}″` : `${(Math.round(s / 15) * 15) / 60}′`;
}
export const PART_NAME: Record<PartKind, string> = { warm: 'חימום', cool: 'שחרור', run: 'ריצה', set: '' };

// ── the plan's targets ────────────────────────────────────────────────────────

/** One work step of a pack's plan, repeats spelled out. `float`: the recovery after it in a repeat, when it has a pace. */
export interface PlanRep { unit: 'time' | 'distance'; value: number; pace: number | null; float: number | null }
export type PlanTargets = Partial<Record<Pack, PlanRep[]>>;

export interface SetTarget {
  /** Per rep, in order, when the plan has them (4 × 45″ descending), else one for all. */
  paces: number[];
  float: number | null;
  planned: number;
}

/** What the plan asked of this set, or null when nothing in it matches. */
export function targetFor(p: Part, plan: PlanRep[] | undefined): SetTarget | null {
  if (!plan || p.kind !== 'set' || !p.reps.length) return null;
  const m = median(p.reps.map(r => r.m)), s = median(p.reps.map(r => r.s));
  const like = plan.filter(x => (p.unit === 'time'
    ? x.unit === 'time' && near(x.value, s, 0.1, 4)
    : x.unit === 'distance' && near(x.value, p.unit === 'fart' ? 1000 : m, 0.06, 0)));
  if (!like.length) return null;
  const paced = like.filter(x => x.pace != null).map(x => x.pace as number);
  const float = like.find(x => x.float != null)?.float ?? null;
  return { paces: paced, float, planned: like.length };
}
