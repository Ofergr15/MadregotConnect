/**
 * Direction helpers for numbers and metric expressions shown on a Hebrew page.
 *
 * The app renders inside `dir="rtl"`, and the bidi algorithm's rule N1 says a
 * neutral character between two numbers takes the paragraph's direction. So
 * "20 × 500 מ׳" — number, ×, number — is laid out right-to-left and reaches the
 * screen as "מ׳ 500 × 20": the count and the distance have swapped places. It
 * reads as a plausible workout, which is what makes it dangerous; the same
 * class of silent inversion once turned a chart's time axis backwards.
 *
 * A translated sentence with a range in it inverts the same way: "15.8–16.6"
 * inside Hebrew comes out "16.6–15.8".
 */

/**
 * LEFT-TO-RIGHT ISOLATE / POP DIRECTIONAL ISOLATE, by code point on purpose:
 * the characters themselves are invisible, so a literal one in the source is
 * impossible to see and impossible to grep for.
 */
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

/**
 * Which `dir` a piece of display text needs.
 *
 * A metric expression starts with a digit or a bracket and must be laid out
 * left-to-right as one unit. Anything else — a coach's note, a session name —
 * is real Hebrew and has to keep the page's direction, so it is left to `auto`.
 */
export function textDir(text: string): 'ltr' | 'auto' {
  return /^[\d(]/.test((text || '').trim()) ? 'ltr' : 'auto';
}

/**
 * Wrap a number or a range so it survives being interpolated into a translated
 * sentence, where there is no element to hang a `dir` on.
 */
export function ltr(value: string | number): string {
  return `${LRI}${value}${PDI}`;
}

// ── Numbers inside text a PERSON typed ──────────────────────────────────────
//
// `textDir` above covers a string that IS a metric expression, by looking at its
// first character. That leaves the case it cannot see: an expression sitting in the
// MIDDLE of Hebrew, which is what a coach actually writes. "אינטרוולים 8×1000 מ׳"
// starts with a Hebrew word, so `textDir` correctly returns 'auto' — and the run
// inside it still inverts. Measured in the academy thread: the "8" laid out at
// x=139 and the "1000" at x=100, so the trainee read "1000×8".
//
// `ltr()` is the fix when the app knows where the number is. It does not help here,
// because nobody can wrap a value inside a sentence somebody else is going to type.
// So: find the runs at render time and isolate each one.
//
// The reason a single number is left alone, and "4:00" was never reported: rule W4
// folds a SINGLE `:` `.` `,` or `/` between two digits into the number, making it
// one left-to-right run. Any other separator — `×`, a dash, or the same separator
// with a space beside it — stays neutral, N1 resolves it to R, and the two numbers
// swap. That is why this repo met the bug as "1 / 12" but never as "1/12".

/**
 * A numeric expression: two or more digit groups joined by separators, with the
 * separators allowed to carry spaces.
 *
 * Deliberately requires a SECOND group. A lone number already lays out correctly
 * ("מחכה 3 ימים" measured right), and isolating every digit in the app would be a
 * large change made for no observed defect.
 */
const NUMERIC_RUN = /\d+(?:\s*[×x*:/.,+=~–-]\s*\d+)+/g;

export interface BidiSegment {
  text: string;
  /** True for a run that must be laid out left-to-right regardless of its context. */
  isolate: boolean;
}

/**
 * Split text into plain stretches and numeric runs to isolate.
 *
 * Runs that W4 already saves, like "4:00", are isolated too. Wrapping something
 * that is already left-to-right changes nothing, and the alternative — re-encoding
 * W4's exact conditions here — is a second copy of the bidi algorithm that would
 * have to stay correct.
 */
export function splitNumericRuns(text: string): BidiSegment[] {
  const out: BidiSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(NUMERIC_RUN)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), isolate: false });
    out.push({ text: m[0], isolate: true });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), isolate: false });
  return out;
}
