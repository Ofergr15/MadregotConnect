import { describe, it, expect } from 'vitest';
import { lineToLogicalText, pageToLines, type Glyph } from '@/lib/pdf/rtl-text';

/**
 * Reconstructing the coach's Hebrew out of the glyphs pdf.js reports.
 *
 * Every fixture below is a REAL line, dumped verbatim from a nutrition sheet she
 * published — coordinates and all. That matters more than usual here: the whole
 * class of bug in this file is silent. A reversed number or a missing space does
 * not throw, it just tells an athlete to do a different workout, and only a real
 * page's geometry can catch that.
 */

/**
 * `אחרי 15*5 שניות ג׳ל.` — one glyph per item, visual order, no spaces anywhere.
 * The reps are why whole-line reversal is not an option: naively reversed this
 * line says `5*15`, which is a different session.
 */
const gelAfterReps: Glyph[] = [
  { str: "א", x: 553.42, y: 686.4, width: 5.77, size: 12 },
  { str: "ח", x: 547.7, y: 686.4, width: 5.72, size: 12 },
  { str: "ר", x: 542.08, y: 686.4, width: 5.63, size: 12 },
  { str: "י", x: 538.88, y: 686.4, width: 3.2, size: 12 },
  { str: "5", x: 529.88, y: 686.4, width: 6, size: 12 },
  { str: "*", x: 523.88, y: 686.4, width: 6, size: 12 },
  { str: "15", x: 511.88, y: 686.4, width: 12, size: 12 },
  { str: "ש", x: 501.56, y: 686.4, width: 7.32, size: 12 },
  { str: "נ", x: 497.9, y: 686.4, width: 3.66, size: 12 },
  { str: "י", x: 494.7, y: 686.4, width: 3.2, size: 12 },
  { str: "ו", x: 491.35, y: 686.4, width: 3.35, size: 12 },
  { str: "ת", x: 485.36, y: 686.4, width: 6, size: 12 },
  { str: "ג", x: 478.33, y: 686.4, width: 4.02, size: 12 },
  { str: "׳", x: 475.83, y: 686.4, width: 2.51, size: 12 },
  { str: "ל", x: 470.65, y: 686.4, width: 5.18, size: 12 },
  { str: ".", x: 467.64, y: 686.4, width: 3, size: 12 },
];

/**
 * `בסיום הק״מ האחרון (המהיר- 3:28/3:36/3:45) ג׳ל.` — an aside with a dash between a
 * Hebrew word and a pace, and the paces arriving as one already-LTR item. The
 * brackets are stored as DRAWN, so they read inverted until mirrored.
 */
const paceAside: Glyph[] = [
  { str: "ב", x: 553.74, y: 497.76, width: 5.46, size: 12 },
  { str: "ס", x: 548.04, y: 497.76, width: 5.7, size: 12 },
  { str: "י", x: 544.84, y: 497.76, width: 3.2, size: 12 },
  { str: "ו", x: 541.5, y: 497.76, width: 3.35, size: 12 },
  { str: "ם", x: 535.41, y: 497.76, width: 6.08, size: 12 },
  { str: "ה", x: 526.75, y: 497.76, width: 5.65, size: 12 },
  { str: "ק", x: 521.07, y: 497.76, width: 5.69, size: 12 },
  { str: "״", x: 516.61, y: 497.76, width: 4.46, size: 12 },
  { str: "מ", x: 510.78, y: 497.76, width: 5.82, size: 12 },
  { str: "ה", x: 502.13, y: 497.76, width: 5.65, size: 12 },
  { str: "א", x: 496.35, y: 497.76, width: 5.77, size: 12 },
  { str: "ח", x: 490.63, y: 497.76, width: 5.72, size: 12 },
  { str: "ר", x: 485.01, y: 497.76, width: 5.63, size: 12 },
  { str: "ו", x: 481.66, y: 497.76, width: 3.35, size: 12 },
  { str: "ן", x: 478.37, y: 497.76, width: 3.29, size: 12 },
  { str: ")", x: 471.38, y: 497.76, width: 4, size: 12 },
  { str: "ה", x: 465.72, y: 497.76, width: 5.65, size: 12 },
  { str: "מ", x: 459.89, y: 497.76, width: 5.82, size: 12 },
  { str: "ה", x: 454.24, y: 497.76, width: 5.65, size: 12 },
  { str: "י", x: 451.04, y: 497.76, width: 3.2, size: 12 },
  { str: "ר", x: 445.41, y: 497.76, width: 5.63, size: 12 },
  { str: "-", x: 441.42, y: 497.76, width: 4, size: 12 },
  { str: "3:28/3:36/3:45", x: 367.75, y: 497.76, width: 70.67, size: 12 },
  { str: "(", x: 363.75, y: 497.76, width: 4, size: 12 },
  { str: "ג", x: 356.73, y: 497.76, width: 4.02, size: 12 },
  { str: "׳", x: 354.23, y: 497.76, width: 2.51, size: 12 },
  { str: "ל", x: 349.04, y: 497.76, width: 5.18, size: 12 },
  { str: ".", x: 346.04, y: 497.76, width: 3, size: 12 },
];

