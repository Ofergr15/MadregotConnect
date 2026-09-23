// Per-pack Instagram stories — the pure half: who ran in which pack, which
// numbers go on each story, and which run the graph/route comes from. The
// canvas half is ./render.ts, the data comes from GET /api/pack-stories.
//
// Units, as everywhere: distance METERS, duration SECONDS, pace SECONDS PER KM.

export type Pack = 1 | 2 | 3;
export const PACKS: Pack[] = [1, 2, 3];

/** One run of the session, as the API ships it. */
export interface PackRun {
  id: string;
  name: string;
  /** Pack from the session's RSVP, else the athlete's home group, else 0. */
  pack: 0 | Pack;
  src: 'rsvp' | 'home' | 'none';
  /** The same run synced onto a second profile — hidden, never counted. */
  dup: boolean;
  /** Local HH:MM. */
  start: string;
  dist: number;
  dur: number;
  pace: number;
  hr: number | null;
  /** [meters, seconds] per watch lap. */
  laps: Array<[number, number]>;
  /** GPS trace normalised to 0..1 on its longer side, or null without GPS. */
  route: Array<[number, number]> | null;
}

export interface PackSession {
  date: string;   // YYYY-MM-DD
  label: string;  // "אימון שלישי · 22.9"
  runs: PackRun[];
}

export type Layout = 'chart' | 'summary';
export type MetricKey =
  | 'longest' | 'fastKm' | 'avgPace' | 'count' | 'totalKm'
  | 'runDist' | 'runPace' | 'runTime';
export type LogoKind = 'badge' | 'stairs' | 'wordmark' | 'none';
export type LogoColor = 'white' | 'black';
export type Background = 'club' | 'mine' | 'clear';
/** What an export contains: the whole story, the story without its map/graph, or the splits card alone. */
export type Variant = 'full' | 'noMap' | 'splits';

export interface SlotEdit { runId?: string; value?: string; title?: string }

export interface PackConfig {
  metrics: Record<Layout, MetricKey[]>;
  chart: boolean;
  chartRun: string | null;
  caption: string;
  edits: Partial<Record<MetricKey, SlotEdit>>;
}

export interface StoryState {
  pack: Pack;
  bg: Background;
  nextInLine: boolean;
  layout: Layout;
  show: { pill: boolean; date: boolean; title: boolean; name: boolean; chartName: boolean };
  logo: { kind: LogoKind; color: LogoColor };
  /** runId -> pack, set by hand for runners the data couldn't place. */
  assign: Record<string, Pack>;
  packs: Record<Pack, PackConfig>;
}

export function newPack(): PackConfig {
  return {
    metrics: { chart: ['avgPace'], summary: ['runDist', 'runPace', 'runTime'] },
    chart: true, chartRun: null, caption: '', edits: {},
  };
}

export function initialState(): StoryState {
  return {
    pack: 1, bg: 'club', nextInLine: true, layout: 'chart',
    show: { pill: true, date: true, title: true, name: false, chartName: false },
    logo: { kind: 'badge', color: 'white' },
    assign: {},
    packs: { 1: newPack(), 2: newPack(), 3: newPack() },
  };
}

// ── formatting ──────────────────────────────────────────────────────────
export const fmtPace = (s: number | null | undefined) =>
  s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '–';
export const fmtKm = (m: number) => (m / 1000).toFixed(2);
export function fmtDur(sec: number): string {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
}

/** Fastest whole kilometre, re-binned from the watch laps (each lap = constant pace). */
export function fastestKm(laps: Array<[number, number]>): number | null {
  if (!laps.length) return null;
  let dist = 0, time = 0, nextKm = 1000, lastT = 0, best: number | null = null;
  for (const [d, t] of laps) {
    if (!d || !t) continue;
    const v = d / t;
    let segD = d, segT0 = time;
    while (dist + segD >= nextKm) {
      const need = nextKm - dist;
      const tAt = segT0 + need / v;
      const kmTime = tAt - lastT;
      if (best === null || kmTime < best) best = kmTime;
      lastT = tAt; segD -= need; segT0 = tAt; dist = nextKm; nextKm += 1000;
    }
    dist += segD; time += t;
  }
  return best;
}

