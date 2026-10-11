// Plan vs PDF — the pure half. Two independent readings of the same file are
// compared number by number, per day and per pace group:
//
//   1. the PDF's own text layer (no AI): every glyph with its position, grouped
//      into rows, split into the three pace-group columns, cut into days at the
//      "יום <day>" headings;
//   2. the AI parse as saved (weekly_plans.parsed_workouts), turned back into
//      the same kind of tokens: distances, durations, paces, repeats.
//
// A day whose numbers all line up is PROVEN; a range the plan turned into one
// value is an APPROXIMATION; anything missing or different DIFFERS; a day the
// file can't be read for is UNCHECKED. Ofer, 2026-10-10: "mistakes here are too
// expensive". Run on the week of 2026-09-06 this found Monday's optional evening
// missing from the plan and Wednesday saved with no duration (the file says
// 70–80 min) — both had gone to the watches. Design:
// ~/.cache/madregot/planner-flow/v3.html. Shadow mode: it reports, it does not
// block publishing yet.

import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

export interface PdfGlyph { page: number; x: number; y: number; w: number; str: string; pageWidth: number }
export type Group = 1 | 2 | 3;
export type Level = 'proven' | 'approx' | 'differs' | 'unchecked';

export interface FileRow { page: number; y: number; col: Group; text: string }

type FileTok = { k: 'rep' | 'num' | 'pace'; n: number; row: FileRow };
type PlanTok = { k: 'rep' | 'dist' | 'time' | 'pace' | 'note'; n: number; label: string; pace?: boolean };

export interface Diff {
  kind: 'missing' | 'extra' | 'changed' | 'approx' | 'inferred' | 'note';
  /** The file's lines involved, as text, with where they are. */
  file: Array<{ page: number; y: number; text: string }>;
  /** What the plan has there, readable ("45 דק׳", "—" for nothing). */
  plan: string;
}

export interface GroupResult { level: Level; matched: number; total: number; diffs: Diff[] }
export interface DayResult {
  dayOfWeek: number;
  level: Level;
  /** Why it is unchecked, when it is. */
  reason?: 'no_text_layer' | 'day_not_found' | 'no_plan';
  pages: number[];
  groups: Record<Group, GroupResult>;
}
export interface VerifyReport { textLayer: boolean; days: DayResult[] }

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
// The page header, and the countdown side column on page 1 ("32 ימים"): never part of a workout.
const NOISE = /MADREGOT|RUNNING|CLUB|2KM|\d+\s*ימים/i;
const HEB = /[֐-׿]/;

/* ----------------------------------------------------------------- rows */

/** Glyphs → rows: same page, same baseline (±2.5pt), read right to left. */
export function buildRows(glyphs: PdfGlyph[]): Array<{ page: number; y: number; pageWidth: number; items: PdfGlyph[] }> {
  const out: Array<{ page: number; y: number; pageWidth: number; items: PdfGlyph[] }> = [];
  const sorted = glyphs.filter((g) => g.str.trim()).sort((a, b) => a.page - b.page || a.y - b.y || b.x - a.x);
  for (const g of sorted) {
    const last = out[out.length - 1];
    if (last && last.page === g.page && Math.abs(last.y - g.y) <= 2.5) last.items.push(g);
    else out.push({ page: g.page, y: g.y, pageWidth: g.pageWidth, items: [g] });
  }
  for (const r of out) r.items.sort((a, b) => b.x - a.x);
  return out;
}

/**
 * Two long lines in neighbouring columns can run into each other (2026-10-11,
 * "הליכה למטה, עמידה 4 דק׳ בין סטים" in ❶ and ❸ with ❷ between): cut a run at a
 * word gap that sits near a column split.
 */