/**
 * The other producer in her sheets: whole phrases, already in logical order, merely
 * positioned right-to-left. Reversing inside an item turns `תכנית תזונה` into
 * `הנוזת תינכת`, which is how that difference was found.
 */
const secondProducerTitle: Glyph[] = [
  { str: "תכנית תזונה", x: 493.95, y: 746.97, width: 65.7, size: 16 },
  { str: "שבוע", x: 461.2, y: 746.97, width: 28.77, size: 16 },
  { str: "19.7", x: 396.17, y: 746.97, width: 28, size: 16 },
  { str: "-", x: 424.17, y: 746.97, width: 5.33, size: 16 },
  { str: "26.7", x: 429.43, y: 746.97, width: 28, size: 16 },
];

describe('lineToLogicalText', () => {
  it('recovers spaces from the gaps and keeps a number left-to-right', () => {
    expect(lineToLogicalText(gelAfterReps)).toBe('אחרי 15*5 שניות ג׳ל.');
  });

  it('puts the dash after the word it follows, not after the paces', () => {
    // Brackets are still as the page stored them — that call belongs to the page.
    expect(lineToLogicalText(paceAside)).toBe('בסיום הק״מ האחרון )המהיר- 3:28/3:36/3:45( ג׳ל.');
  });

  it('never reorders the characters inside an item', () => {
    expect(lineToLogicalText(secondProducerTitle)).toBe('תכנית תזונה שבוע 19.7-26.7');
  });

  it('is empty for a line of empty items', () => {
    expect(lineToLogicalText([])).toBe('');
  });

  it('does not order glyphs by the order they were reported', () => {
    // pdf.js makes no promise about item order within a page, and the whole
    // reconstruction is geometric — so a shuffled dump must read the same.
    const shuffled = [...gelAfterReps].reverse();
    expect(lineToLogicalText(shuffled)).toBe(lineToLogicalText(gelAfterReps));
  });
});

describe('pageToLines', () => {
  it('mirrors the brackets when that is the only reading that nests', () => {
    expect(pageToLines(paceAside).map((l) => l.text)).toEqual([
      'בסיום הק״מ האחרון (המהיר- 3:28/3:36/3:45) ג׳ל.',
    ]);
  });

  it('leaves brackets alone on a page that stored them logically', () => {
    // Producer two draws `(` at the right of a Hebrew aside but stores the logical
    // character, so mirroring is what would break it.
    const aside: Glyph[] = [
      { str: '(עד 5 גרם', x: 400, y: 700, width: 50, size: 12 },
      { str: 'פחמימה)', x: 350, y: 700, width: 45, size: 12 },
    ];
    expect(pageToLines(aside)[0].text).toBe('(עד 5 גרם פחמימה)');
  });

  it('decides mirroring over the whole page, so an aside may span a line break', () => {
    // Each half carries one unmatched bracket and nests exactly as badly either way
    // round; only the pair settles it.
    const wrapped: Glyph[] = [
      { str: 'ורק אך)', x: 400, y: 700, width: 40, size: 12 },
      { str: 'לזה מעבר(', x: 400, y: 680, width: 50, size: 12 },
    ];
    const text = pageToLines(wrapped).map((l) => l.text);
    expect(text[0]).toContain('(');
    expect(text[1]).toContain(')');
  });

  it('reads lines top of the page first and reports the largest size on each', () => {
    const page: Glyph[] = [
      { str: 'שני', x: 500, y: 600, width: 20, size: 12 },
      { str: 'ראשון', x: 500, y: 700, width: 30, size: 16 },
    ];
    expect(pageToLines(page)).toEqual([
      { text: 'ראשון', y: 700, size: 16 },
      { text: 'שני', y: 600, size: 12 },
    ]);
  });

  it('keeps glyphs nudged off the baseline on their own line', () => {
    const page: Glyph[] = [
      { str: 'ג', x: 500, y: 700, width: 6, size: 12 },
      { str: '׳', x: 497, y: 700.4, width: 3, size: 12 },
      { str: 'ל', x: 492, y: 700, width: 5, size: 12 },
    ];
    expect(pageToLines(page).map((l) => l.text)).toEqual(['ג׳ל']);
  });
});
