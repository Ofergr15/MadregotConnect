// ═════════════════════════════════════════════════════════════════════════════
// שיאים tab — the pure half (design/records-prototype, decisions 2026-11-21).
//
// Everything here is a function of rows the routes already read; nothing touches
// the DB, so the privacy rules are pinned by tests rather than by code review:
//
//   • top 5 + the caller's own row, never the full table;
//   • the bottom three are never ranked when the caller is outside the top 5
//     (`rank: null`) — no "last place";
//   • `leaderboard_opt_out` removes a runner from EVERY board (they still see it);
//   • hidden pace (`default_hidden_fields` ∋ 'pace') removes a runner from every
//     time-for-distance table (records, record history, champions' record award)
//     but NOT from the km / running-time boards;
//   • no plan accuracy / verdict here, ever.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Squad standings keep their existing flag (it lived in feed/page.tsx; the feed's
 * card is off today). The שיאים tab reads the same switch, so one flip lights both.
 */
export const SHOW_SQUAD_STANDINGS = false;

export type BoardMetric = 'km' | 'time';

/** What the boards need to know about a runner. */
export interface BoardPerson {
  id: string;
  name: string;
  groupId: string | null;
  /** 1 | 2 | 3 from resolveGroup, null when unknown. */
  groupIndex: number | null;
  optOut?: boolean;
  hidesPace?: boolean;
}

export interface BoardRow {
  athleteId: string;
  name: string;
  groupIndex: number | null;
  /** null for the bottom three when the caller sits outside the top 5. */
  rank: number | null;
  meters: number;
  seconds: number;
  runs: number;
  isMe: boolean;
}

export interface WeeklyBoard {
  metric: BoardMetric;
  rows: BoardRow[];
  /** Caller's row when it is outside the top 5 (also inside `rows`, last). */
  me: BoardRow | null;
  /** How many runners are on the board (with ≥1 run, not opted out). */
  of: number;
  /** Distance to the person ranked just above the caller. Null at #1 / light week / out. */
  gap: { name: string; meters: number; seconds: number } | null;
  /** The caller is in the bottom three outside the top 5 — the "light week" copy. */
  lightWeek: boolean;
  /** The caller opted out: they see the board, it doesn't see them. */
  optedOut: boolean;
}

export const TOP_N = 5;
export const UNRANKED_TAIL = 3;

export function isOnBoard(p: Pick<BoardPerson, 'optOut'>): boolean {
  return !p.optOut;
}

/** Time / pace tables additionally drop anyone hiding pace. */
export function isOnTimeTable(p: Pick<BoardPerson, 'optOut' | 'hidesPace'>): boolean {
  return !p.optOut && !p.hidesPace;
}

export function hidesPace(defaultHiddenFields: unknown): boolean {
  return Array.isArray(defaultHiddenFields) && defaultHiddenFields.includes('pace');
}

/**
 * The weekly board. `totals` is one entry per runner for the activity week
 * (Monday, fetchWeeklyVolume). Ties break by name so two requests agree.
 */
export function weeklyBoard(
  people: BoardPerson[],
  totals: Map<string, { meters: number; seconds: number; runs: number }>,
  viewerId: string | null,
  metric: BoardMetric,
): WeeklyBoard {
  const viewer = people.find((p) => p.id === viewerId);
  const val = (t: { meters: number; seconds: number }) => (metric === 'km' ? t.meters : t.seconds);
  const ranked = people
    .filter(isOnBoard)
    .map((p) => ({ p, t: totals.get(p.id) ?? { meters: 0, seconds: 0, runs: 0 } }))
    .filter(({ t }) => t.runs > 0)
    .sort((a, b) => val(b.t) - val(a.t) || a.p.name.localeCompare(b.p.name));

  const of = ranked.length;
  const myIdx = ranked.findIndex(({ p }) => p.id === viewerId);
  const toRow = (i: number, rank: number | null): BoardRow => ({
    athleteId: ranked[i].p.id,
    name: ranked[i].p.name,
    groupIndex: ranked[i].p.groupIndex,
    rank,
    meters: Math.round(ranked[i].t.meters),
    seconds: Math.round(ranked[i].t.seconds),
    runs: ranked[i].t.runs,
    isMe: ranked[i].p.id === viewerId,
  });

  const rows: BoardRow[] = [];
  for (let i = 0; i < Math.min(TOP_N, of); i++) rows.push(toRow(i, i + 1));

  let me: BoardRow | null = null;
  let lightWeek = false;
  if (myIdx >= TOP_N) {
    lightWeek = myIdx >= of - UNRANKED_TAIL;
    me = toRow(myIdx, lightWeek ? null : myIdx + 1);
    rows.push(me);
  }

  let gap: WeeklyBoard['gap'] = null;
  if (myIdx > 0 && !lightWeek) {
    const above = ranked[myIdx - 1];
    gap = {
      name: above.p.name,
      meters: Math.max(0, Math.round(above.t.meters - ranked[myIdx].t.meters)),
      seconds: Math.max(0, Math.round(above.t.seconds - ranked[myIdx].t.seconds)),
    };
  }

  return { metric, rows, me, of, gap, lightWeek, optedOut: !!viewer?.optOut };
}

