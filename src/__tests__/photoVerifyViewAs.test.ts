import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const requireSession = vi.fn();
vi.mock('@/lib/auth-session', () => ({ requireSession: (r: Request) => requireSession(r) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => { throw new Error('not used'); } }));

import { verifyRequest } from '@/lib/auth/verify';

const VIEWED = '11111111-1111-4111-8111-111111111111';

function req(method = 'GET', viewAs: string | null = VIEWED) {
  const headers: Record<string, string> = { Authorization: 'Bearer t' };
  if (viewAs) headers['x-view-as'] = viewAs;
  return new NextRequest('https://www.madregot.app/api/photos', { method, headers });
}

describe('photo routes while an admin views as a member', () => {
  beforeEach(() => requireSession.mockReset());

  it('answers as the viewed member', async () => {
    requireSession.mockResolvedValue({ ok: true, user: { email: 'strava_1@strava.madregot.local', athleteEmail: 'Shahar@x.com', athleteId: VIEWED, role: 'runner' } });
    expect(await verifyRequest(req())).toEqual({ email: 'shahar@x.com', athleteId: VIEWED, role: 'runner' });
  });

  it('refuses when the session refuses (a write while viewing)', async () => {
    requireSession.mockResolvedValue({ ok: false, status: 403, error: 'view_as_read_only' });
    expect(await verifyRequest(req('POST'))).toBeNull();
  });

  it('refuses a session with no athlete row', async () => {
    requireSession.mockResolvedValue({ ok: true, user: { email: 'a@x.com', athleteEmail: null, athleteId: null, role: 'admin' } });
    expect(await verifyRequest(req())).toBeNull();
  });

  it('does not involve the session resolver without the header', async () => {
    await verifyRequest(req('GET', null));
    expect(requireSession).not.toHaveBeenCalled();
  });
});
