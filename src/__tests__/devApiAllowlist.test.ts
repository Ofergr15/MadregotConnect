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
// Concrete request paths for the patterns (`*` → a synthetic id).
const SEVEN = DEV_API_ALLOWLIST.map(([m, p]) => [m, p.replace(/\*/g, 'x1')] as const);
const OTHERS: Array<[string, string]> = [
  ['POST', '/api/public/signup'], ['POST', '/api/public/signup/status'], ['GET', '/api/join/groups'],
  ['GET', '/api/feed/'], ['POST', '/api/admin/move'], ['GET', '/api/public/groups'],
  ['POST', '/api/admin/login'], ['GET', '/api'], ['GET', '/api/cron/sync'], ['GET', '/api/FEED'],
  ['GET', '/api/events/a/b/c'], ['GET', '/api/events//answers'],
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
    const routeDir = (p: string): boolean => {
      // Walk the pattern; `*` must match a dynamic [segment] directory.
      let dirs = [join(ROOT, 'src', 'app')];
      for (const seg of p.split('/').filter(Boolean)) {
        dirs = dirs.flatMap((d) => (seg === '*'
          ? (existsSync(d) ? readdirSync(d).filter((n) => /^\[.+\]$/.test(n)).map((n) => join(d, n)) : [])
          : [join(d, seg)]));
      }
      return dirs.some((d) => existsSync(join(d, 'route.ts')));
    };
    for (const [, p] of DEV_API_ALLOWLIST) expect(routeDir(p), p).toBe(true);
  });
  it('every allowed pattern sits under a path the iOS app calls (no route the app never uses)', () => {
    const iosDir = join(ROOT, 'ios', 'Madregot');
    if (!existsSync(iosDir)) return; // server-only branch: nothing to compare against
    const called = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.swift')) for (const m of readFileSync(full, 'utf8').matchAll(/"\/?(api\/[A-Za-z0-9/._-]+)/g)) called.add('/' + m[1].replace(/\/$/, ''));
      }
    };
    walk(iosDir);
    for (const [, p] of DEV_API_ALLOWLIST) {
      expect([...called].some((c) => p === c || p.startsWith(c + '/')), p).toBe(true);
    }
  });
});
