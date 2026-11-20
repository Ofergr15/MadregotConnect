import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Since the mint fails closed (no password-rotation fallback), every caller must treat
 * `{ error }` / missing session as a failure and never hand a half-made session back.
 */
const ROOT = join(process.cwd(), 'src');
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p, out); } else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const callers = walk(ROOT).filter((f) => !f.endsWith('synthetic-session.ts') && /createSyntheticSession\(/.test(readFileSync(f, 'utf8')));

describe('every createSyntheticSession caller handles a failed mint', () => {
  it('finds the known callers', () => {
    expect(callers.length).toBeGreaterThanOrEqual(5);
  });
  it.each(callers.map((f) => [f.replace(ROOT, 'src')]))('%s checks .error / missing session right after the call', (rel) => {
    const src = readFileSync(join(process.cwd(), rel), 'utf8');
    let i = src.indexOf('createSyntheticSession(');
    while (i !== -1) {
      const after = src.slice(i, i + 900);
      expect(after, rel).toMatch(/\.error\s*\|\|\s*!\s*\w+\.session|!\w+\.session\s*\|\|\s*\w+\.error|if\s*\(\s*!?\w+\.(error|session)/);
      i = src.indexOf('createSyntheticSession(', i + 1);
    }
  });
});
