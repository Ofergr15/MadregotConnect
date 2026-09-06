import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { APP_VERSION } from '@/lib/version';

// The version at the foot of the Profile screen is the only build identity anyone
// outside this repo can read — it is how a coach answers "am I looking at the new
// version or the old one?" before deciding a fix didn't work.
//
// It drifted for eight releases (lib/version.ts said 2.39.87 while package.json
// said 2.39.95) because two files have to be bumped and only one of them is in
// the release habit. A stale version is worse than no version: it makes an old
// build claim to be the new one, which sends the reader hunting for a bug in code
// that was never deployed.
describe('APP_VERSION', () => {
  it('equals the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(APP_VERSION).toBe(pkg.version);
  });
});
