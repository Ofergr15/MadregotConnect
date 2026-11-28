import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The nightly a11y workflow (#206) runs `npm run test:a11y` (product decision 28.11: once a
 * night, no pull_request trigger). That must cover BOTH specs: the empty-body axe audit and
 * the seeded smoke (task 111). Fails if the config narrows to one file or the script changes.
 */
const root = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');

describe('nightly a11y run covers the seeded smoke specs', () => {
  it('test:a11y runs the a11y config, whose testDir holds both specs and filters none out', () => {
    expect(JSON.parse(read('package.json')).scripts['test:a11y']).toBe('playwright test -c playwright.a11y.config.ts');
    const cfg = read('playwright.a11y.config.ts');
    expect(cfg).toMatch(/testDir:\s*'\.\/tests\/a11y'/);
    expect(cfg).not.toMatch(/^\s*(testMatch|testIgnore|grep|grepInvert)\s*:/m);
    expect(existsSync(path.join(root, 'tests/a11y/axe.spec.ts'))).toBe(true);
    expect(existsSync(path.join(root, 'tests/a11y/smoke.spec.ts'))).toBe(true);
  });

  it('the nightly workflow, when present, runs test:a11y on a schedule and never on pull_request', () => {
    const f = '.github/workflows/a11y-nightly.yml';
    if (!existsSync(path.join(root, f))) return; // pushed separately (needs the workflow token scope)
    const wf = read(f);
    expect(wf).toContain('npm run test:a11y');
    expect(wf).toMatch(/schedule:/);
    expect(wf).not.toMatch(/^\s*pull_request\s*:/m);
  });
});
