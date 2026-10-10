/**
 * "לכתוב מהר" — a workout in one line of Hebrew shorthand, the way a coach writes it on
 * WhatsApp: `2 קל, 5x1000 ב-4:05 מנוחה 2:00, 2 קל`.
 *
 * TrainingPeaks' most repeated complaint is that a structured workout is built block by
 * block, and Intervals.icu's answer is a text syntax (`- 5x 1km 4:05/km Pace`). That syntax
 * is English, line-based and strict, and it has a famous trap: `400m` there is four hundred
 * MINUTES. This grammar is the same idea in the club's own words, and it is lenient in the
 * direction a coach is: every number is read the way an Israeli coach means it, and every
 * place a reading was a guess is reported back (`assumptions`) for the "הבנתי כך" preview,
 * so nothing is silently decided.
 *
 * ── The grammar ──────────────────────────────────────────────────────────────────────────
 *
 *   workout  := segment ( (',' | ';' | newline) segment )*
 *   segment  := part ( '+' part )*                 '+' continues a repeat: `4x30שנ + 60 מנוחה`
 *   part     := [ N ('x' | 'פעמים') ] work [ rest ]
 *   work     := length? pace? effort-word*          any order: `3 קמ חימום 4:40`, `ב-4:05 1000`
 *   rest     := ('מנוחה'|'התאוששות'|'הפסקה'|'r'|'ג'וג'|'הליכה'|'עמידה') value? mode?
 *             | value ('מנוחה'|…)                   `60 מנוחה`, `2 דק מנוחה`
 *   length   := number unit | number '-' number unit | number (bare, see below) | m:ss
 *   pace     := ('ב-'|'בקצב'|'@')? m:ss ('-' m:ss)?
 *
 * Bare numbers, read by context (each is an assumption the preview shows):
 *   - a rep (`5x1000`, `5x1`): ≥ 100 metres, ≤ 20 kilometres, 21–99 seconds.
 *   - with `קל / ארוכה / חימום / שחרור` (`2 קל`): kilometres.
 *   - with `טמפו / סף / מרתון`: ≤ 15 kilometres, otherwise minutes (`20 טמפו`).
 *   - a rest (`מנוחה 90`, `מנוחה 2`): ≥ 30 seconds, ≤ 10 minutes, 11–29 seconds (flagged);
 *     ≥ 100 with `ג'וג` metres of jogging.
 *   - `m:ss` is a time when it is the length of a rep or ≥ 10:00, otherwise a pace.
 *
 * Latin `m` is METRES, the reverse of Intervals.icu, because that is what `800m` means to
 * everyone this screen is for.
 *
 * Pure. Absolute paces stay absolute here: turning `4:05` into "110% of this trainee's
 * threshold" needs the trainee, and `quickToBook` is where that happens.
 */

import type { DraftZone } from './library-draft';
import { unshiftPace, type PaceAdjust } from './pace-kinds';
import {
  effortFromPct,
  effortFromZone,
  TYPED_HALF_WIDTH_PCT,
  type BookStep,
  type Effort,
  type Length,
  type RestMode,
} from './book-steps';

export type QuickEffort =
  | { kind: 'pace'; min: number; max: number }
  | { kind: 'zone'; zone: DraftZone }
  /** Run at whatever the athlete can hold — a test. Stored with no target. */
  | { kind: 'open' };

export type QuickStep =
  | { kind: 'run'; role: 'warmup' | 'main' | 'cooldown'; length: Length | null; effort: QuickEffort | null }
  | { kind: 'reps'; count: number; work: Length; effort: QuickEffort | null; rest: { length: Length; mode: RestMode | null } | null }
  | { kind: 'rest'; length: Length; mode: RestMode | null };

export type AssumptionCode =
  | 'bare-km'          // `2 קל` → 2 km
  | 'bare-metres'      // `5x800` → metres
  | 'bare-rep-km'      // `5x1` → 1 km
  | 'bare-seconds'     // `8x30` → seconds
  | 'bare-minutes'     // `20 טמפו` → minutes
  | 'rest-seconds'     // `מנוחה 90` → 90 s
  | 'rest-minutes'     // `מנוחה 2` → 2:00
  | 'rest-ambiguous'   // `מנוחה 20` → 20 s, but could have been minutes
  | 'rest-default'     // `מנוחה` with no value → 2:00
  | 'rep-effort'       // reps with no pace or word → fast
  | 'run-effort'       // a run with no pace or word → easy
  | 'range-middle'     // `60-40 דקות` → 50
  | 'warmup'           // a leading easy run became the warmup
  | 'cooldown'         // a trailing easy run became the cooldown
  | 'second-work';     // `6x9 דק + דקה מהיר` — only the first block of the rep is kept

