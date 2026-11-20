import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The routes a connected native device reaches must never hand a caller the raw
 * PostgREST/Postgres error text (table and column names) — it is logged with
 * console.error and the response carries a fixed message. Triggerable on purpose before
 * the fix: /api/activities/details?activityId=abc → NaN → a database error in the body.
 */
const EXPOSED = [
  'auth/email-code', 'feed', 'feed/like', 'dashboard/weekly', 'activities/details',
  'athletes/me', 'athletes/summary', 'public/groups', 'public/signup',
];
const read = (r: string) => readFileSync(join(__dirname, '..', 'app', 'api', r, 'route.ts'), 'utf8');

describe('exposed routes return no raw error text', () => {
  for (const route of EXPOSED) {
    it(`${route}: no NextResponse.json carries an error's .message or details`, () => {
      const src = read(route);
      const responses = src.match(/NextResponse\.json\([^;]*?\{\s*status:\s*5\d\d\s*\}\)/gs) ?? [];
      for (const r of responses) {
        expect(r, r).not.toMatch(/\.message|details:/);
      }
      // Belt and braces: no response anywhere in the file builds on an error's message.
      expect(src).not.toMatch(/NextResponse\.json\(\{[^}]*\b(err|error|e)\b[^}]*\.message/);
    });
  }
});
