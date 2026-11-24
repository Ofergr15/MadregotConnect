import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GET } from '@/app/api/config/route';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64({ alg: 'HS256' })}.${b64({ role })}.sig`;
const ANON = jwt('anon');
const SERVICE = jwt('service_role');
const URL_ = 'https://zrrklhonqtzycayjdbor.supabase.co';

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/config', () => {
  it('returns url + anon key + optional minAppVersion, short cache', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
    vi.stubEnv('NATIVE_MIN_APP_VERSION', '2.5.0');
    const res = GET();
    const body = await res.json();
    expect(body).toEqual({ supabaseUrl: URL_, supabaseAnonKey: ANON, minAppVersion: '2.5.0' });
    expect(res.headers.get('cache-control')).toMatch(/max-age=60/);
  });

  it('never emits the service-role key, even when it is mis-set into the anon slot', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
    for (const anonSlot of [SERVICE, 'sb_secret_xyz', 'garbage']) {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', anonSlot);
      const res = GET();
      const text = await res.text();
      expect(res.status).toBe(503);
      expect(text).not.toContain(SERVICE);
      expect(text).not.toContain('sb_secret_');
    }
  });

  it('ok response contains no service-role material', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
    const text = await GET().text();
    expect(text).not.toContain(SERVICE);
    expect(text).not.toMatch(/service_role/);
  });

  it('source never references the service-role key and reads only public env vars', () => {
    for (const f of ['../app/api/config/route.ts', '../lib/public-config.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/SERVICE_ROLE/);
      expect(src).not.toMatch(/createServerClient/);
      for (const m of src.matchAll(/env\.([A-Z0-9_]+)/g)) {
        expect(m[1].startsWith('NEXT_PUBLIC_') || m[1] === 'NATIVE_MIN_APP_VERSION').toBe(true);
      }
    }
    const route = readFileSync(join(__dirname, '../app/api/config/route.ts'), 'utf8');
    expect(route).toMatch(/export const dynamic = 'force-dynamic'/);
  });
});
