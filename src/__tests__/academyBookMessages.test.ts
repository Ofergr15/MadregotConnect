import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import he from '../../messages/he.json';
import en from '../../messages/en.json';
import { DRAFT_ZONES } from '@/lib/academy/library-draft';
import { LIBRARY_KINDS } from '@/lib/academy/library';

/**
 * The workout book v3's copy: every key the screens ask for exists in both languages.
 *
 * next-intl prints the KEY when a message is missing, so a typo ships as
 * `workoutBook.quick.count` on a coach's phone with every test green. The static keys are
 * read out of the components themselves; the dynamic families (`zone.${…}`) are checked
 * against the enums they are built from.
 */

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`)));
}

const book = (he as unknown as { workoutBook: Tree }).workoutBook;
const bookEn = (en as unknown as { workoutBook: Tree }).workoutBook;
const heKeys = new Set(leaves(book));

describe('workoutBook messages', () => {
  it('he and en have the same keys', () => {
    expect(leaves(bookEn).sort()).toEqual([...heKeys].sort());
  });

  it('every static key the screens use exists', () => {
    const dir = path.join(__dirname, '../components/academy/book');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx')).map(f => path.join(dir, f));
    files.push(path.join(__dirname, '../components/academy/WorkoutBook.tsx'));
    const used = new Set<string>();
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      // t('key'), t.rich('key'), and the string branches of a ternary passed to t.
      for (const m of src.matchAll(/\bt(?:\.rich)?\(\s*'([a-zA-Z][\w.-]*)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/\bt(?:\.rich)?\([^)]*?\?\s*'([a-zA-Z][\w.-]*)'\s*:\s*'([a-zA-Z][\w.-]*)'/g)) {
        used.add(m[1]); used.add(m[2]);
      }
    }
    const missing = [...used].filter(k => !heKeys.has(k) && !Object.keys(book).includes(k));
    expect(missing).toEqual([]);
  });

  it('the dynamic families are complete', () => {
    for (const z of DRAFT_ZONES) expect(heKeys.has(`zone.${z}`)).toBe(true);
    for (const k of LIBRARY_KINDS) expect(heKeys.has(`kind.${k}`)).toBe(true);
    for (const m of ['jog', 'walk', 'stand']) expect(heKeys.has(`mode.${m}`)).toBe(true);
    for (const r of ['warmup', 'cooldown', 'rest']) expect(heKeys.has(`role.${r}`)).toBe(true);
    for (const f of ['count', 'length', 'pace', 'rest', 'hrMin', 'hrMax']) {
      expect(heKeys.has(`quick.${f}`)).toBe(true);
      expect(heKeys.has(`wheel.${f}`)).toBe(true);
    }
    for (const d of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
      expect(heKeys.has(`day.${d}`)).toBe(true);
      expect(heKeys.has(`dayShort.${d}`)).toBe(true);
    }
    for (const s of ['new', 'existing', 'review']) expect(heKeys.has(`import.status.${s}`)).toBe(true);
    for (const r of ['no-test', 'pace-from-note', 'length-from-note', 'open-length', 'not-editable']) {
      expect(heKeys.has(`import.reason.${r}`)).toBe(true);
    }
  });
});
