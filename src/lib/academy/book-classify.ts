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
