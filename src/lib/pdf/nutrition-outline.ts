import type { TextLine } from './rtl-text';

/**
 * The nutrition sheet's lines → the day-by-day outline the app renders instead of
 * a picture of an A4 page. See `rtl-text.ts` for why the text is worth having and
 * how it is recovered.
 *
 * The shape is the coach's, not an invention: every sheet published so far is a
 * title, then a run of `יום <day>-` headings, each followed by one-line
 * instructions, with the occasional sub-heading (`אימון 2-`, `אופציה 1-`,
 * `שעה ראשונה-`) grouping a few lines under a day. So that is all this produces —
 * no parsing of grams or times, nothing that could be wrong about the content. The
 * text is passed through verbatim; only the grouping is inferred.
 *
 * Returns null rather than a half-outline when the page does not look like one of
 * those sheets — a scan, an image-only export, a form the coach filled in by hand.
 * The caller then shows the PDF exactly as before, which is the honest outcome: a
 * plan is not the place to display a confident guess.
 */

/** The seven day names as the coach writes them. */
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;

/** `יום שלישי-` / `יום שבת -` / `יום שני- כמו בשבוע שעבר-`. */
const DAY_HEADING = new RegExp(`^יום\\s+(${DAY_NAMES.join('|')})\\s*[-–:]?\\s*`);

/**
 * A line that groups the ones under it rather than instructing on its own. Ends in
 * a dash and is short: `אימון 2-`, `אופציה 1-`, `למי שלא עושה אימון כפול-`. The
 * length bound is what keeps a real instruction that happens to end in a dash from
 * being promoted — measured against the published sheets, every sub-heading is
 * under 45 characters and every instruction that ends in a dash is longer.
 */
const SUB_HEADING_MAX = 45;

export interface OutlineLine {
  text: string;
  /** 'sub' is a grouping line inside a day; 'text' is an instruction. */
  kind: 'sub' | 'text';
}

export interface OutlineSection {
  /**
   * The day, without its dash — or null for the lines that appear before the first
   * day heading, which are the coach's notes for the whole week.
   */
  day: string | null;
  lines: OutlineLine[];
}

export interface NutritionOutline {
  /** The sheet's own title line, when it has one set larger than the body. */
  title: string | null;
  sections: OutlineSection[];
}

/**
 * The floor for calling an extraction usable.
 *
 * Two days and six instructions: below that the text is either not a nutrition
 * sheet or came back too damaged to read, and in both cases the PDF is the better
 * answer. Two rather than seven because a light week genuinely has few days in it
 * — the sheet for 19.7 names five.
 */
const MIN_DAYS = 2;
const MIN_LINES = 6;

/**
 * A long line that ends mid-sentence is one instruction the page had to wrap, and
 * the two halves are joined back together.
 *
 * Both conditions matter. LONG, because the wrap only happens at the width of the
 * text block: the coach's longest instruction runs to the left margin and continues
 * on the next line, while "תכינו את הג׳לים J" ends in a letter and is simply short.
 * And ENDING MID-SENTENCE — no full stop, dash or closing bracket — because every
 * deliberate line in these sheets closes itself.
 */
const WRAP_MIN_LENGTH = 60;
const LINE_ENDS = /[.!?:)\-–]$/;

/** Rejoin the halves of instructions the page wrapped. */
function unwrap(lines: TextLine[]): TextLine[] {
  const out: TextLine[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const wrapped = prev
      && prev.text.length >= WRAP_MIN_LENGTH
      && !LINE_ENDS.test(prev.text)
      && !DAY_HEADING.test(line.text);
    if (wrapped) out[out.length - 1] = { ...prev, text: `${prev.text} ${line.text}`.trim() };
    else out.push(line);
  }
  return out;
}

/** Whether a line is set large enough, relative to the body, to be the title. */
const TITLE_SIZE_RATIO = 1.15;

function medianSize(lines: TextLine[]): number {
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] || 0;
}

/**
 * Build the outline, or null when this does not read like a nutrition sheet.
 *
 * `lines` is every page's lines in reading order, already reconstructed.
 */
export function nutritionOutline(rawLines: TextLine[]): NutritionOutline | null {
  if (rawLines.length === 0) return null;
  const body = medianSize(rawLines);
  const lines = unwrap(rawLines);

  let title: string | null = null;
  const sections: OutlineSection[] = [];
  let current: OutlineSection | null = null;

  for (const [index, line] of lines.entries()) {
    const text = line.text.trim();
    if (!text) continue;

    // The title can only be the first line, and only if it is actually set bigger
    // than the body. A sheet whose title is the same size as everything else keeps
    // it as ordinary text rather than having one line silently promoted.
    if (index === 0 && !DAY_HEADING.test(text) && line.size >= body * TITLE_SIZE_RATIO) {
      title = text;
      continue;
    }

    const day = text.match(DAY_HEADING);
    if (day) {
      current = { day: day[1], lines: [] };
      sections.push(current);
      // `יום שני- כמו בשבוע שעבר-` carries its first instruction on the heading
      // line; keeping the remainder means that instruction is not lost.
      const rest = text.slice(day[0].length).trim();
      if (rest) current.lines.push(classify(rest));
      continue;
    }

    // Anything before the first day heading is a note about the whole week.
    if (!current) {
      current = { day: null, lines: [] };
      sections.push(current);
    }
    current.lines.push(classify(text));
  }

  const days = sections.filter((s) => s.day).length;
  const instructions = sections.reduce((sum, s) => sum + s.lines.length, 0);
  if (days < MIN_DAYS || instructions < MIN_LINES) return null;

  return { title, sections };
}

function classify(text: string): OutlineLine {
  const isSub = /[-–:]$/.test(text) && text.length <= SUB_HEADING_MAX;
  return { text, kind: isSub ? 'sub' : 'text' };
}
