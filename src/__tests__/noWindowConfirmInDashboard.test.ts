import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// docs/mgmt-web-audit.md: staff screens confirm in-app (useConfirm / ConfirmStrip),
// never with the browser's native window.confirm(), which in an installed PWA looks
// like the browser breaking through the app.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('dashboard screens do not call window.confirm', () => {
  it('no confirm( call in src/app/(app)/dashboard', () => {
    const offenders = walk('src/app/(app)/dashboard').filter((f) => {
      const code = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      return /(^|[^\w.])(window\.)?confirm\(/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
