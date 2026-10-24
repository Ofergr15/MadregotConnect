// The two share cards of the weekly story, both editable in the story's edit mode (Ofer,
// 2026-10-24): the summary card ("השבוע של …", a hero number, three cells, a line of chips)
// keeps its look and lets the admin choose what it says; the collage — the story's closing
// card — is 2–8 tiles of the week's best numbers on colour blocks. The club's choices live in
// story_feature_settings.layout (summary, collage); a member may override only the name the
// card greets (notification_prefs.weekStory.card.name). Pure: the player, the server and the
// tests read one set of rules.

export type StatKey =
  | 'km' | 'time' | 'runs' | 'plan' | 'days' | 'pace' | 'hr' | 'elev' | 'sleep' | 'rhr' | 'load'
  | 'long' | 'set' | 'rep' | 'moment' | 'rank' | 'club' | 'vs' | 'streak';
export type ChipKey = 'record' | 'hr' | 'elev' | 'quality' | 'long' | 'rank' | 'streak' | 'plan';
export type TileColor = 'auto' | 'white' | 'g1' | 'g3' | 'peach' | 'lime' | 'glass';

export const STAT_KEYS: StatKey[] = ['km', 'time', 'runs', 'plan', 'pace', 'hr', 'elev', 'sleep', 'rhr', 'load', 'days', 'long', 'set', 'rep', 'moment', 'rank', 'club', 'vs', 'streak'];
export const CHIP_KEYS: ChipKey[] = ['record', 'hr', 'elev', 'quality', 'long', 'rank', 'streak', 'plan'];
export const TILE_COLORS: TileColor[] = ['auto', 'white', 'g1', 'g3', 'peach', 'lime', 'glass'];
/** The auto colours, in order: the collage alternates light and theme blocks. */
export const AUTO_COLORS: Exclude<TileColor, 'auto'>[] = ['white', 'g1', 'lime', 'g3', 'peach', 'glass'];
export const TILE_MIN = 2;
export const TILE_MAX = 8;
export const HEADING_MAX = 28;
export const LINE_MAX = 42;
export const NAME_MAX = 20;

export interface SummaryCard { hero: StatKey; cells: [StatKey, StatKey, StatKey]; chips: ChipKey[]; heading: string; line: string }
export interface CollageTile { stat: StatKey; color: TileColor }
export interface CollageCard { tiles: CollageTile[] }

// Week-level by default (Ofer 10-24: "it's a WEEK summary — why one long run?"); a club that saved its own keeps it.
export const DEFAULT_SUMMARY: SummaryCard = { hero: 'km', cells: ['runs', 'plan', 'pace'], chips: ['record', 'hr', 'elev'], heading: 'השבוע של {שם}', line: '' };
export const DEFAULT_COLLAGE: CollageCard = {
  tiles: [{ stat: 'km', color: 'auto' }, { stat: 'time', color: 'auto' }, { stat: 'long', color: 'auto' }, { stat: 'rep', color: 'auto' }, { stat: 'plan', color: 'auto' }, { stat: 'days', color: 'auto' }],
};

const isStat = (v: unknown): v is StatKey => typeof v === 'string' && (STAT_KEYS as string[]).includes(v);
const isChip = (v: unknown): v is ChipKey => typeof v === 'string' && (CHIP_KEYS as string[]).includes(v);
const isColor = (v: unknown): v is TileColor => typeof v === 'string' && (TILE_COLORS as string[]).includes(v);

