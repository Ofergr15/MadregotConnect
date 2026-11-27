import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md API conventions: a route that reads live DB state exports
 * `dynamic = 'force-dynamic'`. A GET handler that touches Supabase without it (and without
 * an explicit `revalidate`, which is a deliberate cache) fails here.
 */
const API = join(__dirname, '..', 'app', 'api');

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return routes(p);
    return n === 'route.ts' ? [p] : [];
  });
}

describe('API routes: live-data GET handlers are force-dynamic', () => {
  it('every GET route that reads Supabase exports dynamic or revalidate', () => {
    const missing = routes(API).filter((f) => {
      const s = readFileSync(f, 'utf8');
      if (!/export (async function|const) GET\b/.test(s)) return false;
      if (!/createServerClient|supabase/.test(s)) return false;
      return !/export const dynamic\s*=\s*['"]force-dynamic['"]/.test(s) && !/export const revalidate\s*=/.test(s);
    }).map((f) => relative(API, f));
    expect(missing).toEqual([]);
  });
});