function cutAtSplits(runs: PdfGlyph[][], sp: [number, number]): PdfGlyph[][] {
  const out: PdfGlyph[][] = [];
  for (const run of runs) {
    let cur: PdfGlyph[] = [];
    for (let i = 0; i < run.length; i++) {
      const it = run[i], prev = run[i - 1];
      if (prev) {
        const gapL = it.x + it.w, gapR = prev.x;
        const mid = (gapL + gapR) / 2;
        if (gapR - gapL > 4 && sp.some((x) => Math.abs(mid - x) < 60)) { out.push(cur); cur = []; }
      }
      cur.push(it);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

/** A row's glyphs (right to left) cut where the gap is wider than a column gutter. */
function runsOf(items: PdfGlyph[]): PdfGlyph[][] {
  const runs: PdfGlyph[][] = [];
  for (const it of items) {
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.x - (it.x + it.w) <= 15) last.push(it);
    else runs.push([it]);
  }
  return runs;
}

/**
 * The two x positions that split a page into its three pace-group columns. Read
 * off the table itself: rows that fall into exactly three runs of text, the
 * boundary being the middle of each gap, median over the page. Digits elsewhere
 * on the page (the countdown in the margin) don't move it. Null = one column.
 */
export function columnSplits(rows: ReturnType<typeof buildRows>, page: number): [number, number] | null {
  const a: number[] = [], b: number[] = [];
  for (const r of rows) {
    if (r.page !== page) continue;
    const runs = runsOf(r.items);
    if (runs.length !== 3) continue;
    const right = (run: PdfGlyph[]) => Math.max(...run.map((i) => i.x + i.w));
    const left = (run: PdfGlyph[]) => Math.min(...run.map((i) => i.x));
    b.push((left(runs[0]) + right(runs[1])) / 2);
    a.push((left(runs[1]) + right(runs[2])) / 2);
  }
  if (a.length < 2) return null;
  const med = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  return [med(a), med(b)];
}

/** One row's text inside one column: glyphs right to left, a space where there is a visible gap. */
function joinText(items: PdfGlyph[]): string {
  let s = '';
  let prev: PdfGlyph | null = null;
  for (const it of items) {
    if (prev && prev.x - (it.x + it.w) > 2) s += ' ';
    s += it.str;
    prev = it;
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** File rows by day and column. Rows before the first heading, and the page header, are dropped. */
export function fileByDay(glyphs: PdfGlyph[]): Map<number, FileRow[]> {
  const rows = buildRows(glyphs);
  const splits = new Map<number, [number, number] | null>();
  for (const p of new Set(rows.map((r) => r.page))) splits.set(p, columnSplits(rows, p));
  // A page where no row has all three columns side by side (2026-10-11 page 3:
  // column ❶ sits 5pt lower than ❷/❸) takes the file's own columns — every page
  // of the plan is the same table.
  const found = [...splits.values()].filter((x): x is [number, number] => !!x);
  if (found.length) {
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const fallback: [number, number] = [med(found.map((x) => x[0])), med(found.map((x) => x[1]))];
    for (const [p, v] of splits) if (!v) splits.set(p, fallback);
  }
  const byDay = new Map<number, FileRow[]>();
  let cur: number | null = null;
  for (const r of rows) {
    const whole = r.items.map((i) => i.str).join('').replace(/\s/g, '');
    const m = whole.length < 45 ? whole.match(new RegExp(`יום(${DAYS.join('|')})`)) : null;
    if (m) { cur = DAYS.indexOf(m[1]); continue; }
    if (cur === null) continue;
    const sp = splits.get(r.page);
    const cols: Record<Group, PdfGlyph[]> = { 1: [], 2: [], 3: [] };
    // By run, not by glyph: text is right-aligned in its column, so a long line
    // ("אופציה ל30-40 דק׳ קל בערב / כוח") reaches past the split on its left.
    // A run belongs to the column its right edge is in.
    for (const run of sp ? cutAtSplits(runsOf(r.items), sp) : runsOf(r.items)) {
      // Noise is dropped run by run: the margin countdown ("39 ימים") shares a
      // row with column ❸'s workout line, and must not take that line with it.
      if (NOISE.test(joinText(run))) continue;
      const right = Math.max(...run.map((i) => i.x + i.w));
      const col: Group = !sp ? 1 : right > sp[1] ? 1 : right > sp[0] ? 2 : 3;
      cols[col].push(...run);
    }
    for (const col of [1, 2, 3] as Group[]) {
      const text = joinText(cols[col]);
      if (!text || NOISE.test(text)) continue;
      // A page without three columns: the one column applies to every group.
      const targets: Group[] = sp ? [col] : [1, 2, 3];
      for (const g of targets) {
        const list = byDay.get(cur) ?? [];
        list.push({ page: r.page, y: Math.round(r.y), col: g, text });
        byDay.set(cur, list);
      }
    }
  }
  return byDay;
}

/* --------------------------------------------------------------- tokens */

const paceSec = (s: string) => { const [m, ss] = s.split(':').map(Number); return m * 60 + ss; };
const fmtPace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function fileTokens(row: FileRow): FileTok[] {
  const out: FileTok[] = [];
  // "3 עליות x" / "3-4 x": the repeat sign closes the line, its count opens it.
  const lead = row.text.match(/^(\d+)(?:\s*[-–]\s*(\d+))?\s+[^\d:]*?\s*[x×X]$/);
  if (lead) {
    out.push({ k: 'rep', n: Number(lead[1]), row });
    if (lead[2]) out.push({ k: 'rep', n: Number(lead[2]), row });
    return out;
  }
  const re = /(\d+)\s*[x×X](?![a-zA-Z֐-׿])|[x×X]\s*(\d+)|(\d{1,2}:\d{2})|(\d+(?:\.\d+)?)/g;
  // Effort percentages ("ב90-95% מאמץ") are a feeling, not a target a watch
  // carries; the plan keeps them in the step's note.
  const text = row.text.replace(/\d+(?:\s*[-–]\s*\d+)?\s*%/g, ' ');
  for (const m of text.matchAll(re)) {
    if (m[1] || m[2]) out.push({ k: 'rep', n: Number(m[1] || m[2]), row });
    else if (m[3]) out.push({ k: 'pace', n: paceSec(m[3]), row });
    else out.push({ k: 'num', n: Number(m[4]), row });
  }
  return out;
}

const timeLabel = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60} דק׳` : `${s} שנ׳`);
const distLabel = (m: number) => (m >= 1000 ? `${+(m / 1000).toFixed(2)} ק״מ` : `${m} מ׳`);

function stepTokens(s: WorkoutStep, out: PlanTok[]) {
  if (s.repeatCount && s.repeatCount > 1) {
    out.push({ k: 'rep', n: s.repeatCount, label: `×${s.repeatCount}` });
    for (const x of s.repeatSteps || []) stepTokens(x, out);
    return;
  }
  const start0 = out.length;
  const v = s.durationValue, mx = s.durationMaxValue;
  if (typeof v === 'number' && v > 0) {
    if (s.durationType === 'distance') {
      out.push({ k: 'dist', n: v, label: distLabel(v) });
      if (typeof mx === 'number' && mx > v) out.push({ k: 'dist', n: mx, label: distLabel(mx) });
    } else if (s.durationType === 'time') {
      out.push({ k: 'time', n: v, label: timeLabel(v) });
      if (typeof mx === 'number' && mx > v) out.push({ k: 'time', n: mx, label: timeLabel(mx) });
    }
  }
  const lo = s.targetPaceMinPerKm, hi = s.targetPaceMaxPerKm;
  if (typeof lo === 'number' && lo > 0) out.push({ k: 'pace', n: lo, label: fmtPace(lo) });
  if (typeof hi === 'number' && hi > 0 && hi !== lo) out.push({ k: 'pace', n: hi, label: fmtPace(hi) });
  // What the structured fields don't carry but the step's note does: an open
  // "60 דקות ריצה קלה". The watch shows it as text and nothing more — no timer,
  // no pace alert — so a match here is an approximation, never proof.
  // In the note's own order, and before the step's structured pace, because the
  // file writes a line duration first and pace last ("40 - 50 דק׳ 4:50 – 5:30").
  // Only a step with no duration of its own: a timed stride's note ("מתגברת (3-4
  // חזרות)") is commentary, not the step's numbers.
  if (s.notes && (s.durationType === 'open' || !(typeof v === 'number' && v > 0))) {
    const start = out.length;
    const mine = out.slice(start0);
    const notes: PlanTok[] = [];
    for (const m of s.notes.matchAll(/(\d{1,2}:\d{2})|(\d+(?:\.\d+)?)/g)) {
      if (m[1]) { const n = paceSec(m[1]); if (!mine.some((t) => t.k === 'pace' && t.n === n)) notes.push({ k: 'note', n, pace: true, label: m[1] }); }
      else { const n = Number(m[2]); if (!mine.some((t) => t.k !== 'pace' && (t.n === n || t.n === n * 60 || t.n === n * 1000))) notes.push({ k: 'note', n, label: m[2] }); }
    }
    const firstPace = out.findIndex((t, i) => i >= start0 && t.k === 'pace');
    if (firstPace === -1) out.splice(start, 0, ...notes);
    else out.splice(firstPace, 0, ...notes);
  }
}

export function planTokens(workouts: ParsedWorkout[]): PlanTok[] {
  const out: PlanTok[] = [];
  for (const w of [...workouts].sort((a, b) => (a.partIndex ?? 1) - (b.partIndex ?? 1))) for (const s of w.steps || []) stepTokens(s, out);
  return out;
}

/** Does a number in the file say what this plan token says (units aside)? */
export function same(f: FileTok, p: PlanTok): boolean {
  if (p.k === 'note') return p.pace ? f.k === 'pace' && Math.abs(f.n - p.n) < 1 : f.k === 'num' && Math.abs(f.n - p.n) < 1e-6;
  if (f.k === 'rep' || p.k === 'rep') return f.k === 'rep' && p.k === 'rep' && f.n === p.n;
  if (f.k === 'pace' || p.k === 'pace') return f.k === 'pace' && p.k === 'pace' && Math.abs(f.n - p.n) < 1;
  if (p.k === 'dist') return Math.abs(f.n * 1000 - p.n) < 1 || Math.abs(f.n - p.n) < 1;
  return Math.abs(f.n * 60 - p.n) < 1 || Math.abs(f.n - p.n) < 1; // time
}

const toUnit = (f: FileTok, p: PlanTok) => (p.k === 'dist' ? (f.n < 100 ? f.n * 1000 : f.n) : p.k === 'time' ? (f.n < 10 || p.n >= 600 ? f.n * 60 : f.n) : f.n);

/* ----------------------------------------------------------------- diff */

/** Longest common subsequence alignment, as runs of equal / unequal. */
function align(a: FileTok[], b: PlanTok[]) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = same(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops: Array<{ eq: boolean; a: FileTok[]; b: PlanTok[] }> = [];
  let i = 0, j = 0;
  const push = (eq: boolean, x?: FileTok, y?: PlanTok) => {
    const last = ops[ops.length - 1];
    if (!last || last.eq !== eq) ops.push({ eq, a: [], b: [] });
    const cur = ops[ops.length - 1];
    if (x) cur.a.push(x);
    if (y) cur.b.push(y);
  };
  while (i < n && j < m) {
    if (same(a[i], b[j])) { push(true, a[i], b[j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { push(false, a[i]); i++; }
    else { push(false, undefined, b[j]); j++; }
  }
  while (i < n) push(false, a[i++]);
  while (j < m) push(false, undefined, b[j++]);
  return ops;
}

function rowsOf(toks: FileTok[]) {
  const seen = new Map<string, { page: number; y: number; text: string }>();
  for (const t of toks) seen.set(`${t.row.page}:${t.row.y}`, { page: t.row.page, y: t.row.y, text: t.row.text });
  return [...seen.values()];
}

/** A range in the file that the plan saved as one value inside it: 40–50 → 45. */
function isApprox(a: FileTok[], b: PlanTok[]): boolean {
  // "3-4 x" saved as ×3 or ×4.
  if (a.length === 1 && b.length === 0 && a[0].k === 'rep') return false;
  if (a.length === 1 && a[0].k === 'rep' && b.length === 0) return false;
  if (a.length === 2 && b.length === 1 && a.every((x) => x.k === 'num') && (b[0].k === 'time' || b[0].k === 'dist')) {
    const lo = Math.min(toUnit(a[0], b[0]), toUnit(a[1], b[0])), hi = Math.max(toUnit(a[0], b[0]), toUnit(a[1], b[0]));
    return b[0].n > lo && b[0].n < hi;
  }
  return false;
}

export function compareGroup(rows: FileRow[], workouts: ParsedWorkout[]): GroupResult {
  const ft = rows.flatMap(fileTokens);
  const pt = planTokens(workouts);
  const ops = align(ft, pt);
  const diffs: Diff[] = [];
  let matched = 0;
  // A repeat range in the file ("3-4 x") with the plan on one end of it: the
  // aligner matches the one end, leaving the other file repeat on its own.
  const repRange = (toks: FileTok[]) => toks.length === 1 && toks[0].k === 'rep';
  for (const op of ops) {
    if (op.eq) {
      matched += op.a.length;
      const noted = op.a.filter((_, i) => op.b[i].k === 'note');
      if (noted.length) diffs.push({ kind: 'note', file: rowsOf(noted), plan: `רק בהערה: ${op.b.filter((t) => t.k === 'note').map((t) => t.label).join(' · ')}` });
      continue;
    }
    if (repRange(op.a) && !op.b.length && ft.some((t) => t !== op.a[0] && t.k === 'rep' && t.row === op.a[0].row)) {
      diffs.push({ kind: 'approx', file: rowsOf(op.a), plan: 'טווח חזרות נשמר כמספר אחד' });
      continue;
    }
    // A pace the plan filled in where the file wrote none (Friday 2026-09-11: the
    // second "5 ק״מ" has no pace; the parse carried the first one's 4:40–5:00
    // over). Not wrong, not in the file either — the coach confirms it.
    const inferred = !op.a.length && op.b.length > 0 && op.b.every((t) => t.k === 'pace');
    const kind: Diff['kind'] = isApprox(op.a, op.b) ? 'approx' : inferred ? 'inferred' : !op.a.length ? 'extra' : !op.b.length ? 'missing' : 'changed';
    diffs.push({ kind, file: rowsOf(op.a), plan: op.b.length ? op.b.map((t) => t.label).join(' · ') : '—' });
  }
  const level: Level = !ft.length && !pt.length ? 'proven' : diffs.length === 0 ? 'proven' : diffs.every((d) => d.kind === 'approx' || d.kind === 'inferred' || d.kind === 'note') ? 'approx' : 'differs';
  return { level, matched, total: Math.max(ft.length, pt.length), diffs };
}

const RANK: Record<Level, number> = { proven: 0, approx: 1, unchecked: 2, differs: 3 };

/** Saved parsed_workouts → one list per pace group (a flat plan is the same for all three). */
export function groupLists(value: unknown): Record<Group, ParsedWorkout[]> {
  const v = value as any;
  if (Array.isArray(v)) return { 1: v, 2: v, 3: v };
  if (v?.group1 || v?.group2 || v?.group3) {
    const g = (k: string) => (Array.isArray(v[k]) ? v[k] : v[k]?.workouts ?? []);
    return { 1: g('group1'), 2: g('group2'), 3: g('group3') };
  }
  const w = v?.workouts ?? [];
  return { 1: w, 2: w, 3: w };
}

export function verifyPlan(glyphs: PdfGlyph[], parsedWorkouts: unknown): VerifyReport {
  const lists = groupLists(parsedWorkouts);
  const textLayer = glyphs.some((g) => HEB.test(g.str) || /\d/.test(g.str));
  const byDay = textLayer ? fileByDay(glyphs) : new Map<number, FileRow[]>();
  const days: DayResult[] = [];
  for (let d = 0; d <= 6; d++) {
    const rows = byDay.get(d) ?? [];
    const planned = ([1, 2, 3] as Group[]).some((g) => lists[g].some((w) => w.dayOfWeek === d));
    const empty: GroupResult = { level: 'unchecked', matched: 0, total: 0, diffs: [] };
    if (!textLayer || (!rows.length && planned)) {
      days.push({ dayOfWeek: d, level: 'unchecked', reason: textLayer ? 'day_not_found' : 'no_text_layer', pages: [], groups: { 1: empty, 2: empty, 3: empty } });
      continue;
    }
    if (!rows.length && !planned) continue;
    const groups = {} as Record<Group, GroupResult>;
    for (const g of [1, 2, 3] as Group[]) groups[g] = compareGroup(rows.filter((r) => r.col === g), lists[g].filter((w) => w.dayOfWeek === d));
    const level = ([1, 2, 3] as Group[]).map((g) => groups[g].level).sort((a, b) => RANK[b] - RANK[a])[0];
    days.push({ dayOfWeek: d, level, pages: [...new Set(rows.map((r) => r.page))].sort(), groups, ...(planned ? {} : { reason: 'no_plan' as const }) });
  }
  return { textLayer, days };
}
