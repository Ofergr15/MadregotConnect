import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Plan rule: no price on any U21 screen until the owner approves pricing. */
describe('U21 screens show no prices', () => {
  it.each(['src/app/u21/page.tsx', 'src/app/u21/admin/page.tsx', 'src/app/register/U21RegisterEntry.tsx'])('%s renders no price', (f) => {
    const src = readFileSync(join(process.cwd(), f), 'utf8');
    expect(src).not.toMatch(/priceIls|₪/);
  });
});