export interface Assumption {
  code: AssumptionCode;
  /** Which step (0-based, in `steps`) it is about. */
  step: number;
  /** The words it was read from, for the preview. */
  text: string;
}

export interface QuickParse {
  steps: QuickStep[];
  assumptions: Assumption[];
  /** Words nothing understood. Shown, never dropped silently. */
  unknown: string[];
  /** What the words said about the session as a whole, for the book's chip. */
  kindHint: 'long' | 'hills' | 'test' | null;
}

// ── Normalisation ──────────────────────────────────────────────────────────────────────

/**
 * One spelling for every way the same thing is typed on a phone: geresh and gershayim
 * (׳ ״) and their curly and ASCII stand-ins, the maqaf, the times sign, invisible bidi
 * marks pasted along with a number, and `פעמים` as the repeat operator.
 */
export function normalizeQuick(text: string): string {
  return text
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[׳’‘`´]/g, "'")
    .replace(/[״“”]/g, '"')
    .replace(/[־–—]/g, '-')
    .replace(/[×✕✖*]/g, 'x')
    .replace(/(\d)\s*X\s*/g, '$1x')
    .replace(/(\d+)\s*פעמים\s*/g, '$1x')
    .replace(/(\d+)\s*x\s*/gi, '$1x')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Split on a separator, ignoring any inside parentheses. */
function splitOutside(text: string, separators: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && separators.test(ch)) {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

// ── Vocabulary ─────────────────────────────────────────────────────────────────────────

// Hebrew has no \b: a "word boundary" here is "not followed/preceded by a Hebrew letter".
const H = '\\u0590-\\u05FF';
const word = (w: string) => new RegExp(`(?<![${H}a-z])(?:${w})(?![${H}a-z])`);

const UNIT_KM = `ק"מ|ק'מ|קמ|קילומטר(?:ים)?|km|ק`;
const UNIT_M = `מטר(?:ים)?|מ'|מ|m`;
const UNIT_MIN = `דקות|דקה|דק'|דק|ד'|min`;
const UNIT_SEC = `שניות|שנ'|שנ|ש'|sec|s`;
const UNIT = `(${UNIT_KM})|(${UNIT_M})|(${UNIT_MIN})|(${UNIT_SEC})`;

const NUM = `\\d+(?:\\.\\d+)?`;
const LENGTH_RE = new RegExp(`(${NUM})(?:\\s*-\\s*(${NUM}))?\\s*(?:${UNIT})(?![${H}a-z])`);
const PACE_RE = /(?:ב-?|בקצב|@)\s*(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?/;
const CLOCK_RE = /(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?/;
const BARE_RE = new RegExp(`(?<![\\d:.])(${NUM})(?![\\d:.])`);

const EFFORT_WORDS: Array<{ re: RegExp; zone: DraftZone | null; role?: 'warmup' | 'cooldown'; kind?: QuickParse['kindHint']; easy?: boolean }> = [
  { re: word('חימום|ווארם ?אפ'), zone: 'easy', role: 'warmup', easy: true },
  { re: word('שחרור|צינון|קולדאון|קול ?דאון'), zone: 'easy', role: 'cooldown', easy: true },
  { re: word('ארוכה|ארוך|ריצה ארוכה'), zone: 'easy', kind: 'long', easy: true },
  { re: word('קצב סף|סף'), zone: 'threshold' },
  { re: word('קצב מרתון|מרתון'), zone: 'marathon_pace' },
  { re: word('טמפו'), zone: 'tempo' },
  { re: word('ספרינט|ספרינטים|האצות|סטריידים|מתגברת'), zone: 'sprint' },
  { re: word('מהיר|מהירה|אינטרוול(?:ים)?'), zone: 'interval' },
  { re: word('גבעות|עליות|עליה|גבעה'), zone: 'interval', kind: 'hills' },
  { re: word('טסט|מבחן'), zone: null, kind: 'test' },
  { re: word("קל|קלה|ג'וג|גוג|ריצה קלה"), zone: 'easy', easy: true },
];

const REST_WORD = `מנוחה|מנוחות|התאוששות|הפסקה|r|עמידה|הליכה|ג'וג|גוג`;
const REST_RE = new RegExp(`(?<![${H}a-z])(?:${REST_WORD})(?![${H}a-z])`);
/** Words that are part of the sentence but carry no information. */
const FILLER = word(`ריצה|ריצת|ריצות|קצב|של|את|עם|ו|חזרות|חזרה|כל|לק"מ|לקמ|ק"מ|אחרי|בין|ה`);

function clockSec(s: string): number {
  const [m, sec] = s.split(':').map(Number);
  return m * 60 + sec;
}

function unitLength(value: number, unitGroup: number): Length {
  switch (unitGroup) {
    case 1: return { measure: 'distance', value: Math.round(value * 1000) };
    case 2: return { measure: 'distance', value: Math.round(value) };
    case 3: return { measure: 'time', value: Math.round(value * 60) };
    default: return { measure: 'time', value: Math.round(value) };
  }
}

function matchedUnit(m: RegExpMatchArray): number {
  for (let g = 3; g <= 6; g++) if (m[g] !== undefined) return g - 2;
  return 4;
}

// ── Phrases ────────────────────────────────────────────────────────────────────────────

interface WorkRead {
  length: Length | null;
  effort: QuickEffort | null;
  role: 'warmup' | 'cooldown' | null;
  easyWord: boolean;
  kind: QuickParse['kindHint'];
  assumptions: Array<{ code: AssumptionCode; text: string }>;
  leftover: string;
}

function readWork(raw: string, inRepeat: boolean): WorkRead {
  let text = ` ${raw} `;
  const out: WorkRead = { length: null, effort: null, role: null, easyWord: false, kind: null, assumptions: [], leftover: '' };
  const take = (m: RegExpMatchArray) => { text = text.replace(m[0], ' '); };

  // The words first, so a number's meaning can depend on them (`2 קל` vs `20 טמפו`).
  let zone: DraftZone | null | undefined;
  for (const w of EFFORT_WORDS) {
    const m = text.match(w.re);
    if (!m) continue;
    take(m);
    if (w.role && !out.role) out.role = w.role;
    if (w.kind && !out.kind) out.kind = w.kind;
    if (w.easy) out.easyWord = true;
    // The hardest word wins: `גבעות קל` is still a hill session.
    if (zone === undefined || (w.zone && !w.easy)) zone = w.zone;
  }

  const pace = text.match(PACE_RE);
  if (pace) {
    take(pace);
    const a = clockSec(pace[1]);
    const b = pace[2] ? clockSec(pace[2]) : a;
    out.effort = { kind: 'pace', min: Math.min(a, b), max: Math.max(a, b) };
  }

  const len = text.match(LENGTH_RE);
  if (len) {
    take(len);
    const unit = matchedUnit(len);
    const a = Number(len[1]);
    const b = len[2] !== undefined ? Number(len[2]) : a;
    if (len[2] !== undefined) out.assumptions.push({ code: 'range-middle', text: len[0].trim() });
    out.length = unitLength((a + b) / 2, unit);
  } else if (new RegExp(`(?<![\\d${H}])דקה(?![${H}])`).test(text)) {
    text = text.replace('דקה', ' ');
    out.length = { measure: 'time', value: 60 };
  } else if (/דקתיים/.test(text)) {
    text = text.replace('דקתיים', ' ');
    out.length = { measure: 'time', value: 120 };
  }

  // A clock with no `ב`: a length when there is none yet and this is a rep (`5x3:00`) or it
  // is too long to be a pace (`20:00`), otherwise the pace (`3 קמ חימום 4:40`).
  const clock = text.match(CLOCK_RE);
  if (clock) {
    const a = clockSec(clock[1]);
    if (!out.length && (inRepeat || a >= 600) && !clock[2]) {
      take(clock);
      out.length = { measure: 'time', value: a };
    } else if (!out.effort || out.effort.kind !== 'pace') {
      take(clock);
      const b = clock[2] ? clockSec(clock[2]) : a;
      out.effort = { kind: 'pace', min: Math.min(a, b), max: Math.max(a, b) };
    }
  }

  if (!out.length) {
    const bare = text.match(BARE_RE);
    if (bare) {
      take(bare);
      const n = Number(bare[1]);
      if (inRepeat) {
        if (n >= 100) { out.length = { measure: 'distance', value: Math.round(n) }; out.assumptions.push({ code: 'bare-metres', text: bare[1] }); }
        else if (n <= 20) { out.length = { measure: 'distance', value: Math.round(n * 1000) }; out.assumptions.push({ code: 'bare-rep-km', text: bare[1] }); }
        else { out.length = { measure: 'time', value: Math.round(n) }; out.assumptions.push({ code: 'bare-seconds', text: bare[1] }); }
      } else if ((zone === 'tempo' || zone === 'threshold' || zone === 'marathon_pace') && n > 15) {
        out.length = { measure: 'time', value: Math.round(n * 60) };
        out.assumptions.push({ code: 'bare-minutes', text: bare[1] });
      } else if (n >= 100) {
        out.length = { measure: 'distance', value: Math.round(n) };
        out.assumptions.push({ code: 'bare-metres', text: bare[1] });
      } else {
        out.length = { measure: 'distance', value: Math.round(n * 1000) };
        out.assumptions.push({ code: 'bare-km', text: bare[1] });
      }
    }
  }

  if (!out.effort) {
    if (out.kind === 'test') out.effort = { kind: 'open' };
    else if (zone) out.effort = { kind: 'zone', zone };
  }
  out.leftover = text.replace(new RegExp(FILLER.source, 'g'), ' ').replace(/[()\-.:'"]/g, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

interface RestRead {
  length: Length;
  mode: RestMode | null;
  assumptions: Array<{ code: AssumptionCode; text: string }>;
  leftover: string;
}

function readRest(raw: string): RestRead {
  let text = ` ${raw} `;
  const assumptions: RestRead['assumptions'] = [];
  let mode: RestMode | null = null;
  if (/ג'?וג|גוג/.test(text)) mode = 'jog';
  else if (/הליכה/.test(text)) mode = 'walk';
  else if (/עמידה|מוחלטת/.test(text)) mode = 'stand';
  text = text.replace(new RegExp(REST_RE.source, 'g'), ' ').replace(/מוחלטת/g, ' ');

  let length: Length | null = null;
  const len = text.match(LENGTH_RE);
  const clock = text.match(CLOCK_RE);
  if (len) {
    text = text.replace(len[0], ' ');
    const a = Number(len[1]);
    const b = len[2] !== undefined ? Number(len[2]) : a;
    length = unitLength((a + b) / 2, matchedUnit(len));
  } else if (clock) {
    text = text.replace(clock[0], ' ');
    length = { measure: 'time', value: clockSec(clock[1]) };
  } else if (/דקה/.test(text)) {
    text = text.replace('דקה', ' ');
    length = { measure: 'time', value: 60 };
  } else if (/דקתיים/.test(text)) {
    text = text.replace('דקתיים', ' ');
    length = { measure: 'time', value: 120 };
  } else {
    const bare = text.match(BARE_RE);
    if (bare) {
      text = text.replace(bare[0], ' ');
      const n = Number(bare[1]);
      if (n >= 100 && mode === 'jog') {
        length = { measure: 'distance', value: Math.round(n) };
        assumptions.push({ code: 'bare-metres', text: bare[1] });
      } else if (n >= 30) {
        length = { measure: 'time', value: Math.round(n) };
        assumptions.push({ code: 'rest-seconds', text: bare[1] });
      } else if (n <= 10) {
        length = { measure: 'time', value: Math.round(n * 60) };
        assumptions.push({ code: 'rest-minutes', text: bare[1] });
      } else {
        length = { measure: 'time', value: Math.round(n) };
        assumptions.push({ code: 'rest-ambiguous', text: bare[1] });
      }
    }
  }
  if (!length) {
    length = { measure: 'time', value: 120 };
    assumptions.push({ code: 'rest-default', text: raw.trim() });
  }
  const leftover = text.replace(new RegExp(FILLER.source, 'g'), ' ').replace(/[()\-.:'"]/g, ' ').replace(/\s+/g, ' ').trim();
  return { length, mode, assumptions, leftover };
}

/**
 * Where the rest starts in a phrase: at the rest word, or at the number right before it
 * (`60 מנוחה`, `2 דק מנוחה`). `ג'וג`/`הליכה` only count as a rest inside a repeat or with
 * a time on them — on their own `2 ק"מ ג'וג` is an easy run.
 */
function restStart(text: string, inRepeat: boolean): number {
  const strong = new RegExp(`(?<![${H}a-z])(?:מנוחה|מנוחות|התאוששות|הפסקה|r|עמידה)(?![${H}a-z])`);
  const weak = new RegExp(`(?<![${H}a-z])(?:הליכה|ג'וג|גוג)(?![${H}a-z])`);
  let m = text.match(strong);
  if (!m && inRepeat) m = text.match(weak);
  if (!m && !inRepeat) {
    const w = text.match(weak);
    if (w && !new RegExp(UNIT_KM).test(text) && /\d/.test(text)) m = w;
  }
  if (!m || m.index === undefined) return -1;
  // A number directly before the word can belong to the rest (`60 מנוחה`, `2 דק מנוחה`) —
  // but never the minutes-and-seconds of a pace (`ב-4:05 מנוחה`), and inside a rep only
  // when the work before it still has a length of its own (`400 60 מנוחה`), or `5x400
  // מנוחה 90` would lose its 400 to the rest.
  const before = text.slice(0, m.index);
  const tail = before.match(new RegExp(`(?<![\\d.:])(${NUM}\\s*(?:(?:${UNIT_MIN}|${UNIT_SEC}|${UNIT_M})(?![${H}a-z]))?)\\s*$`));
  if (tail && tail.index !== undefined) {
    const pre = before.slice(0, tail.index);
    const isPace = /(?:ב-?|בקצב|@)\s*$/.test(pre);
    const workKeepsLength = /\d/.test(pre);
    if (!isPace && (inRepeat ? workKeepsLength : !workKeepsLength)) return tail.index;
  }
  return m.index;
}

// ── The parser ─────────────────────────────────────────────────────────────────────────

export function parseQuickText(input: string): QuickParse {
  const text = normalizeQuick(input);
  const steps: QuickStep[] = [];
  const assumptions: Assumption[] = [];
  const unknown: string[] = [];
  let kindHint: QuickParse['kindHint'] = null;
  const explicitRole = new Set<number>();

  const note = (list: Array<{ code: AssumptionCode; text: string }>, step: number) => {
    for (const a of list) assumptions.push({ ...a, step });
  };

  for (const segment of splitOutside(text, /[,;\n]/)) {
    // `Nx(a + b)` → `Nx a + b`: one level of parentheses is a repeat's body.
    const flat = segment.replace(/^(\d+x)\s*\((.*)\)\s*(.*)$/, (_, n, body, after) => `${n} ${body}${after ? ` + ${after}` : ''}`);
    const parts = splitOutside(flat, /\+/);
    if (!parts.length) continue;

    const head = parts[0].match(/^(\d+)x\s*(.*)$/);
    if (head) {
      const count = Math.max(1, Math.min(50, Number(head[1])));
      const body = head[2];
      const cut = restStart(body, true);
      const workText = cut >= 0 ? body.slice(0, cut) : body;
      const work = readWork(workText, true);
      let rest: RestRead | null = cut >= 0 ? readRest(body.slice(cut)) : null;
      const index = steps.length;
      for (const extra of parts.slice(1)) {
        if (!rest && restStart(extra, true) >= 0) {
          rest = readRest(extra);
        } else {
          assumptions.push({ code: 'second-work', step: index, text: extra });
        }
      }
      if (work.kind && !kindHint) kindHint = work.kind;
      let effort = work.effort;
      if (!effort) {
        effort = { kind: 'zone', zone: 'interval' };
        assumptions.push({ code: 'rep-effort', step: index, text: workText.trim() });
      }
      steps.push({
        kind: 'reps',
        count,
        work: work.length ?? { measure: 'distance', value: 400 },
        effort,
        rest: rest ? { length: rest.length, mode: rest.mode } : null,
      });
      note(work.assumptions, index);
      if (rest) note(rest.assumptions, index);
      if (!work.length) unknown.push(workText.trim() || head[0]);
      if (work.leftover) unknown.push(work.leftover);
      if (rest?.leftover) unknown.push(rest.leftover);
      continue;
    }

    for (const part of parts) {
      const cut = restStart(part, false);
      if (cut === 0 || (cut > 0 && !/\d/.test(part.slice(0, cut)))) {
        const rest = readRest(part);
        const index = steps.length;
        steps.push({ kind: 'rest', length: rest.length, mode: rest.mode });
        note(rest.assumptions, index);
        if (rest.leftover) unknown.push(rest.leftover);
        continue;
      }
      const workText = cut > 0 ? part.slice(0, cut) : part;
      const work = readWork(workText, false);
      const index = steps.length;
      if (work.kind && !kindHint) kindHint = work.kind;
      if (!work.length && !work.effort && !work.role) {
        if (workText.trim()) unknown.push(workText.trim());
      } else {
        let effort = work.effort;
        if (!effort) {
          effort = { kind: 'zone', zone: 'easy' };
          if (!work.role) assumptions.push({ code: 'run-effort', step: index, text: workText.trim() });
        }
        steps.push({ kind: 'run', role: work.role ?? 'main', length: work.length, effort });
        if (work.role) explicitRole.add(index);
        note(work.assumptions, index);
        if (work.leftover) unknown.push(work.leftover);
      }
      if (cut > 0) {
        const rest = readRest(part.slice(cut));
        const restIndex = steps.length;
        steps.push({ kind: 'rest', length: rest.length, mode: rest.mode });
        note(rest.assumptions, restIndex);
        if (rest.leftover) unknown.push(rest.leftover);
      }
    }
  }

  // Roles: `2 קל, 5x1000…, 2 קל` is a warmup and a cooldown. Only when there is a harder
  // block to warm up for — a session that is all easy running is just an easy run.
  const isEasyRun = (s: QuickStep | undefined) => s?.kind === 'run' && s.role === 'main'
    && s.effort?.kind === 'zone' && s.effort.zone === 'easy';
  const hard = (s: QuickStep) => s.kind === 'reps'
    || (s.kind === 'run' && !(s.effort?.kind === 'zone' && s.effort.zone === 'easy') && s.role === 'main');
  const firstHard = steps.findIndex(hard);
  if (firstHard > 0 && isEasyRun(steps[0]) && !explicitRole.has(0)) {
    (steps[0] as Extract<QuickStep, { kind: 'run' }>).role = 'warmup';
    assumptions.push({ code: 'warmup', step: 0, text: '' });
  }
  const last = steps.length - 1;
  let lastHard = -1;
  steps.forEach((s, i) => { if (hard(s)) lastHard = i; });
  if (lastHard >= 0 && last > lastHard && isEasyRun(steps[last]) && !explicitRole.has(last)) {
    (steps[last] as Extract<QuickStep, { kind: 'run' }>).role = 'cooldown';
    assumptions.push({ code: 'cooldown', step: last, text: '' });
  }
  // An explicit `שחרור` on the ONLY step is an easy recovery run, not a cooldown.
  if (steps.length === 1 && steps[0].kind === 'run' && steps[0].role !== 'main') {
    steps[0].role = 'main';
  }

  return { steps, assumptions, unknown: unknown.filter(Boolean), kindHint };
}

// ── Into the book ──────────────────────────────────────────────────────────────────────

function effortFor(effort: QuickEffort | null, thresholdSec: number | null, adjust?: PaceAdjust | null): { effort: Effort | null; missing: boolean } {
  if (!effort || effort.kind === 'open') return { effort: null, missing: false };
  if (effort.kind === 'zone') return { effort: effortFromZone(effort.zone), missing: false };
  if (!thresholdSec) return { effort: null, missing: true };
  // A typed pace is what the watch gets: with a pace update in force the stored effort is
  // the one that comes out at the typed number after it (pace-kinds.ts). No update = as typed.
  const by = (effort.min + effort.max) / 2 - unshiftPace((effort.min + effort.max) / 2, thresholdSec, adjust);
  const min = effort.min - by;
  const max = effort.max - by;
  if (min === max) return { effort: effortFromPct((thresholdSec / min) * 100), missing: false };
  const fastPct = (thresholdSec / min) * 100;
  const slowPct = (thresholdSec / max) * 100;
  const out = effortFromPct((fastPct + slowPct) / 2, Math.max(TYPED_HALF_WIDTH_PCT, (fastPct - slowPct) / 2));
  return { effort: out, missing: false };
}

export interface QuickBook {
  steps: BookStep[];
  /**
   * A typed pace that could not be kept, because this trainee has no threshold to state
   * it against. The screen warns and blocks the watch push — it never invents one.
   */
  needsThreshold: boolean;
}

/**
 * The parse → book steps, with every typed pace turned into a share of `thresholdSec`.
 *
 * This is the step that makes a typed workout reusable: `ב-4:05` for Shahar is stored as
 * Shahar's 110%, and the next trainee who is sent it gets their own 110%.
 */
export function quickToBook(parse: QuickParse, thresholdSec: number | null, adjust?: PaceAdjust | null): QuickBook {
  let needsThreshold = false;
  const steps = parse.steps.map((step): BookStep => {
    if (step.kind === 'rest') return { kind: 'rest', length: step.length, mode: step.mode };
    const { effort, missing } = effortFor(step.effort, thresholdSec, adjust);
    if (missing) needsThreshold = true;
    if (step.kind === 'reps') {
      return { kind: 'reps', count: step.count, work: step.work, effort, rest: step.rest };
    }
    return { kind: 'run', role: step.role, length: step.length, effort };
  });
  return { steps, needsThreshold };
}