// ── metrics ─────────────────────────────────────────────────────────────
interface MetricDef {
  title: string;
  unit: string;
  /** One line on the picker: what the number is, in plain words. */
  desc: string;
  /** Picks a runner: lower rank wins. */
  rank?: (r: PackRun) => number;
  val?: (r: PackRun) => string;
  needs?: (r: PackRun) => boolean;
  /** A number about the whole pack. */
  agg?: (rs: PackRun[]) => string;
  /** A number about the featured run (the one the graph/route comes from). */
  fval?: (r: PackRun) => string;
}

const fk = (r: PackRun) => fastestKm(r.laps);
const packPace = (rs: PackRun[]) => rs.reduce((a, r) => a + r.dur, 0) / (rs.reduce((a, r) => a + r.dist, 0) / 1000);

// "לק״מ", never "/ק״מ": a slash next to Hebrew gets flipped by the bidi algorithm.
export const METRICS: Record<MetricKey, MetricDef> = {
  avgPace: { title: 'קצב ממוצע של הדבוקה', unit: 'לק״מ', desc: 'כל הזמן של רצי הדבוקה ÷ כל הק״מ שלהם. כולל חימום ושחרור, כך שריצה ארוכה שוקלת יותר.', agg: rs => fmtPace(packPace(rs)) },
  longest: { title: 'הכי רחוק', unit: 'ק״מ', desc: 'הריצה הארוכה בדבוקה, עם שם הרץ.', rank: r => -r.dist, val: r => fmtKm(r.dist) },
  fastKm: { title: 'ק״מ הכי מהיר', unit: 'לק״מ', desc: 'הקילומטר המהיר ביותר בדבוקה, מתוך ההקפות בשעון.', rank: r => fk(r) || 1e9, val: r => fmtPace(fk(r)), needs: r => !!fk(r) },
  totalKm: { title: 'ק״מ ביחד', unit: 'ק״מ', desc: 'סך הק״מ של כל רצי הדבוקה.', agg: rs => String(Math.round(rs.reduce((a, r) => a + r.dist, 0) / 1000)) },
  count: { title: 'רצו היום', unit: 'רצים', desc: 'כמה רצים בדבוקה.', agg: rs => String(rs.length) },
  runDist: { title: 'מרחק', unit: 'ק״מ', desc: 'המרחק של הריצה שהמסלול שלה מוצג.', fval: r => fmtKm(r.dist) },
  runPace: { title: 'קצב ממוצע', unit: 'לק״מ', desc: 'הקצב הממוצע של הריצה שהמסלול שלה מוצג.', fval: r => fmtPace(r.pace) },
  runTime: { title: 'זמן', unit: '', desc: 'משך הריצה שהמסלול שלה מוצג.', fval: r => fmtDur(r.dur) },
};
/** The options each layout offers, in picker order. */
export const METRIC_ORDER: Record<Layout, MetricKey[]> = {
  chart: ['avgPace', 'longest', 'fastKm', 'totalKm', 'count'],
  summary: ['runDist', 'runPace', 'runTime', 'avgPace', 'longest', 'totalKm', 'count'],
};
export const LAYOUTS: Record<Layout, { name: string; max: number }> = {
  chart: { name: 'גרף מפורט', max: 2 },
  summary: { name: 'סיכום רגיל', max: 3 },
};

// ── selection ───────────────────────────────────────────────────────────
// The club runs in the morning; the same people's evening runs are not the session.
export const SESSION_ENDS = '12:00';
const inWindow = (_S: StoryState, r: PackRun) => r.start < SESSION_ENDS;
export const packOf = (S: StoryState, r: PackRun): 0 | Pack => S.assign[r.id] ?? r.pack;
export const runsFor = (S: StoryState, sess: PackSession, p: Pack) =>
  sess.runs.filter(r => !r.dup && inWindow(S, r) && packOf(S, r) === p);
