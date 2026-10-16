import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** #113: a row in a profile's "recent runs" opens that run (route + full numbers). */
const src = readFileSync(new URL('../components/profile/AthleteProfileBody.tsx', import.meta.url), 'utf8');

describe('profile recent runs', () => {
  it('link each run that has an id to its page', () => {
    expect(src).toMatch(/r\.id \? \(\s*<Link href=\{`\/dashboard\/activities\/\$\{r\.id\}`\}/);
  });
});
