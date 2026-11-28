import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';
import { internalErrorBody } from '@/lib/api-error';

/** A 500 body never carries the raw thrown value: `String(err)` is "[object Object]" for a
 *  PostgrestError and the full SDK text (member ids, emails) for Stream/AWS/Drive errors. */
const API = join(__dirname, '..', 'app', 'api');
const routes = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p] : [];
  });

describe('API 500 bodies', () => {
  it('no route returns String(err) as the error', () => {
    const bad = routes(API)
      .filter((f) => /json\(\s*\{\s*error:\s*String\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(API, f));
    expect(bad).toEqual([]);
  });
  it('the fixed body keeps the standard shape', () => {
    expect(internalErrorBody()).toEqual({ error: 'Internal error', code: 'internal' });
  });
});
