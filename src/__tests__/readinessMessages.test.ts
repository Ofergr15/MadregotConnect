import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import he from '../../messages/he.json';
import en from '../../messages/en.json';
import { FORM_BANDS } from '@/lib/academy/form-bands';
import { RECORD_BUCKETS } from '@/lib/academy/readiness-board';

/**
 * The `readiness` namespace (the coach's C1/C2 and the pace gate): every key renders in
 * both languages for both genders, the keys the code builds (chips per band, records per
 * bucket) all exist, and the Hebrew keeps the RTL rules — every number placeholder inside
 * <m>, no arrow between two values.
 */

type Tree = { [k: string]: string | Tree };
const flat = (tree: Tree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : flat(v, `${prefix}${k}.`)));
const tags = { m: (c: unknown) => c, b: (c: unknown) => c, bdi: (c: unknown) => c, s: (c: unknown) => c };
const PARAMS = {
  n: 3, name: 'Yoav', form: '−9', word: 'שומר', load: 330, done: 3, planned: 5, effort: '6.5', rhr: 51, sleep: '7:12',
  range: '46–50', sec: 4, to: '4:01', from: '4:05', kinds: 'החזרות', reasons: 'x', weeks: 8, when: 'היום', race: '10 ק״מ',
  heavy: 'yes', pain: 'no', provider: 'garmin',
};

describe('readiness messages', () => {
  for (const [lang, messages] of [['he', he], ['en', en]] as const) {
    const t = createTranslator({ locale: lang, messages: messages as any, namespace: 'readiness' as any });
    it(`${lang}: every key renders for both genders`, () => {
      const broken: string[] = [];
      for (const [key] of flat((messages as unknown as { readiness: Tree }).readiness)) {
        for (const gender of ['female', 'male']) {
          const out = t.rich(key as any, { ...PARAMS, gender, ...tags } as any);
          const text = Array.isArray(out) ? out.join('') : String(out);
          if (!text || text === `readiness.${key}` || text.includes('{')) broken.push(`${key} (${gender})`);
        }
      }
      expect(broken).toEqual([]);
    });

    it(`${lang}: the keys the code builds exist`, () => {
      const r = (messages as any).readiness;
      for (const b of FORM_BANDS) expect(r.chip[b.key], b.key).toBeTruthy();
      for (const b of RECORD_BUCKETS) expect(r.highlight.pr[b.key], b.key).toBeTruthy();
      for (const k of ['veryTired', 'rhr', 'pain', 'feel']) expect(r.reason[k]).toBeTruthy();
      for (const k of ['room', 'inRange', 'warn', 'noPlan']) expect(r.detail.say[k]).toBeTruthy();
    });
  }

  it('the gendered words differ in Hebrew', () => {
    const t = createTranslator({ locale: 'he', messages: he as any });
    expect(t('readiness.chip.fresh' as any, { gender: 'female' } as any)).toBe('רעננה');
    expect(t('readiness.chip.maintain' as any, { gender: 'male' } as any)).toBe('שומר');
    expect(t('readiness.alert.write' as any, { gender: 'male' } as any)).toBe('לכתוב לו');
  });

  it('keeps the RTL rules', () => {
    for (const [key, text] of flat((he as unknown as { readiness: Tree }).readiness)) {
      expect([key, /[←→]/.test(text)]).toEqual([key, false]);
      if (key === 'row') continue; // an aria-label, read aloud, never laid out
      const outside = text.replace(/<m>.*?<\/m>/g, '');
      expect([key, /\{(n|form|load|done|planned|effort|rhr|sleep|range|sec|to|from)\}/.test(outside)]).toEqual([key, false]);
    }
  });

  it('the mockup\'s sentences, word for word', () => {
    const t = createTranslator({ locale: 'he', messages: he as any, namespace: 'readiness' as any });
    const plain = (out: unknown) => (Array.isArray(out) ? out.join('') : String(out));
    expect(plain(t.rich('alert.both' as any, { ...tags, name: 'Yoav', gender: 'male', n: 3 } as any)))
      .toBe('⚠️ Yoav עייף מאוד, והדופק במנוחה מעל הטווח 3 בקרים');
    expect(t('alert.held' as any, { gender: 'male' } as any)).toBe('הצעת הקצב שלו הושהתה. מומלץ שבוע קל לפני שממשיכים לבנות.');
    expect(plain(t.rich('detail.say.room' as any, { ...tags, gender: 'male', load: 330, form: '−3', word: 'שומר' } as any)))
      .toBe('אם ירוץ את מה שתכננת עד סוף השבוע הבא, עומס 330 בשבוע הבא, הרעננות תהיה בערך −3: שומר ✓. יש מקום להוסיף קצת עומס.');
    expect(plain(t.rich('gate.form' as any, { ...tags, gender: 'male', form: '−9', word: 'שומר' } as any))).toBe('לא עייף מדי (−9, שומר)');
    expect(plain(t.rich('highlight.pr.1k' as any, { ...tags, when: 'היום' } as any))).toBe('🏅 שיא ל־1 ק״מ היום');
    expect(plain(t.rich('highlight.noRun' as any, { ...tags, gender: 'male', n: 9 } as any))).toBe('לא רץ 9 ימים');
  });
});
