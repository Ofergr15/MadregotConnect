import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NumberRuns, StructureText, clock, km, signedText } from '@/components/trainee/ui';

/**
 * The trainee screens' number atoms: every structure isolated LTR inside a Hebrew name
 * (so "5 × 1 ק״מ" reads five times one: the repeat in the line's own order, each number LTR), and the signed figures with a real minus.
 */

describe('StructureText', () => {
  it('isolates the count × size, and only that', () => {
    expect(renderToStaticMarkup(<StructureText text="5 × 1 ק״מ" />)).toBe('<bdi><bdi dir="ltr">5</bdi> × <bdi dir="ltr">1</bdi> ק״מ</bdi>');
    expect(renderToStaticMarkup(<StructureText text="3 × 2 ק״מ טמפו" />)).toBe('<bdi><bdi dir="ltr">3</bdi> × <bdi dir="ltr">2</bdi> ק״מ טמפו</bdi>');
    expect(renderToStaticMarkup(<StructureText text="6 ק״מ קל" />)).toBe('<bdi>קל <bdi dir="ltr">6</bdi> ק״מ</bdi>');
    expect(renderToStaticMarkup(<StructureText text="סדרות 400–1200" />)).toBe('<bdi>סדרות <bdi dir="ltr">400–1200</bdi></bdi>');
    expect(renderToStaticMarkup(<StructureText text="ארוכה" />)).toBe('<bdi>ארוכה</bdi>');
    // A repeat with a pace range keeps each side whole and LTR.
    expect(renderToStaticMarkup(<StructureText text="6 × 800 ב־3:50–3:55" />)).toBe('<bdi><bdi dir="ltr">6</bdi> × <bdi dir="ltr">800</bdi> ב־<bdi dir="ltr">3:50–3:55</bdi></bdi>');
  });
});

describe('NumberRuns (a run\'s own name on its page)', () => {
  it('isolates the number runs and keeps the words where they were', () => {
    expect(renderToStaticMarkup(<NumberRuns text="5 × 1 ק״מ" />)).toBe('<bdi><bdi dir="ltr">5</bdi> × <bdi dir="ltr">1</bdi> ק״מ</bdi>');
    // No word-first reordering here, unlike the session titles.
    expect(renderToStaticMarkup(<NumberRuns text="6 ק״מ קל" />)).toBe('<bdi><bdi dir="ltr">6</bdi> ק״מ קל</bdi>');
    expect(renderToStaticMarkup(<NumberRuns text="Morning Run" />)).toBe('<bdi>Morning Run</bdi>');
  });
});

describe('numbers', () => {
  it('clock, km, signed', () => {
    expect([clock(245), clock(3065), clock(4000)]).toEqual(['4:05', '51:05', '1:06:40']);
    expect([km(10314), km(2000)]).toEqual(['10.3', '2']);
    expect([signedText(-43, clock), signedText(2), signedText(0)]).toEqual(['−0:43', '+2', '0']);
  });
});

describe('wordFirstTitle (trainee screens: "קל 6 ק״מ")', () => {
  it('puts the word first on a steady run, and leaves reps and everything else alone', async () => {
    const { wordFirstTitle } = await import('@/lib/academy/title-order');
    expect(wordFirstTitle('6 ק״מ קל')).toBe('קל 6 ק״מ');
    expect(wordFirstTitle('16 ק״מ ארוכה')).toBe('ארוכה 16 ק״מ');
    expect(wordFirstTitle('10.5 ק״מ קל')).toBe('קל 10.5 ק״מ');
    expect(wordFirstTitle('קל 6 ק״מ')).toBe('קל 6 ק״מ');
    expect(wordFirstTitle('5 × 1 ק״מ')).toBe('5 × 1 ק״מ');
    expect(wordFirstTitle('8 ק״מ קל + האצות')).toBe('8 ק״מ קל + האצות');
  });
});
