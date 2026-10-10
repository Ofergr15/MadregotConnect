import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import he from '../../messages/he.json';
import en from '../../messages/en.json';
import { FORM_BANDS, allFormSentenceKeys, rampWord } from '@/lib/academy/form-bands';
import { verdictKey } from '@/lib/academy/normal-range';

/**
 * The `trainee` namespace: every key the engine's pure modules return exists in both
 * languages and renders (the gendered ones for both genders), and the copy keeps the
 * RTL rules — numbers inside <m>, never an arrow between two values.
 */

type Tree = { [k: string]: string | Tree };
const flat = (tree: Tree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : flat(v, `${prefix}${k}.`)));

const engineKeys = [
  ...FORM_BANDS.flatMap(b => [b.wordKey, b.longKey, b.meaningKey]),
  ...[9, 6, 2, -3].map(r => rampWord(r).wordKey), rampWord(-3, { easyWeek: true }).wordKey, 'trainee.ramp.tooFastNote',
  ...allFormSentenceKeys(),
  ...(['veryLittle', 'less', 'normal', 'more'] as const).map(v => verdictKey('sleep', v)),
  ...(['high', 'bitHigh', 'normal', 'low'] as const).map(v => verdictKey('rhr', v)),
  ...['warmup', 'work', 'jog', 'cooldown', 'run'].map(k => `trainee.loadSheet.part.${k}`),
  ...['pace', 'pace_avg', 'hr', 'none', 'not_run'].map(k => `trainee.loadSheet.source.${k}`),
  'trainee.range.learning', 'trainee.range.yours',
];

const PARAMS = { gender: 'female', km: 2, pace: '5:40', count: 5, dist: '1000', time: '2:00', n: 4, range: '46–50' };
const tags = { m: (c: unknown) => c, b: (c: unknown) => c };

describe('trainee messages', () => {
  for (const [name, messages] of [['he', he], ['en', en]] as const) {
    const t = createTranslator({ locale: name, messages: messages as any });

    it(`${name}: every key the engine returns exists and renders, for both genders`, () => {
      const missing: string[] = [];
      for (const key of engineKeys) {
        for (const gender of ['female', 'male']) {
          const out = t.rich(key as any, { ...PARAMS, gender, ...tags } as any);
          const text = Array.isArray(out) ? out.join('') : String(out);
          if (!text || text === key || text.includes('{')) missing.push(`${key} (${gender})`);
        }
      }
      expect(missing).toEqual([]);
    });
  }

  it('he and en have the same keys', () => {
    const keys = (m: unknown) => flat((m as { trainee: Tree }).trainee).map(([k]) => k).sort();
    expect(keys(en)).toEqual(keys(he));
  });

  it('keeps the RTL rules: no arrows, every number placeholder inside <m>', () => {
    for (const [key, text] of flat((he as unknown as { trainee: Tree }).trainee)) {
      expect([key, /[←→]/.test(text)]).toEqual([key, false]);
      const outside = text.replace(/<m>.*?<\/m>/g, '');
      expect([key, /\{(km|pace|count|dist|time|range)\}/.test(outside)]).toEqual([key, false]);
    }
  });

  it('the gendered words differ by gender in Hebrew', () => {
    const t = createTranslator({ locale: 'he', messages: he as any });
    expect(t('trainee.bands.fresh.long' as any, { gender: 'female' } as any)).toBe('רעננה');
    expect(t('trainee.bands.fresh.long' as any, { gender: 'male' } as any)).toBe('רענן');
  });
});
