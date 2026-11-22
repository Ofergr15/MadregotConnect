import { afterEach, describe, expect, it, vi } from 'vitest';
import { U21_ALLOWED_PROJECT_REF, assertU21ServerEnv, checkU21ServerEnv } from '@/lib/u21/env-guard';

const REF = U21_ALLOWED_PROJECT_REF;
const OTHER = 'abcdefghijklmnopqrst';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;

const good = (over: Record<string, string | undefined> = {}) => ({
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: REF }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: REF }),
  ...over,
});

describe('checkU21ServerEnv', () => {
  it('passes for the approved project', () => {
    expect(checkU21ServerEnv(good())).toEqual({ ok: true });
  });

  it('fails a service key for another project', () => {
    expect(checkU21ServerEnv(good({ SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: OTHER }) }))).toEqual({ ok: false, check: 'service_key' });
  });
  it('fails a service key with the wrong role', () => {
    expect(checkU21ServerEnv(good({ SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'anon', ref: REF }) }))).toEqual({ ok: false, check: 'service_key' });
  });
  it.each([['missing', undefined], ['empty', ''], ['two parts', 'a.b'], ['not base64 json', 'a.%%%.c'], ['payload not json', `x.${Buffer.from('nope').toString('base64url')}.y`]])(
    'fails a %s service key', (_l, key) => {
      expect(checkU21ServerEnv(good({ SUPABASE_SERVICE_ROLE_KEY: key }))).toEqual({ ok: false, check: 'service_key' });
    });

  it('fails an anon key for another project', () => {
    expect(checkU21ServerEnv(good({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: OTHER }) }))).toEqual({ ok: false, check: 'anon_key' });
  });
  it('fails an anon key with the wrong role', () => {
    expect(checkU21ServerEnv(good({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'service_role', ref: REF }) }))).toEqual({ ok: false, check: 'anon_key' });
  });

  it.each([
    ['missing', undefined], ['unparseable', 'not a url'], ['http', `http://${REF}.supabase.co`],
    ['non-cloud host', 'https://db.example.com'], ['look-alike suffix', `https://${REF}.supabase.co.evil.com`],
    ['short ref', 'https://abc.supabase.co'], ['custom port', `https://${REF}.supabase.co:8443`],
  ])('fails a %s URL', (_l, url) => {
    expect(checkU21ServerEnv(good({ NEXT_PUBLIC_SUPABASE_URL: url }))).toEqual({ ok: false, check: 'url' });
  });

  it('production go-live: any one self-consistent project passes; an explicit pin still refuses others', () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: OTHER }),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: OTHER }),
    };
    expect(checkU21ServerEnv(env)).toEqual({ ok: true });
    expect(checkU21ServerEnv(env, OTHER)).toEqual({ ok: true });
    expect(checkU21ServerEnv(env, 'aaaaaaaaaaaaaaaaaaaa')).toEqual({ ok: false, check: 'url' });
    // Keys from another project than the URL's still refuse (mixed config).
    expect(checkU21ServerEnv({ ...env, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: 'aaaaaaaaaaaaaaaaaaaa' }) })).toEqual({ ok: false, check: 'service_key' });
  });

  it.each(['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321'])('accepts loopback %s off Vercel, rejects it on Vercel', url => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role' }),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon' }),
    };
    expect(checkU21ServerEnv(env)).toEqual({ ok: true });
    expect(checkU21ServerEnv({ ...env, VERCEL: '1' })).toEqual({ ok: false, check: 'url' });
  });

  it('still requires the right roles on loopback', () => {
    expect(checkU21ServerEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'anon' }),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon' }),
    })).toEqual({ ok: false, check: 'service_key' });
  });
});

describe('assertU21ServerEnv', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('returns no denial for the approved env', () => {
    for (const [k, v] of Object.entries(good())) vi.stubEnv(k, v!);
    expect(assertU21ServerEnv().denied).toBeNull();
  });

  it('503s with a generic body and logs only the check label', async () => {
    const env = good({ SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: OTHER }) });
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v!);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { denied } = assertU21ServerEnv();
    expect(denied!.status).toBe(503);
    const text = await denied!.text();
    expect(JSON.parse(text)).toEqual({ error: 'Service unavailable' });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('service_key');
    for (const secret of [REF, OTHER, env.SUPABASE_SERVICE_ROLE_KEY!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!]) {
      expect(logged).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
  });
});
