import { bookTotals, toneOf, type BookStep } from './book-steps';
import type { LibraryKind } from './library';

// "I want you to recognise each workout yourself, and I approve or not" (Ofer 10-23).
// The old guess read the name and one step at a time: "50 דקות קל" came out a long run,
// "17 × 500 מ׳" an easy run. This reads the whole session's SHAPE — how much of it is
// fast, how much is tempo, how long it is — and says why, so the approval is one tap.

export type Confidence = 'sure' | 'likely';
export interface Classified { kind: LibraryKind; confidence: Confidence; reason: string }

const THRESHOLD = 240; // a typical threshold (4:00/km) — only to size untested sessions
const mins = (sec: number) => Math.round(sec / 60);
const km = (m: number) => (m >= 1000 ? `${Math.round(m / 100) / 10} ק״מ` : `${Math.round(m)} מ׳`);

/** Seconds of one step at the typical threshold, and its tone. */
function sliceOf(s: BookStep): { sec: number; m: number; tone: 'e' | 't' | 'f' | 'r' } {
  const t = bookTotals([s], THRESHOLD);
  if (s.kind === 'rest' || s.kind === 'hr') return { sec: t.durationSec, m: t.distanceM, tone: 'r' };
  return { sec: t.durationSec, m: t.distanceM, tone: toneOf(s.effort) as 'e' | 't' | 'f' };
}

/** A strides block: short and few, or the coach called them האצות. */
const isStrides = (s: BookStep) => s.kind === 'reps' && (/האצ/.test(s.note || '')
  || (s.work.measure === 'time' ? s.work.value <= 30 : s.work.value <= 200) && s.count <= 8);
const isShort = (s: BookStep) => s.kind === 'reps' && (s.work.measure === 'time' ? s.work.value <= 30 : s.work.value <= 200);