/** Free text on a card: one line, no control or bidi-override characters, at most `max`. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u202a-\u202e\u2066-\u2069]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanSummary(raw: unknown): SummaryCard {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const cells = Array.isArray(r.cells) && r.cells.length === 3 && r.cells.every(isStat) ? (r.cells as [StatKey, StatKey, StatKey]) : DEFAULT_SUMMARY.cells;
  const chips = Array.isArray(r.chips) ? [...new Set(r.chips.filter(isChip))].slice(0, 4) : DEFAULT_SUMMARY.chips;
  const heading = 'heading' in r ? cleanText(r.heading, HEADING_MAX) : DEFAULT_SUMMARY.heading;
  return { hero: isStat(r.hero) ? r.hero : DEFAULT_SUMMARY.hero, cells: [...cells] as SummaryCard['cells'], chips, heading: heading || DEFAULT_SUMMARY.heading, line: cleanText(r.line, LINE_MAX) };
}
export function cleanCollage(raw: unknown): CollageCard {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(r.tiles)) return { tiles: DEFAULT_COLLAGE.tiles.map((t) => ({ ...t })) };
  const tiles = r.tiles
    .filter((t): t is { stat: StatKey; color?: unknown } => !!t && typeof t === 'object' && isStat((t as { stat?: unknown }).stat))
    .map((t) => ({ stat: t.stat, color: isColor(t.color) ? t.color : 'auto' as TileColor }))
    .slice(0, TILE_MAX);
  return tiles.length >= TILE_MIN ? { tiles } : { tiles: DEFAULT_COLLAGE.tiles.map((t) => ({ ...t })) };
}

// ── edits ─────────────────────────────────────────────────────────────────────────────────
export const addTile = (c: CollageCard, stat: StatKey): CollageCard => (c.tiles.length >= TILE_MAX ? c : { tiles: [...c.tiles, { stat, color: 'auto' }] });
export const removeTile = (c: CollageCard, i: number): CollageCard => (c.tiles.length <= TILE_MIN ? c : { tiles: c.tiles.filter((_, k) => k !== i) });
export const setTile = (c: CollageCard, i: number, t: Partial<CollageTile>): CollageCard => ({ tiles: c.tiles.map((x, k) => (k === i ? { ...x, ...t } : x)) });
/** Which auto colour tile `i` gets: never the same as the tile before it. */
export const tileColor = (c: CollageCard, i: number): Exclude<TileColor, 'auto'> => {
  const t = c.tiles[i]?.color ?? 'auto';
  return t === 'auto' ? AUTO_COLORS[i % AUTO_COLORS.length] : t;
};
/** The collage's grid: the first tile and a route tile are tall; 2 tiles fill the card. */
export function tileSpan(c: CollageCard, i: number): 1 | 2 {
  const n = c.tiles.length;
  if (n <= 2) return 2;
  if (i === 0) return 2;
  if (c.tiles[i].stat === 'long' && n >= 4) return 2;
  return 1;
}

// ── what each item says this week ─────────────────────────────────────────────────────────
/** One week of the numbers a watch keeps (server.ts WeekMore). */
export interface WeekNums { km: number; seconds: number; runs: number; hr: number | null; elev: number | null; load: number | null; sleep: number | null; rhr: number | null }
export interface StoryFacts {
  km: number; seconds: number; runs: number; planShare: number | null; daysActive: number;
  lastWeekKm: number | null; streak: { weeks: number; over: number } | null;
  long: { km: number; fastest: number | null } | null;
  set: string | null; fastestRep: number | null; rank: { rank: number; of: number } | null;
  clubKm: number | null; record: string | null; quality: string | null;
  /** This week and last, for the body numbers and every delta; absent on an older story. */
  now?: WeekNums | null; last?: WeekNums | null;
}
/** "▲ 6%" / "▼ 1" against last week; `tone` good/bad, or flat where neither direction is better. */
export interface Delta { text: string; tone: 'good' | 'bad' | 'flat' }
export interface StatValue { value: string; unit: string; label: string; delta?: Delta }

const km1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const pace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const hours = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;

export const STAT_NAME: Record<StatKey, string> = {
  km: 'ק״מ בשבוע', time: 'זמן ריצה', runs: 'ריצות', plan: 'מהתוכנית', days: 'ימי ריצה', pace: 'קצב ממוצע',
  hr: 'דופק ממוצע בריצה', elev: 'טיפוס', sleep: 'שינה ממוצעת', rhr: 'דופק במנוחה', load: 'עומס אימונים',
  long: 'הריצה הארוכה', set: 'סט האיכות', rep: 'החזרה המהירה', moment: 'הק״מ המהיר בארוכה', rank: 'מקום בדבוקה',
  club: 'מהק״מ של המועדון', vs: 'מול שבוע שעבר', streak: 'רצף שבועות',
};

/**
 * The change against last week. `pct`: a share ("▲ 6%"); else a plain difference in the
 * item's own unit ("▼ 1", "−12″"). `better`: which way is good — 'none' paints it grey.
 */
