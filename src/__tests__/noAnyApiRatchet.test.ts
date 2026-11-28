import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import baseline from './noAnyApiRatchet.baseline.json';

/**
 * Ratchet on explicit `any` under src/app/api. Every file may hold at most its
 * baseline count; a file not in the baseline may hold none. `catch (e: any)` is
 * exempt. When you clean a file, lower (or delete) its entry — the test fails on a
 * stale baseline too, so the number only ever goes down.
 */
const ROOT = path.join(process.cwd(), 'src/app/api');
const ANY = /(?::\s*any\b|\bas\s+any\b|<any\b|\bany\[\]|,\s*any\s*[>,)]|\bRecord<string,\s*any>)/g;
const CATCH = /catch\s*\(\s*\w+\s*:\s*any\s*\)/g;

export function countAny(source: string): number {
  return (source.replace(CATCH, '').match(ANY) || []).length;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of walk(ROOT)) {
    const n = countAny(fs.readFileSync(file, 'utf8'));
    if (n) counts[path.relative(process.cwd(), file).split(path.sep).join('/')] = n;
  }
  return counts;
}

describe('no new `any` in src/app/api', () => {
  const allowed = baseline as Record<string, number>;
  const counts = currentCounts();

  it('the counter sees the shapes it is meant to, and skips catch clauses', () => {
    expect(countAny('const a: any = 1; b as any; f<any>(); let c: any[]; Map<string, any>')).toBe(5);
    expect(countAny('try {} catch (e: any) {}')).toBe(0);
    expect(countAny('// anyone, any coach')).toBe(0);
  });

  it('no file exceeds its baseline, and no new file introduces any', () => {
    const over = Object.entries(counts)
      .filter(([file, n]) => n > (allowed[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} (baseline ${allowed[file] ?? 0})`);
    expect(over).toEqual([]);
  });

  it('the baseline is not stale — lower it when a file gets cleaner', () => {
    const stale = Object.entries(allowed)
      .filter(([file, n]) => (counts[file] ?? 0) < n)
      .map(([file, n]) => `${file}: baseline ${n}, now ${counts[file] ?? 0}`);
    expect(stale).toEqual([]);
  });
});
