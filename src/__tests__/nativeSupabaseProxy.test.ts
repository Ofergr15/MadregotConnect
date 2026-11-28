import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as refresh } from '@/app/api/native/auth/refresh/route';
import { GET as storage } from '@/app/api/native/storage/program-plans/[folder]/[file]/route';
import { nativePdfUrl, programPlanKeyFromStored } from '@/lib/native/supabase-proxy';
import { __resetRateLimit } from '@/lib/onboarding/signup-status';

const EU = 'https://euproject123.supabase.co';
const RT = 'rt-SECRET-refresh-token-value';
const req = (body: unknown, ip = '1.2.3.4') =>
  new Request('https://www.madregot.app/api/native/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });

let fetchMock: ReturnType<typeof vi.fn>;
let logs: string[];
beforeEach(() => {
  __resetRateLimit();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', EU + '/');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  logs = [];
  for (const m of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  }
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const upstream = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('POST /api/native/auth/refresh', () => {
  it('forwards to the configured project refresh grant with the anon key and relays the fields the app reads', async () => {
    const session = { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600, expires_at: 1900000000, token_type: 'bearer',
      user: { id: 'u1', email: 'a@b.c', user_metadata: { athlete_id: 'ath-1' } }, provider_token: 'x' };
    upstream(200, session);
    const res = await refresh(req({ refresh_token: RT }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${EU}/auth/v1/token?grant_type=refresh_token`);
    expect(init.method).toBe('POST');
    expect(init.headers.apikey).toBe('anon-key');
    expect(JSON.parse(init.body)).toEqual({ refresh_token: RT });
    const out = await res.json();
    expect(out).toEqual({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600, expires_at: 1900000000, token_type: 'bearer', user: session.user });
  });

  it.each([400, 401])('passes %i through', async (status) => {
    upstream(status, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' });
    const res = await refresh(req({ refresh_token: RT }));
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('400 without calling upstream when refresh_token is missing', async () => {
    const res = await refresh(req({}));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs a token, on success, error or upstream failure', async () => {
    upstream(200, { access_token: 'at-new', refresh_token: 'rt-new', user: {} });
    await refresh(req({ refresh_token: RT }));
    upstream(500, { error: 'boom', refresh_token: 'rt-leak' });
    await refresh(req({ refresh_token: RT }));
    fetchMock.mockRejectedValueOnce(new Error(`fetch failed ${RT}`));
    expect((await refresh(req({ refresh_token: RT }))).status).toBe(502);
    const all = logs.join('\n');
    for (const t of [RT, 'rt-new', 'at-new', 'rt-leak']) expect(all).not.toContain(t);
  });

  it('rate-limits per client', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) {
      upstream(200, { access_token: 'a', refresh_token: 'b' });
      last = (await refresh(req({ refresh_token: RT }, '9.9.9.9'))).status;
    }
    expect(last).toBe(429);
  });
});

describe('program-plans storage via our domain', () => {
  const tokyo = 'https://njzldypndkicpsmdtyll.supabase.co/storage/v1/object/public/program-plans/training-program/week-2026-11-22.pdf';

  it('the program-weeks native URL is on our domain, whatever host the row was written under', () => {
    expect(nativePdfUrl(tokyo)).toBe('/api/native/storage/program-plans/training-program/week-2026-11-22.pdf');
    expect(nativePdfUrl('/plans/nutrition-plan/week1.pdf')).toBe('/plans/nutrition-plan/week1.pdf');
    for (const bad of [null, '', 'http://x.supabase.co/storage/v1/object/public/program-plans/training-program/a.pdf',
      'https://x.supabase.co/storage/v1/object/public/other-bucket/training-program/a.pdf',
      'https://x.supabase.co/storage/v1/object/sign/program-plans/training-program/a.pdf?token=t',
      'https://x.supabase.co/storage/v1/object/public/program-plans/secret/a.pdf',
      'https://x.supabase.co/storage/v1/object/public/program-plans/training-program/../a.pdf',
      'https://x.supabase.co/storage/v1/object/public/program-plans/training-program/a.exe']) {
      expect(nativePdfUrl(bad)).toBeNull();
    }
    expect(programPlanKeyFromStored(tokyo)).toBe('training-program/week-2026-11-22.pdf');
  });

  const get = (folder: string, file: string) => storage(new Request('https://www.madregot.app/x'), { params: Promise.resolve({ folder, file }) });

  it('is gated since the bucket went private (migration 252): no credential → 401', async () => {
    expect((await get('training-program', 'week-2026-11-22.pdf')).status).toBe(401);
  });

  it('reads the /api/files link new rows hold', () => {
    expect(programPlanKeyFromStored('/api/files/program-plans/nutrition-plan/w.pdf')).toBe('nutrition-plan/w.pdf');
    expect(nativePdfUrl('/api/files/program-plans/nutrition-plan/w.pdf')).toBe('/api/native/storage/program-plans/nutrition-plan/w.pdf');
    for (const bad of ['/api/files/program-plans/secret/a.pdf', '/api/files/avatars/training-program/a.pdf', '/api/files/program-plans/training-program/a.pdf?x=1']) {
      expect(programPlanKeyFromStored(bad)).toBeNull();
    }
  });

  it('only the two PDF folders, never another folder/bucket or a signed path', async () => {
    for (const [f, n] of [['secret', 'a.pdf'], ['training-program', '..pdf'], ['training-program', 'a.txt'], ['..', 'a.pdf']]) {
      expect((await get(f, n)).status).toBe(404);
    }
  });
});

describe('GET /api/program-weeks', () => {
  it('adds *_native_url next to the unchanged stored URLs', async () => {
    vi.resetModules();
    const rows = [{ week_start_date: '2026-11-22',
      training_pdf_url: 'https://old.supabase.co/storage/v1/object/public/program-plans/training-program/week-2026-11-22.pdf',
      nutrition_pdf_url: null }];
    vi.doMock('@/lib/supabase/server', () => ({
      createServerClient: () => ({ from: () => ({ select: () => ({ order: async () => ({ data: rows, error: null }) }) }) }),
    }));
    const { GET } = await import('@/app/api/program-weeks/route');
    const out = await (await GET()).json();
    expect(out[0].training_pdf_url).toBe(rows[0].training_pdf_url);
    expect(out[0].training_pdf_native_url).toBe('/api/native/storage/program-plans/training-program/week-2026-11-22.pdf');
    expect(out[0].nutrition_pdf_native_url).toBeNull();
    vi.doUnmock('@/lib/supabase/server');
  });
});
