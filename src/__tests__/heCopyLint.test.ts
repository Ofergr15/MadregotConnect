import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';
import he from '../../messages/he.json';
import { lintHebrewCopy } from '@/lib/i18n/he-copy-lint';
import baseline from './fixtures/he-copy-lint-baseline.json';

/**
 * Hebrew copy lint (round 6, task 171): no gender slashes ("את/ה") and no
 * masculine imperatives ("בחר", "נסה שוב") in the web copy. See
 * src/lib/i18n/he-copy-lint.ts for the rules and the house style.
 *
 * he.json must be clean except for the keys listed in the baseline, each with
 * a reason. Hardcoded Hebrew in src/ is a ratchet: a file may not gain hits
 * over its baseline count. When you fix some, lower the number in
 * src/__tests__/fixtures/he-copy-lint-baseline.json.
 */

type Tree = { [k: string]: string | string[] | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (Array.isArray(value)) value.forEach((v, i) => (out[`${prefix}${key}[${i}]`] = v));
    else if (value && typeof value === 'object') Object.assign(out, flatten(value, `${prefix}${key}.`));
    else out[`${prefix}${key}`] = value;
  }
  return out;
}

describe('lintHebrewCopy', () => {
  it.each([
    ['את/ה כבר אצלנו', 'את/ה'],
    ['מגיע/ה', 'מגיע/ה'],
    ['עוד לא יודע/ת', 'יודע/ת'],
    ['ענה/תה על משוב', 'ענה/תה'],
    ['חבר(ה) במועדון', 'חבר(ה)'],
  ])('flags the gender slash in %s', (text, match) => {
    expect(lintHebrewCopy(text)).toContainEqual(expect.objectContaining({ kind: 'gender-slash', match }));
  });

  it.each(['שנ׳/ק״מ', 'פעימות/דקה', 'ל/ק', '3 אימון(ים)', 'צעדים/דקה'])('leaves the unit %s alone', (text) => {
    expect(lintHebrewCopy(text)).toEqual([]);
  });

  it.each([
    ['נסה שוב', 'נסה'],
    ['בדוק את החיבור ונסה שוב.', 'ונסה'],
    ['הזן קוד בן 6 ספרות', 'הזן'],
    ['בחר קבוצה', 'בחר'],
    ['— בחר יום אחד לפחות', 'בחר'],
    ['גרור תמונה לכאן, או לחץ לעיון', 'לחץ'],
  ])('flags the masculine imperative in %s', (text, match) => {
    expect(lintHebrewCopy(text)).toContainEqual(expect.objectContaining({ kind: 'masculine-imperative', match }));
  });

  it.each([
    'לא בחר דבוקה · לבחירה', // past tense mid-sentence
    'כבר שמור', // adjective
    'נסו שוב',
    'לנסות שוב',
    'בחירת קבוצה',
    'עבור {group}', // preposition
    'המשך', // noun
    'ההודעה נשלחה',
  ])('does not flag %s', (text) => {
    expect(lintHebrewCopy(text)).toEqual([]);
  });
});

describe('he.json has no gender slashes or masculine imperatives', () => {
  const allowed = baseline.heJson as Record<string, string>;
  const strings = flatten(he as unknown as Tree);

  it('every flagged key is in the baseline with a reason', () => {
    const flagged = Object.entries(strings)
      .filter(([, v]) => lintHebrewCopy(v).length > 0)
      .map(([k, v]) => `${k}: ${v}`)
      .filter((line) => !(line.split(': ')[0] in allowed));
    expect(flagged).toEqual([]);
  });

  it('the baseline lists no key that is already clean', () => {
    const stale = Object.keys(allowed).filter((k) => !strings[k] || lintHebrewCopy(strings[k]).length === 0);
    expect(stale).toEqual([]);
  });
});

describe('hardcoded Hebrew in src/ does not get worse (ratchet)', () => {
  const ROOT = 'src';
  const SKIP = new Set(['src/lib/i18n/he-copy-lint.ts']);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== '__tests__') walk(p);
      } else if (/\.(tsx?|mts)$/.test(e.name) && !/\.test\./.test(e.name) && !SKIP.has(p)) files.push(p);
    }
  };
  walk(ROOT);

  /** Line-based: comment lines are skipped, code lines are linted whole. */
  const hits = (file: string) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .reduce((n, l) => n + lintHebrewCopy(l).length, 0);

  it('no file has more hits than its baseline', () => {
    const limits = baseline.src as Record<string, number>;
    const over = files
      .map((f) => ({ file: relative('.', f), n: hits(f) }))
      .filter(({ file, n }) => n > (limits[file] ?? 0))
      .map(({ file, n }) => `${file}: ${n} > ${limits[file] ?? 0}`);
    expect(over).toEqual([]);
  });
});
