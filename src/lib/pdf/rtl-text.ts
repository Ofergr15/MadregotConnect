/**
 * Turn the glyphs pdf.js reports for a page back into readable Hebrew lines.
 *
 * ── WHY THIS IS NEEDED AT ALL ───────────────────────────────────────────────
 * The nutrition plan is a PDF, and the report on it was one line: "the nutrition
 * plan isn't readable enough." Measured, that is not a complaint about the
 * viewer's zoom — it is arithmetic. Every nutrition sheet the coach has published
 * is A4 PORTRAIT (595×842) set in 12pt, and fit-to-width on a 390pt phone is
 * 0.66×, so the club reads a 7.9pt document. Zooming past fit fixes the size and
 * replaces it with horizontal panning on every single line, because a PDF page
 * cannot reflow. The only real fix is to stop showing a picture of a page and
 * show the text.
 *
 * And the text is worth showing: unlike the training plan, which is a genuine
 * table, the nutrition sheet is a flat list — a day heading, then a handful of
 * one-line instructions under it. Nothing about it needs a fixed layout.
 *
 * ── WHY IT IS THIS MUCH CODE ────────────────────────────────────────────────
 * pdf.js has no bidi. For a Hebrew PDF produced by Word it reports ONE ITEM PER
 * GLYPH, positioned, in VISUAL order — so `getTextContent()` concatenated gives
 * "ןושארםוי" for "יום ראשון": every word inside out, and no spaces anywhere,
 * because the space between two words is a gap in x rather than a character.
 *
 * So this does two things the format threw away:
 *
 * 1. SPACES, from geometry. Within a word the glyphs abut exactly (x + width ==
 *    the next x, measured); between words there is a visible gap. A gap over
 *    ~0.12em is a space. Nothing else recovers them.
 *
 * 2. LOGICAL ORDER, by run. Reversing the whole line is wrong, and wrong in a way
 *    that changes what the coach said: "אחרי 15*5 שניות" comes back as "5*15",
 *    a different workout. Numbers run left-to-right inside a right-to-left line,
 *    so the line is split into directional runs, the RUNS are reversed, and each
 *    LTR run keeps its own order. A neutral glyph (`*`, `/`, `:`, `-`, `.`)
 *    between two digits belongs to the number, which is exactly what makes
 *    `3:28/3:36/3:45` survive as a pace and not as a mirror of one.
 *
 * Mirrored brackets are undone for the same reason: the glyph a PDF stores at the
 * right end of a visual Hebrew parenthetical is `)`, and it must come back as `(`
 * or every aside in the document reads inverted.
 *
 * The input shape is deliberately NOT pdf.js's — plain numbers, so the whole
 * reconstruction is testable against glyph dumps of the coach's real sheets
 * without a PDF engine. See `src/__tests__/pdfRtlText.test.ts`.
 */

/** One positioned glyph (or short run) as reported for a page. */
export interface Glyph {
  str: string;
  /** Left edge, PDF user space. */
  x: number;
  /** Baseline, PDF user space — bigger is higher up the page. */
  y: number;
  /** Advance width, same units as x. */
  width: number;
  /** Rendered font size, used for the space threshold and heading detection. */
  size: number;
}

/** One reconstructed line of text. */
export interface TextLine {
  text: string;
  /** Baseline of the line — kept so the caller can see paragraph gaps. */
  y: number;
  /** The largest font size on the line: what makes a title a title. */
  size: number;
}

/** Hebrew block. Enough for this club; no other RTL script appears in the plans. */
const RTL = /[֐-׿]/;
const DIGIT = /[0-9]/;
const LATIN = /[A-Za-z]/;

/** The bracket-like glyphs whose left and right forms a PDF can store swapped. */
const MIRROR: Record<string, string> = {
  '(': ')', ')': '(',
  '[': ']', ']': '[',
  '{': '}', '}': '{',
};
const BRACKET = /[()[\]{}]/g;