export const unassigned = (S: StoryState, sess: PackSession) =>
  sess.runs.filter(r => !r.dup && inWindow(S, r) && !packOf(S, r));
export const dups = (S: StoryState, sess: PackSession) => sess.runs.filter(r => r.dup && inWindow(S, r));

export function ranked(key: MetricKey, rs: PackRun[]): PackRun[] {
  const m = METRICS[key];
  if (!m.rank) return [];
  return rs.filter(r => !m.needs || m.needs(r)).slice().sort((a, b) => m.rank!(a) - m.rank!(b));
}

/**
 * The run the graph (chart layout) or the route (summary layout) comes from.
 * Default: the run with the most laps — the one that recorded the session's structure.
 */
export function chartRun(S: StoryState, sess: PackSession, p: Pack, need: 'route' | 'laps' = S.layout === 'summary' ? 'route' : 'laps'): PackRun | null {
  const cfg = S.packs[p];
  const rs = runsFor(S, sess, p).filter(need === 'route' ? r => !!r.route : r => r.laps.length > 0);
  if (cfg.chartRun != null) {
    const r = rs.find(x => x.id === cfg.chartRun);
    if (r) return r;
  }
  return rs.slice().sort((a, b) => b.laps.length - a.laps.length)[0] || null;
}

export interface Slot {
  key: MetricKey;
  title: string;
  unit: string;
  run?: PackRun | null;
  auto: string;
  who: string;
  value: string;
  edited: boolean;
}

/** The number slots of a pack's story, after automatic picks and manual edits. */
export function slots(S: StoryState, sess: PackSession, p: Pack): Slot[] {
  const cfg = S.packs[p], rs = runsFor(S, sess, p), out: Slot[] = [];
  cfg.metrics[S.layout].forEach((key, i) => {
    const m = METRICS[key], ed = cfg.edits[key] || {};
    let run: PackRun | null | undefined, auto: string, who = '';
    if (m.fval) {
      run = chartRun(S, sess, p);
      auto = run ? m.fval(run) : '–';
      who = run ? run.name : '';
    } else if (m.rank) {
      const list = ranked(key, rs);
      let pick: PackRun | undefined = list[0];
      // The same runner winning both records reads as a mistake; the second goes to the next in line.
      const prev = out[0]?.run;
      if (ed.runId == null && S.nextInLine && i > 0 && prev && pick && pick.id === prev.id && list[1]) pick = list[1];
      if (ed.runId != null) pick = rs.find(r => r.id === ed.runId) || pick;
      run = pick;
      auto = pick ? m.val!(pick) : '–';
      who = pick ? pick.name : '';
    } else {
      auto = rs.length ? m.agg!(rs) : '–';
    }
    out.push({
      key, title: ed.title ?? m.title, unit: m.unit, run, auto, who,
      value: ed.value ?? auto,
      edited: ed.value != null || ed.runId != null || ed.title != null,
    });
  });
  return out;
}

/** The chip preview: what this metric would show for the pack right now. */
export function metricPreview(S: StoryState, sess: PackSession, p: Pack, key: MetricKey): string {
  const m = METRICS[key], rs = runsFor(S, sess, p);
  if (m.fval) { const fr = chartRun(S, sess, p); return fr ? m.fval(fr) : '–'; }
  if (m.rank) { const top = ranked(key, rs)[0]; return top ? m.val!(top) : '–'; }
  return rs.length ? m.agg!(rs) : '–';
}

/** Whether a metric can be turned on at all for this pack (fastest km needs laps). */
export function metricAvailable(S: StoryState, sess: PackSession, p: Pack, key: MetricKey): boolean {
  const m = METRICS[key];
  return !m.needs || runsFor(S, sess, p).some(m.needs);
}

// ── session labels ──────────────────────────────────────────────────────
const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** "2026-09-22" → "אימון שלישי · 22.9". Parsed as a calendar date, no timezone involved. */
export function sessionLabel(date: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `אימון ${HE_DAYS[dow]} · ${d}.${mo}`;
}