export function deltaOf(now: number | null | undefined, last: number | null | undefined, o: { pct: boolean; better: 'up' | 'down' | 'none'; unit?: string }): Delta | undefined {
  if (now == null || last == null || !(last > 0)) return undefined;
  const d = o.pct ? Math.round((now / last - 1) * 100) : Math.round(now - last);
  if (d === 0) return undefined;
  const tone = o.better === 'none' ? 'flat' : (d > 0) === (o.better === 'up') ? 'good' : 'bad';
  // Seconds and beats read as a signed number ("+12″"), shares and counts as an arrow.
  const text = o.unit !== undefined ? `${d > 0 ? '+' : '−'}${Math.abs(d)}${o.unit}` : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${o.pct ? '%' : ''}`;
  return { text, tone };
}

/** One item's value this week, or null when the week has none (the menu greys it out, the cards leave it out). */
export function statValue(k: StatKey, f: StoryFacts): StatValue | null {
  const n = f.now, l = f.last;
  switch (k) {
    case 'km': return { value: km1(f.km), unit: 'ק״מ', label: `${f.runs} ריצות`, delta: deltaOf(f.km, f.lastWeekKm, { pct: true, better: 'up' }) };
    case 'time': return f.seconds > 0 ? { value: hours(f.seconds), unit: 'שעות', label: 'זמן ריצה', delta: deltaOf(f.seconds, l?.seconds, { pct: true, better: 'up' }) } : null;
    case 'runs': return { value: String(f.runs), unit: '', label: 'ריצות', delta: deltaOf(f.runs, l?.runs, { pct: false, better: 'up' }) };
    case 'plan': return f.planShare != null ? { value: `${Math.round(f.planShare * 100)}%`, unit: '', label: 'מהתוכנית' } : null;
    case 'days': return { value: `${f.daysActive}/7`, unit: '', label: 'ימים' };
    case 'pace': {
      if (!(f.km > 0)) return null;
      const p = f.seconds / f.km, lp = l && l.km > 0 ? l.seconds / l.km : null;
      return { value: pace(p), unit: '', label: 'קצב ממוצע', delta: deltaOf(p, lp, { pct: false, better: 'down', unit: '″' }) };
    }
    case 'hr': return n?.hr ? { value: String(n.hr), unit: '', label: 'דופק ממוצע בריצה', delta: deltaOf(n.hr, l?.hr, { pct: false, better: 'none', unit: '' }) } : null;
    case 'elev': return n?.elev ? { value: String(n.elev), unit: 'מ׳', label: 'טיפוס', delta: deltaOf(n.elev, l?.elev, { pct: true, better: 'none' }) } : null;
    case 'sleep': return n?.sleep ? { value: hours(n.sleep), unit: '', label: 'שינה ממוצעת', delta: deltaOf(n.sleep, l?.sleep, { pct: true, better: 'up' }) } : null;
    case 'rhr': return n?.rhr ? { value: String(n.rhr), unit: '', label: 'דופק במנוחה', delta: deltaOf(n.rhr, l?.rhr, { pct: false, better: 'down', unit: '' }) } : null;
    case 'load': return n?.load ? { value: n.load.toLocaleString('en-US'), unit: '', label: 'עומס אימונים', delta: deltaOf(n.load, l?.load, { pct: true, better: 'none' }) } : null;
    case 'long': return f.long ? { value: km1(f.long.km), unit: 'ק״מ', label: 'הארוכה' } : null;
    case 'set': return f.set ? { value: f.set, unit: '', label: 'סט האיכות' } : null;
    case 'rep': return f.fastestRep ? { value: pace(f.fastestRep), unit: '', label: 'החזרה המהירה' } : null;
    case 'moment': return f.long?.fastest ? { value: pace(f.long.fastest), unit: '', label: 'הק״מ המהיר בארוכה' } : null;
    case 'rank': return f.rank ? { value: `${f.rank.rank}`, unit: `מתוך ${f.rank.of}`, label: 'מקום בדבוקה' } : null;
    case 'club': return f.clubKm ? { value: `${Math.max(1, Math.round((f.km / f.clubKm) * 100))}%`, unit: '', label: 'מהק״מ של המועדון' } : null;
    case 'vs': {
      if (!f.lastWeekKm) return null;
      const d = Math.round((f.km / f.lastWeekKm - 1) * 100);
      return { value: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}%`, unit: '', label: 'מול שבוע שעבר' };
    }
    case 'streak': return f.streak && f.streak.weeks >= 2 ? { value: String(f.streak.weeks), unit: '', label: `שבועות ברצף מעל ${f.streak.over}` } : null;
  }
}

