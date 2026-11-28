import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiError, CODE_SLUG, ERROR_CODES, errorBody, errorCodeForStatus, errorCodeOf, internalErrorBody, isErrorCode } from '@/lib/api-error';
import { authError, authErrorCode } from '@/lib/auth-session';

/**
 * Task 202: every error body carries a stable `code` (docs/api-errors.md).
 *
 * The shared gates already do — authError() and the self-or-staff denials answer most
 * 401/403s in the app, and internalErrorBody() most 500s. What is left are error
 * literals written inline in route files. Rewriting all of them in one PR would collide
 * with most open PRs, so this is a ratchet: the count of inline `{ … }` error bodies
 * with a ≥400 status and no `code` may only go DOWN. Lower MAX_WITHOUT_CODE when you
 * convert some (errorBody()/apiError() from lib/api-error.ts).
 */
const MAX_WITHOUT_CODE = 2158;

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) routeFiles(p, out);
    else if (e.name === 'route.ts') out.push(p);
  }
  return out;
}

const ERROR_LITERAL = /(?:NextResponse|Response)\.json\(\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}\s*,\s*\{[^}]*?status:\s*([45]\d\d)/g;
const HAS_CODE = /(^|[\s,{])code\s*([:,}]|$)/;

function inlineErrorBodies() {
  const all: { file: string; status: number; hasCode: boolean }[] = [];
  for (const file of routeFiles(join(process.cwd(), 'src/app/api'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(ERROR_LITERAL)) {
      all.push({ file, status: Number(m[2]), hasCode: HAS_CODE.test(m[1]) });
    }
  }
  return all;
}

describe('error codes — ratchet over inline route error bodies', () => {
  const bodies = inlineErrorBodies();

  it('finds the inline error bodies (the scan is not silently empty)', () => {
    expect(bodies.length).toBeGreaterThan(1000);
  });

  it(`no more than ${MAX_WITHOUT_CODE} inline error bodies lack \`code\` (may only go down)`, () => {
    const without = bodies.filter((b) => !b.hasCode).length;
    expect(without).toBeLessThanOrEqual(MAX_WITHOUT_CODE);
  });

  it('every inline `code:` literal is a stable slug (catalogue code or a route\'s own)', () => {
    const bad: string[] = [];
    for (const file of routeFiles(join(process.cwd(), 'src/app/api'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(ERROR_LITERAL)) {
        const literal = /(?:^|[\s,{])code:\s*'([^']*)'/.exec(m[1]);
        if (literal && !CODE_SLUG.test(literal[1])) bad.push(`${file.replace(process.cwd(), '')}: ${literal[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the shared helpers', () => {
  it('authError carries a code for every session-gate error', async () => {
    const cases: [number, string, string][] = [
      [401, 'Missing bearer token', 'unauthenticated'],
      [401, 'Invalid or expired session', 'session_invalid'],
      [503, 'Could not verify session, try again', 'auth_unavailable'],
      [403, 'pending', 'pending'],
      [403, 'inactive', 'inactive'],
      [403, 'Account is not active', 'forbidden'],
      [403, 'view_as_read_only', 'view_as_read_only'],
      [500, 'Supabase not configured', 'internal'],
    ];
    for (const [status, error, code] of cases) {
      const res = authError({ status, error });
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error, code });
      expect(authErrorCode({ status, error })).toBe(code);
    }
  });

  it('internalErrorBody, errorBody, apiError', async () => {
    expect(internalErrorBody('Could not load')).toEqual({ error: 'Could not load', code: 'internal' });
    expect(errorBody(404, 'Feed item not found')).toEqual({ error: 'Feed item not found', code: 'not_found' });
    expect(errorBody(401, 'wrong-code', 'session_invalid', { left: 2 })).toEqual({ left: 2, error: 'wrong-code', code: 'session_invalid' });
    // extra cannot overwrite the contract keys
    expect(errorBody(400, 'x', undefined, { error: 'y', code: 'z' })).toEqual({ error: 'x', code: 'bad_request' });
    const res = apiError(429, 'too-many');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'too-many', code: 'rate_limited' });
  });

  it('errorCodeOf: the body\'s own code when it is a slug, else the status', () => {
    expect(errorCodeOf(403, { error: 'pending', code: 'pending' })).toBe('pending');
    expect(errorCodeOf(404, { error: 'x', code: 'no_plan' })).toBe('no_plan');
    expect(errorCodeOf(403, { error: 'Not allowed' })).toBe('forbidden');
    expect(errorCodeOf(500, { error: 'x', code: 'PGRST205' })).toBe('internal');
    expect(errorCodeOf(502, null)).toBe('unavailable');
  });

  it('the catalogue: every code is a slug, and the generic code for its status shares its status class', () => {
    for (const [code, status] of Object.entries(ERROR_CODES)) {
      expect(isErrorCode(code) && CODE_SLUG.test(code), code).toBe(true);
      expect(Math.floor(ERROR_CODES[errorCodeForStatus(status)] / 100), code).toBe(Math.floor(status / 100));
    }
  });
});
