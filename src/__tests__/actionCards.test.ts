import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import he from '../../messages/he.json';
import en from '../../messages/en.json';
import { actionCardKeys, buildActionCards, type ActionCard } from '@/lib/academy/action-cards';

const tHe = createTranslator({ locale: 'he', messages: he, namespace: 'actionCards' });
const tEn = createTranslator({ locale: 'en', messages: en, namespace: 'actionCards' });
const text = (t: typeof tHe, c: ActionCard) =>
  t.markup(actionCardKeys(c.kind).text, { count: c.count, extra: c.extra, n: (s) => `[${s}]` });

describe('buildActionCards', () => {
  it('orders by urgency: pain, approve, remind, tests, assign', () => {
    const cards = buildActionCards({ unassigned: 7, tests: 65, remind: 5, approve: 3, pain: 10, reply: 6, inFunnel: 60 });
    expect(cards.map((c) => c.kind)).toEqual(['pain', 'approve', 'remind', 'tests', 'assign']);
    expect(cards[0]).toMatchObject({ count: 10, extra: 6, tone: 'red' });
    expect(cards[4]).toMatchObject({ count: 7, extra: 60 });
  });
  it('hides zero (and junk) counts', () => {
    expect(buildActionCards({})).toEqual([]);
    expect(buildActionCards({ pain: 0, approve: 0, remind: -1, tests: NaN, unassigned: 0, inFunnel: 60 })).toEqual([]);
    expect(buildActionCards({ tests: 2 }).map((c) => c.kind)).toEqual(['tests']);
  });
  it('replies alone become a reply card', () => {
    expect(buildActionCards({ reply: 4, approve: 1 }).map((c) => c.kind)).toEqual(['reply', 'approve']);
  });
});

describe('Hebrew copy', () => {
  it('N: the number and its noun inside one isolate', () => {
    const [pain, approve, remind, tests, assign] = buildActionCards({ pain: 10, reply: 6, approve: 3, remind: 5, tests: 65, unassigned: 7, inFunnel: 60 });
    expect(text(tHe, pain)).toBe('[10 רצים] כתבו על כאב, ועוד [6 שאלות] מחכות לתשובה');
    expect(text(tHe, approve)).toBe('[3 אנשים] מחכים לאישור');
    expect(text(tHe, remind)).toBe('[5 אנשים] אושרו ועוד לא פתחו את האפליקציה');
    expect(text(tHe, tests)).toBe('[65 טסטים] מחכים לאישור שלך');
    expect(text(tHe, assign)).toBe('[7 מתאמנים] בלי מאמן · [60 נרשמים] עוד בתהליך הכניסה');
  });
  it('1: singular words, no digit', () => {
    const [pain, approve, remind, tests, assign] = buildActionCards({ pain: 1, reply: 1, approve: 1, remind: 1, tests: 1, unassigned: 1, inFunnel: 1 });
    expect(text(tHe, pain)).toBe('רץ אחד כתב על כאב, ועוד שאלה אחת מחכה לתשובה');
    expect(text(tHe, approve)).toBe('אדם אחד מחכה לאישור');
    expect(text(tHe, remind)).toBe('אדם אחד אושר ועוד לא פתח את האפליקציה');
    expect(text(tHe, tests)).toBe('טסט אחד מחכה לאישור שלך');
    expect(text(tHe, assign)).toBe('מתאמן אחד בלי מאמן · נרשם אחד עוד בתהליך הכניסה');
  });
  it('drops the second clause when its number is 0', () => {
    const [pain] = buildActionCards({ pain: 2 });
    expect(text(tHe, pain)).toBe('[2 רצים] כתבו על כאב');
    const [assign] = buildActionCards({ unassigned: 3 });
    expect(text(tHe, assign)).toBe('[3 מתאמנים] בלי מאמן');
  });
  it('every kind has a title, text and CTA in both locales', () => {
    for (const kind of ['pain', 'reply', 'approve', 'remind', 'tests', 'assign'] as const) {
      for (const t of [tHe, tEn]) {
        const k = actionCardKeys(kind);
        expect(t(k.title)).not.toMatch(/actionCards/);
        expect(t(k.cta)).not.toMatch(/actionCards/);
        expect(text(t, { kind, count: 2, extra: 0, tone: 'brand' })).toContain('[2 ');
      }
    }
  });
});
