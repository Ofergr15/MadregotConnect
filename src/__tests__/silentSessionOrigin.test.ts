import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/** POST /api/auth/silent-session: the one cookie-auth route refuses another site's Origin. */
vi.mock('@/lib/auth/device-token', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/device-token')>()), readDeviceToken: () => null }));
const { POST } = await import('@/app/api/auth/silent-session/route');
const call = (origin?: string) => POST(new NextRequest('https://app.example/api/auth/silent-session', { method: 'POST', headers: origin ? { origin } : {} }));

describe('silent-session Origin check', () => {
  it('another site → 403 forbidden_origin', async () => {
    const res = await call('https://evil.example');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin' });
  });
  it('malformed Origin → 403', async () => {
    expect((await call('not a url')).status).toBe(403);
  });
  it('same origin, or no Origin (native) → passes the check (then 401: no device cookie)', async () => {
    expect((await call('https://app.example')).status).toBe(401);
    expect((await call()).status).toBe(401);
  });
});
