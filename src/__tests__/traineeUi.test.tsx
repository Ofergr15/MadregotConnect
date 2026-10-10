import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StructureText, clock, km, signedText } from '@/components/trainee/ui';

/**
 * The trainee screens' number atoms: every structure isolated LTR inside a Hebrew name
 * (so "5 × 1 ק״מ" keeps its count on the left), and the signed figures with a real minus.
 */

describe('StructureText', () => {
  it('isolates the count × size, and only that', () => {
    expect(renderToStaticMarkup(<StructureText text="5 × 1 ק״מ" />)).toBe('<bdi><bdi dir="ltr">5 × 1</bdi> ק״מ</bdi>');
    expect(renderToStaticMarkup(<StructureText text="3 × 2 ק״מ טמפו" />)).toBe('<bdi><bdi dir="ltr">3 × 2</bdi> ק״מ טמפו</bdi>');
    expect(renderToStaticMarkup(<StructureText text="6 ק״מ קל" />)).toBe('<bdi><bdi dir="ltr">6</bdi> ק״מ קל</bdi>');
    expect(renderToStaticMarkup(<StructureText text="סדרות 400–1200" />)).toBe('<bdi>סדרות <bdi dir="ltr">400–1200</bdi></bdi>');
    expect(renderToStaticMarkup(<StructureText text="ארוכה" />)).toBe('<bdi>ארוכה</bdi>');
  });
});

describe('numbers', () => {
  it('clock, km, signed', () => {
    expect([clock(245), clock(3065), clock(4000)]).toEqual(['4:05', '51:05', '1:06:40']);
    expect([km(10314), km(2000)]).toEqual(['10.3', '2']);
    expect([signedText(-43, clock), signedText(2), signedText(0)]).toEqual(['−0:43', '+2', '0']);
  });
});