// ── squad standings ──────────────────────────────────────────────────────────

export interface SquadStanding {
  groupIndex: number;
  /** Average km per runner with ≥1 run this week. */
  avgKm: number;
  activeRunners: number;
}

/** Average km per ACTIVE runner, so a small squad doesn't lose for being small. Opt-out still counts (anonymous). */
export function squadStandings(
  people: BoardPerson[],
  totals: Map<string, { meters: number; runs: number }>,
): SquadStanding[] {
  const by = new Map<number, { m: number; n: number }>();
  for (const p of people) {
    if (!p.groupIndex) continue;
    const t = totals.get(p.id);
    if (!t || t.runs <= 0) continue;
    const s = by.get(p.groupIndex) ?? { m: 0, n: 0 };
    s.m += t.meters;
    s.n += 1;
    by.set(p.groupIndex, s);
  }
  return [...by.entries()]
    .map(([groupIndex, s]) => ({ groupIndex, avgKm: Math.round((s.m / s.n / 1000) * 10) / 10, activeRunners: s.n }))
    .sort((a, b) => b.avgKm - a.avgKm || a.groupIndex - b.groupIndex);
}

// ── age bands ────────────────────────────────────────────────────────────────

/** 10-year bands: 18–24, 25–34, 35–44, … ; null without a (plausible) birth date. */
export function ageBand(birthDate: string | null | undefined, todayIso: string): string | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = todayIso.slice(0, 10).split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  if (age < 10 || age > 100) return null;
  if (age < 25) return '18–24';
  const lo = Math.floor((age - 25) / 10) * 10 + 25;
  return `${lo}–${lo + 9}`;
}

// ── club records, filtered ───────────────────────────────────────────────────

export type SexFilter = 'all' | 'm' | 'f';

export interface RecordFacts {
  optOut?: boolean;
  hidesPace?: boolean;
  gender?: 'male' | 'female' | null;
  ageBand?: string | null;
}

export interface RecordEntryLike {
  athleteId: string;
  seconds: number;
  activityId: string | null;
  date: string | null;
}

export interface FilteredEntry<E> {
  entry: E;
  rank: number;
  official: boolean;
  ageBand: string | null;
}

/**
 * One bucket's table for a member. Opt-out and hidden pace are absolute; sex /
 * age / races-only are the caller's filters. A runner without a birth date only
 * appears under "all ages".
 */
export function filterRecordTable<E extends RecordEntryLike>(
  entries: E[],
  facts: Map<string, RecordFacts>,
  isOfficial: (e: E) => boolean,
  opts: { sex?: SexFilter; age?: string | 'all'; racesOnly?: boolean },
): FilteredEntry<E>[] {
  const sex = opts.sex ?? 'all';
  const age = opts.age ?? 'all';
  const out: FilteredEntry<E>[] = [];
  for (const e of [...entries].sort((a, b) => a.seconds - b.seconds)) {
    const f = facts.get(e.athleteId) ?? {};
    if (!isOnTimeTable(f)) continue;
    if (sex === 'm' && f.gender !== 'male') continue;
    if (sex === 'f' && f.gender !== 'female') continue;
    const band = f.ageBand ?? null;
    if (age !== 'all' && band !== age) continue;
    const official = isOfficial(e);
    if (opts.racesOnly && !official) continue;
    out.push({ entry: e, rank: out.length + 1, official, ageBand: band });
  }
  return out;
}

// ── club record history ─────────────────────────────────────────────────────

export interface ClubBreak {
  athleteId: string;
  date: string;
  seconds: number;
  activityId: string | null;
  activityName: string | null;
  /** Seconds taken off the previous club record; null for the first one counted. */
  improvedBy: number | null;
}

/**
 * The CLUB record over time: merge every athlete's own breaks (record-history's
 * `recordBreaks`, same `bucketEffort`), walk them by date, keep a strictly faster
 * one. Opted-out and pace-hiding athletes are left out before the walk, so the
 * history never names them and never shows their time as "the record before".
 */
export function clubRecordHistory(
  breaksByAthlete: Map<string, Array<{ date: string; seconds: number; activityId: string | null; activityName: string | null }>>,
  facts: Map<string, RecordFacts>,
): ClubBreak[] {
  const all: Array<{ athleteId: string; date: string; seconds: number; activityId: string | null; activityName: string | null }> = [];
  for (const [athleteId, list] of breaksByAthlete) {
    if (!isOnTimeTable(facts.get(athleteId) ?? {})) continue;
    for (const b of list) all.push({ athleteId, ...b });
  }
  all.sort((a, b) => a.date.localeCompare(b.date) || a.seconds - b.seconds);
  const out: ClubBreak[] = [];
  let best = Infinity;
  for (const b of all) {
    if (b.seconds >= best) continue;
    out.push({ ...b, improvedBy: Number.isFinite(best) ? best - b.seconds : null });
    best = b.seconds;
  }
  return out;
}

