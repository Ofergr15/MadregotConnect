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
