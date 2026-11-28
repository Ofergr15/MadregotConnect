import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { concretePath, judge, parseAllowlist } from '../../scripts/smoke-prod-routes.mjs';
import { DEV_API_ALLOWLIST } from '@/lib/dev-api-allowlist';

// Q28-1: the prod route gate reads the native allowlist straight from the TS source.

describe('prod route smoke gate', () => {
  it('parses exactly the allowlist the app uses', () => {
    const parsed = parseAllowlist(readFileSync('src/lib/dev-api-allowlist.ts', 'utf8'));
    expect(parsed).toEqual(DEV_API_ALLOWLIST.map(([m, p]) => [m, p]));
    expect(parsed).toContainEqual(['GET', '/api/group-chat']);
  });

  it('fills dynamic segments with a placeholder id', () => {
    expect(concretePath('/api/events/*/register')).toBe('/api/events/00000000-0000-0000-0000-000000000000/register');
  });

  it('fails a missing route, passes an auth refusal', () => {
    expect(judge('GET', { status: 404, contentType: 'text/html' })).toMatch(/missing/);
    expect(judge('GET', { status: 405, contentType: '' })).toMatch(/405/);
    expect(judge('GET', { status: 401, contentType: 'application/json' })).toBe('ok');
    expect(judge('POST', { status: 400, contentType: 'application/json' })).toBe('ok');
    expect(judge('GET', { status: 404, contentType: 'application/json' })).toBe('ok'); // handler's own "not found"
  });

  it('a POST answered by the HTML page shell is a missing route', () => {
    expect(judge('POST', { status: 200, contentType: 'text/html; charset=utf-8' })).toMatch(/missing/);
  });

  it('fails an unauthenticated empty POST that succeeds', () => {
    expect(judge('POST', { status: 200, contentType: 'application/json' })).toMatch(/succeeded/);
  });

  it('checks PUT/PATCH/DELETE by OPTIONS + Allow, never by sending them', () => {
    expect(judge('DELETE', { status: 204, allow: 'DELETE, OPTIONS, POST' })).toBe('ok');
    expect(judge('PATCH', { status: 204, allow: 'GET, OPTIONS' })).toMatch(/Allow/);
    expect(judge('PUT', { status: 200, allow: null })).toMatch(/none/); // Next's HTML fallback for a missing route
  });
});
