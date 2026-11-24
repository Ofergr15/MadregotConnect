import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Night queue #69–#74: no 5xx response under these API folders carries an error's `.message` or
 * `details:` (PostgREST/Postgres text names tables and columns). Same rule as exposedRoutesNoRawErrors,
 * applied to whole folders, one batch at a time — add a folder here when its batch lands.
 */
const SWEPT = ['admin', 'academy', 'plans', 'plan-builder', 'program-weeks', 'feed', 'records', 'athletes', 'garmin', 'strava'];
/** Answers that relay a THIRD PARTY's reply to an admin on purpose (not database text). */
const ALLOW = new Set(['admin/strava/webhook-subscribe']);

const API = join(__dirname, '..', 'app', 'api');
function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return routes(p);
    return f === 'route.ts' ? [p] : [];
  });
}

describe('swept API folders return no raw error text', () => {
  for (const folder of SWEPT) {
    for (const file of routes(join(API, folder))) {
      const route = relative(API, file).replace(/\/route\.ts$/, '');
      if (ALLOW.has(route)) continue;
      it(route, () => {
        const src = readFileSync(file, 'utf8');
        const calls = src.split('NextResponse.json(').slice(1).map((c) => c.slice(0, c.indexOf(');')));
        for (const c of calls.filter((x) => /status:\s*5\d\d/.test(x))) expect(c, c).not.toMatch(/\.message|details:/);
        expect(src).not.toMatch(/NextResponse\.json\(\{[^}]*\b(err|error|e)\b[^}]*\.message/);
      });
    }
  }
});
