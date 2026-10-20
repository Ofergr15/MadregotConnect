import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The app's SWR cache is a custom provider (app/providers.tsx → lib/swr-persist), so the
// `mutate` exported by 'swr' itself writes to a default cache no screen reads. The setup's
// "אין לי Garmin — ממשיכים" called it and did nothing until the app regained focus
// (found walking the sign-up on 2026-10-21). Every refresh must use the provider's mutate:
// useSWRConfig().mutate, or the one useApi/useSWR hands back.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : []; });
}

describe('no global SWR mutate', () => {
  it('nothing in src imports `mutate` straight from swr', () => {
    const bad = files('src').filter((f) => !f.includes('__tests__')).filter((f) => /import\s*\{[^}]*\bmutate\b[^}]*\}\s*from\s*['"]swr['"]/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
