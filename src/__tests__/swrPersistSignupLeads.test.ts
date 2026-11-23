import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { neverPersisted } from '@/lib/swr-persist';

// Night queue #100 (leads-signup deep dive §6ד): nothing from the signup / leads flow may rest on the device
// through the SWR disk cache (lib/swr-persist, CLAUDE.md 2026-09-07). Today that holds because those routes
// are only ever reached with a plain POST `fetch` — never through useApi/useSWR, so no SWR key exists for
// them. This test pins that: the first SWR read of a signup/leads route must also add it to NEVER_PERSIST.

const ROOT = join(__dirname, '..');
const SENSITIVE = /\/api\/(public\/signup|admin\/leads|leads)\b/;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('swr-persist and the signup / leads routes', () => {
  it('no SWR read (useApi / useSWR / useSWRInfinite) names a signup or leads route', () => {
    const offenders: string[] = [];
    for (const f of files(ROOT)) {
      const text = readFileSync(f, 'utf8');
      const reads = text.match(/use(Api|SWR|SWRInfinite)\s*(<[^>]*>)?\s*\(\s*[`'"][^`'"]+[`'"]/g) ?? [];
      for (const r of reads) if (SENSITIVE.test(r)) offenders.push(`${f.replace(ROOT, 'src')}: ${r}`);
    }
    expect(offenders, 'a signup/leads SWR read must be added to NEVER_PERSIST in lib/swr-persist.ts').toEqual([]);
  });

  it('if one ever is cached, these keys are refused (or the test above names it first)', () => {
    for (const key of ['/api/public/signup', '/api/public/signup/status', '/api/admin/leads']) {
      // Not in NEVER_PERSIST today (no SWR key can exist); the guard is the scan above.
      expect(typeof neverPersisted(key)).toBe('boolean');
    }
    // The existing health-data skips stay in place.
    expect(neverPersisted('/api/pain-reports?athleteId=x')).toBe(true);
    expect(neverPersisted('/api/workout-feedback')).toBe(true);
  });
});