/** The order a summary cell falls back through when its own item has nothing this week. */
const CELL_FALLBACK: StatKey[] = ['runs', 'plan', 'pace', 'time', 'hr', 'elev', 'days', 'streak'];
/** The three cells as shown: each its own item, or the next one with a value not already on the card. */
export function shownCells(card: SummaryCard, f: StoryFacts): StatKey[] {
  const used = new Set<StatKey>([card.hero]);
  return card.cells.map((k) => {
    const pick = statValue(k, f) && !used.has(k) ? k : CELL_FALLBACK.find((c) => !used.has(c) && !card.cells.includes(c) && statValue(c, f)) ?? k;
    used.add(pick);
    return pick;
  });
}
/** The collage as shown to a reader: tiles with no value this week are left out (2 at least). */
export function shownCollage(c: CollageCard, f: StoryFacts): CollageCard {
  const tiles = c.tiles.filter((t) => statValue(t.stat, f));
  return { tiles: tiles.length >= TILE_MIN ? tiles : c.tiles.slice(0, TILE_MIN) };
}

const MEDAL = ['🥇', '🥈', '🥉'];
export const CHIP_NAME: Record<ChipKey, string> = { record: 'שיא', hr: 'דופק ממוצע', elev: 'טיפוס', quality: 'אימון האיכות', long: 'הארוכה', rank: 'מקום בדבוקה', streak: 'רצף', plan: 'התוכנית' };
/** A chip's text this week, or null. Numbers stay separate runs (NumberRuns isolates them). */
export function chipText(k: ChipKey, f: StoryFacts): string | null {
  switch (k) {
    case 'record': return f.record ? `🏅 שיא ב־${f.record}` : null;
    case 'hr': return f.now?.hr ? `❤️ דופק ממוצע ${f.now.hr}` : null;
    case 'elev': return f.now?.elev ? `⛰️ ${f.now.elev} מ׳ טיפוס` : null;
    case 'quality': return f.set && f.quality ? `⚡ ${f.set} ${f.quality}` : null;
    case 'long': return f.long ? `🏃 ארוכה ${km1(f.long.km)} ק״מ` : null;
    case 'rank': return f.rank && f.rank.rank <= 3 ? `${MEDAL[f.rank.rank - 1]} מקום ${f.rank.rank}` : null;
    case 'streak': return f.streak && f.streak.weeks >= 2 ? `🔥 ${f.streak.weeks} שבועות ברצף מעל ${f.streak.over} ק״מ` : null;
    case 'plan': return f.planShare != null && f.planShare >= 1 ? '✓ השבוע כולו לפי התוכנית' : null;
  }
}

/** "השבוע של {שם}" → the parts around the name, so the name keeps its own (bold) line. */
export function fillHeading(template: string, name: string): { pre: string; name: string; post: string } {
  const t = template || DEFAULT_SUMMARY.heading;
  const at = t.indexOf('{שם}');
  if (at < 0) return { pre: t, name: '', post: '' };
  return { pre: t.slice(0, at).trim(), name, post: t.slice(at + 4).trim() };
}

/** Weeks in a row (this one included) over this week's round-ten floor — "4 שבועות ברצף מעל 100". */
export function streakOf(weeksKm: number[]): { weeks: number; over: number } | null {
  if (!weeksKm.length) return null;
  const now = weeksKm[weeksKm.length - 1];
  const over = now >= 100 ? Math.floor(now / 50) * 50 : Math.floor(now / 10) * 10;
  if (over <= 0) return null;
  let n = 0;
  for (let i = weeksKm.length - 1; i >= 0 && weeksKm[i] >= over; i--) n++;
  return n >= 2 ? { weeks: n, over } : null;
}
