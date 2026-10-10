import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import he from '../../messages/he.json';
import en from '../../messages/en.json';
import { PACE_KINDS, PROGRESSIONS } from '@/lib/academy/coach-tools';

/**
 * The coach tools' copy: both languages, every key the screens ask for, and the RTL rules
 * of the mockup's own "הכללים" (it shipped with the bugs these catch).
 */

type Tree = { [k: string]: string | Tree };
const leaves = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`)));
const flat = (tree: Tree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : flat(v, `${prefix}${k}.`)));

const tools = (he as unknown as { academyTools: Tree }).academyTools;
const toolsEn = (en as unknown as { academyTools: Tree }).academyTools;
const keys = new Set(leaves(tools));

describe('academyTools messages', () => {
  it('he and en have the same keys', () => {
    expect(leaves(toolsEn).sort()).toEqual([...keys].sort());
  });

  it('every static key the screens use exists (at the root or under the namespace a file opened)', () => {
    const dir = path.join(__dirname, '../components/academy/tools');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx')).map(f => path.join(dir, f));
    files.push(path.join(__dirname, '../components/academy/AcademyShell.tsx'));
    files.push(path.join(__dirname, '../components/academy/AcademyHome.tsx'));
    const missing: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const spaces = [...src.matchAll(/useTranslations\('academyTools(?:\.([\w]+))?'\)/g)].map(m => m[1] ?? '');
      if (!spaces.length) continue;
      const used = new Set<string>();
      for (const m of src.matchAll(/\bt{1,2}(?:\.rich)?\(\s*'([a-zA-Z][\w.-]*)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/\bt{1,2}(?:\.rich)?\([^)]*?\?\s*'([a-zA-Z][\w.-]*)'\s*:\s*'([a-zA-Z][\w.-]*)'/g)) { used.add(m[1]); used.add(m[2]); }
      for (const k of used) {
        if (!spaces.some(ns => keys.has(ns ? `${ns}.${k}` : k))) missing.push(`${path.basename(file)}: ${k}`);
      }
    }
    // AcademyShell's `t` is also other namespaces' — only the academyTools ones are checked
    // there (its `tt`), so filter to keys that look like ours.
    expect(missing.filter(m => !m.startsWith('AcademyShell.tsx') || /: (waiting|kind|what|dayOn)/.test(m))).toEqual([]);
  });

  it('the dynamic families are complete', () => {
    for (const k of PACE_KINDS) for (const f of ['kind', 'kindIn', 'kindThe']) expect(keys.has(`${f}.${k}`)).toBe(true);
    for (const w of ['reps', 'tempo', 'long', 'run']) expect(keys.has(`what.${w}`)).toBe(true);
    for (const d of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) expect(keys.has(`dayOn.${d}`)).toBe(true);
    for (const p of PROGRESSIONS) {
      expect(keys.has(`copy.mode.${p}`)).toBe(true);
      expect(keys.has(`copy.modeHint.${p}`)).toBe(true);
    }
  });

  it('never writes a change as an arrow', () => {
    for (const [k, v] of [...flat(tools), ...flat(toolsEn)]) expect(`${k}: ${v}`).not.toMatch(/[←→]/);
  });

  it('isolates every number written into the Hebrew copy', () => {
    // A digit, a % or a +5 inside a Hebrew message must sit in <m>/<n> (bdi dir=ltr).
    const bad = flat(tools).filter(([, v]) => /[0-9]/.test(v.replace(/<m>[^<]*<\/m>/g, '').replace(/\{[^}]*\}/g, '').replace(/#/g, '')));
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('never puts a slash with spaces between two values', () => {
    for (const [k, v] of flat(tools)) expect(`${k}: ${v}`).not.toMatch(/\} \/ \{/);
  });
});