// ── monthly champions ───────────────────────────────────────────────────────

/** Most improved needs a real base: a 5 → 20 km jump is not a story. */
export const IMPROVED_MIN_BASE_KM = 40;
export const STREAK_MIN_WEEKS = 2;

export interface ChampionInput {
  people: BoardPerson[];
  monthKm: Map<string, number>;
  prevMonthKm: Map<string, number>;
  /** Per athlete: full weeks, oldest first, each `runs >= target`. */
  weeksHit: Map<string, boolean[]>;
  /** Club-record breaks dated inside the month (already privacy-filtered). */
  monthRecordBreaks: Array<{ athleteId: string; bucketKey: string; seconds: number; date: string }>;
}

export interface Champions {
  mostImproved: { athleteId: string; name: string; pct: number } | null;
  streak: { athleteId: string; name: string; weeks: number } | null;
  newRecord: { athleteId: string; name: string; bucketKey: string; seconds: number } | null;
}

/** Trailing run of `true` at the end of the list. */
export function trailingStreak(weeks: boolean[]): number {
  let n = 0;
  for (let i = weeks.length - 1; i >= 0 && weeks[i]; i--) n++;
  return n;
}

/**
 * Three awards, no "most km" (the weekly board already covers volume). Opt-out
 * removes a runner from all three; hidden pace removes them from the record award only.
 */
export function monthlyChampions(input: ChampionInput): Champions {
  const visible = input.people.filter(isOnBoard).sort((a, b) => a.name.localeCompare(b.name));

  let mostImproved: Champions['mostImproved'] = null;
  for (const p of visible) {
    const prev = input.prevMonthKm.get(p.id) ?? 0;
    const cur = input.monthKm.get(p.id) ?? 0;
    if (prev < IMPROVED_MIN_BASE_KM || cur <= prev) continue;
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (!mostImproved || pct > mostImproved.pct) mostImproved = { athleteId: p.id, name: p.name, pct };
  }

  let streak: Champions['streak'] = null;
  for (const p of visible) {
    const weeks = trailingStreak(input.weeksHit.get(p.id) ?? []);
    if (weeks < STREAK_MIN_WEEKS) continue;
    if (!streak || weeks > streak.weeks) streak = { athleteId: p.id, name: p.name, weeks };
  }

  let newRecord: Champions['newRecord'] = null;
  const byId = new Map(visible.map((p) => [p.id, p]));
  // Longest distance wins the slot (a marathon record outranks a 5K one), latest break within it.
  const order = ['fm', 'hm', '10k', '5k'];
  const breaks = [...input.monthRecordBreaks].sort(
    (a, b) => order.indexOf(a.bucketKey) - order.indexOf(b.bucketKey) || b.date.localeCompare(a.date),
  );
  for (const b of breaks) {
    const p = byId.get(b.athleteId);
    if (!p || p.hidesPace) continue;
    newRecord = { athleteId: p.id, name: p.name, bucketKey: b.bucketKey, seconds: b.seconds };
    break;
  }

  return { mostImproved, streak, newRecord };
}

// ── my progress vs squad ────────────────────────────────────────────────────

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * A running best by month ("best so far as of the end of month M"), oldest
 * first, from one athlete's breaks. Months before their first break are null.
 */
export function bestByMonth(breaks: Array<{ date: string; seconds: number }>, months: string[]): Array<number | null> {
  const sorted = [...breaks].sort((a, b) => a.date.localeCompare(b.date));
  return months.map((m) => {
    let best: number | null = null;
    for (const b of sorted) if (b.date.slice(0, 7) <= m && (best == null || b.seconds < best)) best = b.seconds;
    return best;
  });
}

/** The squad median of running bests per month — never names, never ids. */
export function squadMedianSeries(perAthlete: Array<Array<number | null>>, months: string[]): Array<number | null> {
  return months.map((_, i) => median(perAthlete.map((s) => s[i]).filter((v): v is number => v != null)));
}

/** "Improved faster than N of M": compares year-over-year improvement in seconds. */
export function fasterThan(mine: number, others: number[]): { n: number; of: number } {
  return { n: others.filter((o) => mine > o).length, of: others.length };
}

/** The last `n` YYYY-MM months ending with the one holding `todayIso`, oldest first. */
export function monthAxis(todayIso: string, n: number): string[] {
  let [y, m] = todayIso.slice(0, 7).split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

// ── tab swap ────────────────────────────────────────────────────────────────

/** ולנסיה's last day on the tab bar (race day, Israel calendar). */
export const VALENCIA_LAST_DAY = '2026-12-08';

export type FourthTab = 'records' | 'valencia' | 'none';

/** Flag on → שיאים. Flag off → ולנסיה through 8.12, then no fourth tab (פרופיל moves up). */
export function fourthTab(recordsTabEnabled: boolean, israelTodayIso: string): FourthTab {
  if (recordsTabEnabled) return 'records';
  return israelTodayIso <= VALENCIA_LAST_DAY ? 'valencia' : 'none';
}