/** How many brackets in a string are in the wrong place: closed before opened, or never closed. */
function nestingErrors(text: string): number {
  let depth = 0;
  let errors = 0;
  for (const c of text) {
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) errors++;
      else depth--;
    }
  }
  return errors + depth;
}

/**
 * Whether this text's brackets are stored the wrong way round.
 *
 * Which way round they need to go depends on the producer, and the coach has used
 * two. One stores the glyph as DRAWN, so the bracket at the right-hand end of a
 * Hebrew aside is a `)` and has to become `(` when the line is read back in
 * logical order. The other stores the logical character and merely positions it on
 * the right, so mirroring it is what breaks it — that producer turned
 * "(עד 5 גרם פחמימה)" into ")עד 5 גרם פחמימה(".
 *
 * Rather than detect the producer, ask which reading is possible: a closing
 * bracket cannot precede its opener. Whichever of the two nests better wins, and
 * text with no brackets is identical under both so the answer is false. Ties keep
 * the text as read.
 */
function needsMirroring(text: string): boolean {
  return nestingErrors(text.replace(BRACKET, (c) => MIRROR[c])) < nestingErrors(text);
}

type Direction = 'rtl' | 'ltr' | 'neutral';

function directionOf(str: string): Direction {
  if (RTL.test(str)) return 'rtl';
  if (DIGIT.test(str) || LATIN.test(str)) return 'ltr';
  return 'neutral';
}

/**
 * Fraction of the font size that counts as a word gap.
 *
 * 0.12em, from measurement rather than taste: in the coach's sheets glyphs inside
 * a word abut to within a rounding error of zero, and the narrowest real space is
 * ~3pt at 12pt (0.25em). Anything in between is unoccupied territory, so the
 * threshold sits low in it — a missed space corrupts a word, while a spurious one
 * only ever splits one.
 */
const SPACE_GAP_EM = 0.12;

/** Horizontal whitespace between two glyphs that sit side by side on the page. */
function gapBetween(a: Glyph, b: Glyph): number {
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  return right.x - (left.x + left.width);
}

/** Group glyphs into lines by baseline. */
function groupByLine(glyphs: Glyph[], tolerance: number): Glyph[][] {
  const byY = new Map<number, Glyph[]>();
  for (const g of glyphs) {
    if (!g.str) continue;
    // Rounded to `tolerance` so a glyph nudged a fraction of a point off the
    // baseline (superscripts, a different font on the same line) stays on it.
    const key = Math.round(g.y / tolerance) * tolerance;
    const bucket = byY.get(key);
    if (bucket) bucket.push(g);
    else byY.set(key, [g]);
  }
  // Top of the page first, which is reading order for the pages themselves.
  return [...byY.entries()].sort((a, b) => b[0] - a[0]).map(([, line]) => line);
}

/**
 * One line of visually-ordered glyphs → the text as written.
 *
 * Brackets are left exactly as the page stored them — whether they need mirroring
 * is a question about the whole page, and `pageToLines` answers it there.
 *
 * Exported for the tests, which work a line at a time: a failure inside a single
 * line is the whole class of bug here, and finding it in a page-sized diff is
 * needlessly hard.
 */