/** "6 × 9 דק׳ + 2 × 20 שנ׳" → repeat blocks (strides dropped), with "טמפו" read as the effort. */
function repsFromName(name: string): Array<Extract<BookStep, { kind: 'reps' }>> {
  const out: Array<Extract<BookStep, { kind: 'reps' }>> = [];
  for (const part of name.split('+')) {
    const m = /(\d+)\s*[×x]\s*([\d.]+)\s*(ק״מ|ק"מ|מ׳|מ'|דק׳|דקות|שנ׳|שניות)/.exec(part);
    if (!m) continue;
    const value = Number(m[2]);
    const unit = m[3];
    const work = /ק/.test(unit[0]) ? { measure: 'distance' as const, value: value * 1000 }
      : /^מ/.test(unit) ? { measure: 'distance' as const, value }
      : /^ד/.test(unit) ? { measure: 'time' as const, value: value * 60 } : { measure: 'time' as const, value };
    const block = { kind: 'reps' as const, count: Number(m[1]), work, effort: null, rest: null, note: /האצ/.test(part) ? 'האצות' : /טמפו/.test(part) ? 'טמפו' : undefined };
    if (!isStrides(block as BookStep)) out.push(block as Extract<BookStep, { kind: 'reps' }>);
  }
  return out;
}

export function classifyWorkout(input: BookStep[] | null | undefined, hint = ''): Classified {
  const steps = input ?? [];
  if (/טסט|מבחן|test/i.test(hint)) return { kind: 'test', confidence: 'sure', reason: 'כתוב "טסט" בשם' };
  if (/גבע|עליות|עליה|hill/i.test(hint)) return { kind: 'hills', confidence: 'sure', reason: 'עליות לפי השם' };

  const total = bookTotals(steps, THRESHOLD);
  // "האצות" anywhere in the name makes every short repeat a stride, whatever its count.
  const stridesByName = /האצ/.test(hint);
  const work = steps.filter((s) => !isStrides(s) && !(stridesByName && isShort(s)));
  const fastReps = work.filter((s): s is Extract<BookStep, { kind: 'reps' }> => s.kind === 'reps' && toneOf(s.effort) === 'f');
  const tempoSec = work.map(sliceOf).filter((x) => x.tone === 't').reduce((a, x) => a + x.sec, 0);
  const fastSec = work.map(sliceOf).filter((x) => x.tone === 'f').reduce((a, x) => a + x.sec, 0);
  const longByName = /ארוכ|long/i.test(hint);

  // The repeats that are the session (not strides): how much of it they are, and how long each.
  // Many history entries carry their structure only in the NAME ("6 × 9 דק׳") — the steps
  // came from a note the parser couldn't draw — so the name's repeats count too.
  const reps = [...work.filter((s): s is Extract<BookStep, { kind: 'reps' }> => s.kind === 'reps'), ...(work.some((s) => s.kind === 'reps') ? [] : repsFromName(hint))];
  const workSec = (r: Extract<BookStep, { kind: 'reps' }>) => (r.work.measure === 'time' ? r.work.value : (r.work.value / 1000) * THRESHOLD);
  const repSec = reps.reduce((a, r) => a + r.count * workSec(r), 0);
  const main = reps.slice().sort((x, y) => y.count * workSec(y) - x.count * workSec(x))[0];
  const repLen = (r: Extract<BookStep, { kind: 'reps' }>) => (r.work.measure === 'time'
    ? (r.work.value >= 120 && r.work.value % 60 === 0 ? `${r.work.value / 60} דק׳` : r.work.value % 60 === 0 ? `${r.work.value / 60} דק׳` : `${r.work.value} שנ׳`) : km(r.work.value));
  const isLong = total.distanceM >= 18000 || total.durationSec >= 100 * 60;

  // Called a long run, it is one — whatever blocks it carries (marathon pace, strides).
  if (longByName) {
    const size = total.distanceM >= 1000 ? km(total.distanceM) : `${mins(total.durationSec)} דק׳`;
    return { kind: 'long', confidence: 'sure', reason: `${size}${tempoSec >= 10 * 60 ? `, עם ${mins(tempoSec)} דק׳ בקצב` : ''} · "ארוכה" בשם` };
  }
  // Repeats that are a real share of the session decide it, even on a big day ("12 × 1 ק״מ").
  if (main && (repSec >= Math.max(total.durationSec, 1) * 0.25 || main.count >= 3)) {
    const tone = main.effort ? toneOf(main.effort) : main.note === 'טמפו' ? 't' : null;
    const longRep = workSec(main) >= 5 * 60;
    const kind: LibraryKind = tone === 'f' ? 'intervals' : tone === 't' ? (longRep ? 'tempo' : 'intervals') : longRep ? 'tempo' : 'intervals';
    const pace = tone === 'f' ? 'בקצב מהיר' : tone === 't' ? 'בקצב סף' : 'בלי קצב רשום';
    return { kind, confidence: tone ? 'sure' : 'likely', reason: `${main.count} × ${repLen(main)} ${pace}${kind === 'tempo' ? ' — חזרות ארוכות = טמפו' : ''}` };
  }
  if (isLong) {
    return { kind: 'long', confidence: 'sure', reason: `${km(total.distanceM)}${tempoSec >= 10 * 60 ? `, עם ${mins(tempoSec)} דק׳ בקצב` : ''} — ארוך מ־18 ק״מ / 100 דק׳` };
  }
  if (tempoSec >= 8 * 60) return { kind: 'tempo', confidence: tempoSec >= 15 * 60 ? 'sure' : 'likely', reason: `${mins(tempoSec)} דק׳ רציפות בקצב סף / מרתון` };
  if (fastSec >= 5 * 60) return { kind: 'intervals', confidence: 'likely', reason: `${mins(fastSec)} דק׳ בקצב מהיר` };
  const strides = steps.some(isStrides) ? ', עם האצות קצרות' : '';
  return { kind: 'easy', confidence: tempoSec + fastSec < 60 ? 'sure' : 'likely', reason: `ריצה קלה${total.durationSec ? ` של ${mins(total.durationSec)} דק׳` : ''}${strides}` };
}

// ── The review list's row (mockup ~/.cache/madregot/book-classify, Ofer 10-23) ─────────────
// "This is really broken": the reason repeated the title, every row said "no pace on record",
// and the drawing sat on the text or came out blank. A row now says what the title does not
// (how much work, what kind of repeats, by pace or only by structure), and its drawing is a
// small block chart of its own: easy ends squeezed short, a rest an empty gap, a wider gap
// between sets, and inside the work, width = time — so 2 דק׳ reads twice as wide as 1 דק׳.

type Rep = Extract<BookStep, { kind: 'reps' }>;
export interface ShapeBar { tone: 'e' | 't' | 'f' | 'gap'; w: number }
export interface RowFacts { facts: string[]; pace: string | null }

const repSecOf = (r: Rep) => (r.work.measure === 'time' ? r.work.value : (r.work.value / 1000) * THRESHOLD);
const restSecOf = (r: Rep) => {
  const l = r.rest?.length as { measure?: string; value?: number } | undefined;
  if (!l?.value) return Math.max(30, repSecOf(r) * 0.5);
  return l.measure === 'distance' ? (l.value / 1000) * 400 : l.value;
};
const repTone = (r: Rep, kind: LibraryKind): 'e' | 't' | 'f' =>
  r.effort ? (toneOf(r.effort) as 'e' | 't' | 'f') : r.note === 'טמפו' ? 't' : kind === 'tempo' ? 't' : kind === 'easy' || kind === 'long' ? 'e' : 'f';
const repsOf = (steps: BookStep[], name: string): Rep[] => {
  const own = steps.filter((s): s is Rep => s.kind === 'reps');
  return own.length ? own : repsFromNameAll(name);
};
/** Every repeat block the name writes, strides included (they are drawn, not counted). */
function repsFromNameAll(name: string): Rep[] {
  const out: Rep[] = [];
  for (const part of name.split('+')) {
    const m = /(\d+)\s*[×x]\s*([\d.]+)\s*(ק״מ|ק"מ|מ׳|מ'|דק׳|דקות|שנ׳|שניות)/.exec(part);
    if (!m) continue;
    const value = Number(m[2]); const unit = m[3];
    const work = /ק/.test(unit[0]) ? { measure: 'distance' as const, value: value * 1000 }
      : /^מ/.test(unit) ? { measure: 'distance' as const, value }
      : /^ד/.test(unit) ? { measure: 'time' as const, value: value * 60 } : { measure: 'time' as const, value };
    out.push({ kind: 'reps', count: Number(m[1]), work, effort: null, rest: null, note: /טמפו/.test(part) ? 'טמפו' : undefined } as Rep);
  }
  return out;
}

export function classifyShape(input: BookStep[] | null | undefined, name: string, kind: LibraryKind): ShapeBar[] {
  const steps = input ?? [];
  const reps = repsOf(steps, name);
  const ends: ShapeBar = { tone: 'e', w: 3 };
  if (!reps.length) {
    // No repeats: the session's own runs, each block by time (a long run is one long bar).
    const runs = steps.filter((s) => s.kind === 'run').map((s) => ({ tone: (s.kind === 'run' && s.role === 'main' ? toneOf(s.effort) : 'e') as ShapeBar['tone'], w: Math.max(1, bookTotals([s], THRESHOLD).durationSec / 60) }));
    return runs.length ? runs : [{ tone: kind === 'tempo' ? 't' : 'e', w: 10 }];
  }
  const bars: ShapeBar[] = [ends, { tone: 'gap', w: 1.2 }];
  // The work blocks share one scale; rests are gaps, scaled down so reps stay readable.
  const unit = Math.max(...reps.map(repSecOf)) / 4;
  reps.forEach((r, bi) => {
    if (bi) bars.push({ tone: 'gap', w: 2 });
    const tone = repTone(r, kind);
    for (let i = 0; i < r.count; i++) {
      if (i) bars.push({ tone: 'gap', w: Math.min(1.2, Math.max(0.6, restSecOf(r) / unit / 3)) });
      bars.push({ tone, w: Math.max(0.5, repSecOf(r) / unit) });
    }
  });
  bars.push({ tone: 'gap', w: 1.2 }, ends);
  return bars;
}

const lenText = (r: Rep) => (r.work.measure === 'time'
  ? (r.work.value >= 60 && r.work.value % 60 === 0 ? `${r.work.value / 60} דק׳` : `${r.work.value} שנ׳`)
  : km(r.work.value));

/** What the row says under its title — never the title again. */
export function classifyFacts(input: BookStep[] | null | undefined, name: string, c: Classified): RowFacts {
  const steps = input ?? [];
  const all = repsOf(steps, name);
  const reps = all.filter((r) => !isStrides(r)).length ? all.filter((r) => !isStrides(r)) : all;
  const facts: string[] = [];
  if (reps.length) {
    const dist = reps.every((r) => r.work.measure === 'distance');
    const work = reps.reduce((a, r) => a + r.count * (dist ? r.work.value : repSecOf(r)), 0);
    facts.push(dist ? `${km(work)} עבודה` : `${mins(work)} דק׳ עבודה`);
    const lens = [...new Set(reps.map(lenText))];
    const short = reps.every((r) => (r.work.measure === 'time' ? r.work.value <= 60 : r.work.value <= 400));
    const minsOnly = reps.every((r) => r.work.measure === 'time' && r.work.value % 60 === 0);
    const span = minsOnly ? (() => { const v = reps.map((r) => r.work.value / 60); return `${Math.min(...v)}–${Math.max(...v)} דק׳`; })() : lens.slice(0, 2).join(' / ');
    facts.push(short ? 'חזרות קצרות' : lens.length === 1 ? `חזרות של ${lens[0]}` : `חזרות של ${span}`);
  } else {
    const t = bookTotals(steps, THRESHOLD);
    if (t.distanceM >= 1000) facts.push(km(t.distanceM));
    else if (t.durationSec) facts.push(`${mins(t.durationSec)} דק׳`);
    if (/ארוכ/.test(name)) facts.push('"ארוכה" בשם');
  }
  if (reps.some((r) => r.note === 'טמפו') || (!reps.length && /טמפו/.test(name))) facts.push('"טמפו" בשם');
  const paced = reps.length ? reps.some((r) => r.effort) : steps.some((s) => s.kind === 'run' && s.effort);
  const tone = c.kind === 'intervals' ? 'בקצב מהיר' : c.kind === 'tempo' ? 'בקצב סף' : c.kind === 'easy' ? 'בקצב קל' : null;
  return { facts, pace: paced ? tone : null };
}
