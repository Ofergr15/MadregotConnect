import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import baseline from './fixtures/no-any-baseline.json';

/**
 * Ratchet on explicit `any` in src/ outside src/app/api (round 6, task 170). src/app/api has
 * its own ratchet (#224, noAnyApiRatchet.test.ts) and is skipped here so the two never
 * count the same file. Tests are skipped too. `catch (e: any)` is exempt (the task's rule).
 *
 * A file may hold at most its baseline count; a file not in the baseline may hold none.
 * When you clean a file, lower its entry in fixtures/no-any-baseline.json. A file that got
 * cleaner without lowering its entry is not an error here: several PRs remove `any` in
 * parallel (#205, #224), and a strict stale check would turn main red whichever merged second.
 */
const ROOT = path.join(process.cwd(), 'src');
const SKIP_DIRS = new Set([path.join(ROOT, 'app', 'api'), path.join(ROOT, '__tests__')]);
const ANY = /(?::\s*any\b|\bas\s+any\b|<any\b|\bany\[\]|,\s*any\s*[>,)]|\bRecord<string,\s*any>)/g;
const CATCH = /catch\s*\(\s*\w+\s*:\s*any\s*\)/g;

export function countAny(source: string): number {
  return (source.replace(CATCH, '').match(ANY) || []).length;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(p)) walk(p, out); }
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p);
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

describe('no new `any` in src/ (outside src/app/api)', () => {
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

  it('the cleaned files stay at zero', () => {
    for (const f of ['src/lib/coach/roster-server.ts', 'src/lib/testing/readiness.ts', 'src/lib/testing/actions.ts']) {
      expect(countAny(fs.readFileSync(f, 'utf8')), f).toBe(0);
    }
  });
});