export function lineToLogicalText(visual: Glyph[]): string {
  const sorted = [...visual].sort((a, b) => a.x - b.x);
  if (sorted.length === 0) return '';

  // Pass 1: resolve the neutrals — the punctuation, which has no direction of its
  // own and takes one from its neighbours.
  //
  // A neutral run goes left-to-right ONLY when it is surrounded by left-to-right
  // on both sides; otherwise it takes the direction of the line, which here is
  // right-to-left. That is Unicode's rule (N1/N2) and it is not a detail: the dash
  // in "(המהיר- 3:28/3:36/3:45)" has a number on one side and a Hebrew word on the
  // other, and a neutral that simply joined whichever run came before it lands
  // that dash after the paces instead of after the word — and the closing bracket
  // of an aside that opened on the previous line, having no left neighbour at all,
  // never gets un-mirrored.
  const dirs: Direction[] = sorted.map((g) => directionOf(g.str));
  for (let i = 0; i < sorted.length; i++) {
    if (dirs[i] !== 'neutral') continue;
    let end = i;
    while (end + 1 < sorted.length && dirs[end + 1] === 'neutral') end++;
    const both = dirs[i - 1] === 'ltr' && dirs[end + 1] === 'ltr';
    for (let j = i; j <= end; j++) dirs[j] = both ? 'ltr' : 'rtl';
    i = end;
  }

  // Pass 2: split into maximal same-direction runs.
  const runs: Array<{ dir: Direction; glyphs: Glyph[] }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.dir === dirs[i]) last.glyphs.push(sorted[i]);
    else runs.push({ dir: dirs[i], glyphs: [sorted[i]] });
  }

  // Pass 3: the runs come out in reverse visual order — the rightmost run is what
  // an RTL line starts with — and an LTR run keeps the order it was drawn in.
  const parts: string[] = [];
  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r];
    const ordered = run.dir === 'ltr' ? run.glyphs : [...run.glyphs].reverse();
    let text = '';
    for (let i = 0; i < ordered.length; i++) {
      const g = ordered[i];
      // The two glyphs are always adjacent ON THE PAGE — `ordered` only changed
      // which of them is emitted first — so the gap between them is measured
      // left-edge to right-edge whichever way round they are.
      const prev = ordered[i - 1];
      if (prev && gapBetween(g, prev) > g.size * SPACE_GAP_EM) text += ' ';
      // An item's OWN characters are never reordered — only the items are. Both
      // producers in the coach's sheets store each item in logical order: the Word
      // export emits one glyph per item (so there is nothing to reorder), and the
      // other emits whole phrases already the right way round. Reversing inside an
      // item turned "תכנית תזונה" into "הנוזת תינכת" on the second of those, which
      // is how this was found. A producer that emitted a visual-order WORD would
      // come out garbled, and the outline's day-heading check would then refuse the
      // extraction and leave the PDF on screen — the honest failure.
      text += g.str;
    }
    // A run boundary is a word boundary on the page just as often as it is inside
    // a run, so the same gap test applies across it.
    const prevRun = runs[r + 1];
    if (prevRun && parts.length) {
      const left = run.glyphs[run.glyphs.length - 1];
      if (gapBetween(left, prevRun.glyphs[0]) > left.size * SPACE_GAP_EM) parts.push(' ');
    }
    parts.push(text);
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Every non-empty line of a page, top to bottom.
 *
 * `tolerance` is in the same units as `y` — 2pt by default, which is under the
 * tightest leading in the sheets (13.5pt) and over the baseline jitter in them.
 */
export function pageToLines(glyphs: Glyph[], tolerance = 2): TextLine[] {
  const lines = groupByLine(glyphs, tolerance)
    .map((line) => ({
      text: lineToLogicalText(line),
      y: Math.max(...line.map((g) => g.y)),
      size: Math.max(...line.map((g) => g.size)),
    }))
    .filter((line) => line.text.length > 0);

  // Whether this page's brackets need mirroring is decided ONCE, over the whole
  // page, and then applied to every line. Per line it cannot be decided at all
  // when an aside runs past a line break — the coach has one that does, and each
  // half on its own carries a single unmatched bracket, which nests exactly as
  // badly either way round. Judged over the page the two halves pair up and the
  // answer is unambiguous. It is also simply more evidence for the same one call.
  const asRead = lines.map((l) => l.text).join('\n');
  if (!needsMirroring(asRead)) return lines;
  return lines.map((l) => ({ ...l, text: l.text.replace(BRACKET, (c) => MIRROR[c]) }));
}
