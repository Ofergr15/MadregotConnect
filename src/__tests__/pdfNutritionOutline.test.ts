import { describe, it, expect } from 'vitest';
import { nutritionOutline } from '@/lib/pdf/nutrition-outline';
import type { TextLine } from '@/lib/pdf/rtl-text';

/**
 * Grouping the coach's nutrition sheet into days, and — just as important —
 * refusing to when the extraction does not look like one of her sheets.
 *
 * The refusal is the case worth testing hardest. Everything this produces is shown
 * to the club as their plan, so a half-outline built out of a scan or a mangled
 * extraction is worse than the PDF nobody could read: it looks authoritative. The
 * text itself is passed through verbatim, so there is nothing to test about the
 * content, only about the shape.
 */

/** A body line at the size the sheets use. */
const line = (text: string, size = 12): TextLine => ({ text, y: 0, size });

/** The shape of a published sheet, trimmed to what the assertions need. */
const sheet: TextLine[] = [
  line('תכנית תזונה 13.9-19.9', 16),
  line('יום ראשון-'),
  line('אימון 1-'),
  line('לפני האימון ג׳ל.'),
  line('אימון 2-'),
  line('כל 25 דקות ג׳ל.'),
  line('יום שני- כמו בשבוע שעבר-'),
  line('ארוחת בוקר רגילה.'),
  line('יום שלישי-'),
  line('אין הנחיות מיוחדות.'),
];

describe('nutritionOutline', () => {
  it('reads the title, the days and the sub-headings inside a day', () => {
    const outline = nutritionOutline(sheet)!;
    expect(outline.title).toBe('תכנית תזונה 13.9-19.9');
    expect(outline.sections.map((s) => s.day)).toEqual(['ראשון', 'שני', 'שלישי']);
    expect(outline.sections[0].lines).toEqual([
      { text: 'אימון 1-', kind: 'sub' },
      { text: 'לפני האימון ג׳ל.', kind: 'text' },
      { text: 'אימון 2-', kind: 'sub' },
      { text: 'כל 25 דקות ג׳ל.', kind: 'text' },
    ]);
  });

  /** `יום שני- כמו בשבוע שעבר-` carries its first instruction on the heading line. */
  it('keeps what follows the day name on the heading line', () => {
    const outline = nutritionOutline(sheet)!;
    expect(outline.sections[1].lines[0]).toEqual({ text: 'כמו בשבוע שעבר-', kind: 'sub' });
  });

  it('keeps lines before the first day as notes for the whole week', () => {
    const outline = nutritionOutline([line('שתו מים.'), ...sheet.slice(1)])!;
    expect(outline.title).toBeNull();
    expect(outline.sections[0]).toEqual({ day: null, lines: [{ text: 'שתו מים.', kind: 'text' }] });
  });

  it('does not promote a first line that is set at body size', () => {
    const outline = nutritionOutline([line('תכנית תזונה 13.9-19.9'), ...sheet.slice(1)])!;
    expect(outline.title).toBeNull();
    expect(outline.sections[0].lines[0].text).toBe('תכנית תזונה 13.9-19.9');
  });

  /**
   * The one place the sheets' own line breaks lie: the coach's longest instruction
   * reaches the left margin of the text block and continues below it.
   */
  it('rejoins an instruction the page wrapped', () => {
    const wrapped = [
      ...sheet,
      line('לאורך האימון 90 גרם פחמימה ממשקה- יכולים לחלק את זה ל2 בקבוקים או'),
      line('לבקבוק אחד.'),
    ];
    const last = nutritionOutline(wrapped)!.sections.at(-1)!.lines.at(-1)!;
    expect(last.text).toBe('לאורך האימון 90 גרם פחמימה ממשקה- יכולים לחלק את זה ל2 בקבוקים או לבקבוק אחד.');
  });

  it('does not join a short line to the one above it', () => {
    const outline = nutritionOutline([...sheet, line('תכינו את הג׳לים')])!;
    expect(outline.sections.at(-1)!.lines.map((l) => l.text)).toEqual([
      'אין הנחיות מיוחדות.',
      'תכינו את הג׳לים',
    ]);
  });

  it('never swallows a day heading into the line above it', () => {
    const outline = nutritionOutline([
      line('תכנית תזונה', 16),
      line('הנחיה ארוכה שנגמרת באמצע המשפט בלי נקודה בסוף השורה הזאת ולכן'),
      line('יום ראשון-'),
      line('ג׳ל אחד.'),
      line('יום שני-'),
      line('ג׳ל אחד.'),
      line('ג׳ל שני.'),
      line('ג׳ל שלישי.'),
      line('ג׳ל רביעי.'),
    ])!;
    expect(outline.sections.map((s) => s.day)).toEqual([null, 'ראשון', 'שני']);
  });

  /**
   * A long instruction that ends in a dash is a sub-heading only by accident of
   * punctuation; the length bound is what keeps it an instruction.
   */
  it('does not promote a long line that happens to end in a dash', () => {
    const long = 'לאורך האימון 90 גרם פחמימה ממשקה ועוד ג׳ל אחד בסיום כל שעה-';
    const outline = nutritionOutline([...sheet, line(long)])!;
    expect(outline.sections.at(-1)!.lines.at(-1)).toEqual({ text: long, kind: 'text' });
  });

  it('refuses a page that names too few days', () => {
    expect(nutritionOutline(sheet.slice(0, 6))).toBeNull();
  });

  it('refuses a page with days but almost nothing under them', () => {
    expect(nutritionOutline([
      line('יום ראשון-'),
      line('ג׳ל.'),
      line('יום שני-'),
      line('ג׳ל.'),
    ])).toBeNull();
  });

  it('refuses an empty extraction — an image-only or scanned sheet', () => {
    expect(nutritionOutline([])).toBeNull();
  });
});
