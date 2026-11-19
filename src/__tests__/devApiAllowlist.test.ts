import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { proxy, config } from '@/proxy';
import { DEV_API_ALLOWLIST, DEV_BRANCH, DEV_SUPABASE_REF, isDevSurface } from '@/lib/dev-api-allowlist';

/**
 * Fail-closed dev allowlist (src/proxy.ts + lib/dev-api-allowlist.ts). The dev surface
 * is decided by the Supabase project / branch, never by the flag; production and local
 * dev are untouched. Synthetic hosts only.
 */

const ROOT = join(__dirname, '..', '..');
const KEYS = ['VERCEL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'NEXT_PUBLIC_SUPABASE_URL', 'MC_DEV_API_ALLOWLIST'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); KEYS.forEach((k) => delete process.env[k]); });
afterEach(() => { KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))); });

const setEnv = (e: Partial<Record<(typeof KEYS)[number], string>>) => Object.assign(process.env, e);
const req = (path: string, method = 'GET') => new NextRequest(new URL(path, 'https://dev.example.test'), { method });
const passes = (r: Response) => r.headers.get('x-middleware-next') === '1';
const DEV_DB = `https://${DEV_SUPABASE_REF}.supabase.co`;
const devPreview = () => setEnv({ VERCEL: '1', VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: DEV_DB });
const SEVEN = DEV_API_ALLOWLIST;
const OTHERS: Array<[string, string]> = [
  ['POST', '/api/public/signup'], ['GET', '/api/admin/people'], ['GET', '/api/feed/like'],
  ['GET', '/api/feed/'], ['PUT', '/api/athletes/me'], ['GET', '/api/public/groups'],
  ['GET', '/api'], ['GET', '/api/cron/sync'], ['GET', '/api/FEED'],
];

describe('1. production: every /api request passes through untouched', () => {
  it('VERCEL_ENV=production — even on the dev DB/branch with the flag set', () => {
    setEnv({ VERCEL: '1', VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: DEV_DB, VERCEL_GIT_COMMIT_REF: DEV_BRANCH, MC_DEV_API_ALLOWLIST: '1' });
    for (const [m, p] of [...SEVEN, ...OTHERS]) {
      const r = proxy(req(p, m));
      expect(passes(r), `${m} ${p}`).toBe(true);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
  });
});

describe('2. dev surface, flag UNSET: fail closed', () => {
  it('all seven routes 404, and so does everything else', () => {
    devPreview();
    for (const [m, p] of [...SEVEN, ...OTHERS]) expect(proxy(req(p, m)).status, `${m} ${p}`).toBe(404);
  });
  it('pages are untouched (locale cookie as before)', () => {
    devPreview();
    const r = proxy(req('/feed'));
    expect(passes(r)).toBe(true);
    expect(r.cookies.get('NEXT_LOCALE')?.value).toBe('he');
  });
  it('the dev branch alone is enough to be the dev surface', () => {
    setEnv({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: DEV_BRANCH, NEXT_PUBLIC_SUPABASE_URL: 'https://otherproj.supabase.co' });
    expect(proxy(req('/api/feed')).status).toBe(404);
  });
  it('a 404 carries no body and no cookie', async () => {
    devPreview();
    const r = proxy(req('/api/admin/people'));
    expect(await r.text()).toBe('');
    expect(r.headers.get('set-cookie')).toBeNull();
  });
});

describe('3. dev surface, flag=1: exactly the seven', () => {
  it('the seven pass, query strings ignored', () => {
    devPreview(); setEnv({ MC_DEV_API_ALLOWLIST: '1' });
    for (const [m, p] of SEVEN) expect(passes(proxy(req(`${p}?x=1`, m))), `${m} ${p}`).toBe(true);
  });
  it('wrong method, trailing slash, look-alikes and every other route 404', () => {
    devPreview(); setEnv({ MC_DEV_API_ALLOWLIST: '1' });
    for (const [m, p] of OTHERS) expect(proxy(req(p, m)).status, `${m} ${p}`).toBe(404);
  });
  it('a flag value other than "1" stays closed', () => {
    devPreview(); setEnv({ MC_DEV_API_ALLOWLIST: 'true' });
    expect(proxy(req('/api/feed')).status).toBe(404);
  });
});

describe('4. a preview of another branch and DB is untouched', () => {
  it('every /api request passes through', () => {
    setEnv({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'some-feature', NEXT_PUBLIC_SUPABASE_URL: 'https://otherproj.supabase.co' });
    for (const [m, p] of [...SEVEN, ...OTHERS]) expect(passes(proxy(req(p, m))), `${m} ${p}`).toBe(true);
  });
});

describe('5. not on Vercel (local next dev) is untouched', () => {
  it('every /api request passes through, even on the dev DB', () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: DEV_DB });
    expect(isDevSurface()).toBe(false);
    for (const [m, p] of [...SEVEN, ...OTHERS]) expect(passes(proxy(req(p, m))), `${m} ${p}`).toBe(true);
  });
  it('a malformed Supabase URL is not the dev surface by itself', () => {
    setEnv({ VERCEL: '1', VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'not a url' });
    expect(isDevSurface()).toBe(false);
  });
});

describe('matcher and the native app', () => {
  it('matcher covers /api alongside pages', () => {
    expect(config.matcher).toContain('/api/:path*');
  });
  it('every allowed path is a real route', () => {
    for (const [, p] of SEVEN) expect(existsSync(join(ROOT, 'src', 'app', p, 'route.ts')), p).toBe(true);
  });
  it('the seven are what the iOS app calls, minus registration (public, kept closed)', () => {
    const iosDir = join(ROOT, 'ios', 'Madregot');
    if (!existsSync(iosDir)) return; // server-only branch: nothing to compare against
    const called = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.swift')) for (const m of readFileSync(full, 'utf8').matchAll(/"(api\/[a-z0-9/_-]+)"/g)) called.add('/' + m[1]);
      }
    };
    walk(iosDir);
    called.delete('/api/public/groups');
    called.delete('/api/public/signup');
    expect([...called].sort()).toEqual(SEVEN.map(([, p]) => p).sort());
  });
});
