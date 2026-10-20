import { describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/public/manifest/route';
import { INSTALL_KEY, INSTALL_KEY_TTL_MS } from '@/lib/auth/install-key';
import { newVerifier } from '@/lib/auth/login-handoff';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));

/** The icon added from the setup's install step opens signed in (api/auth/install-key). */
describe('install key', () => {
  it('a fresh verifier is a valid key', () => expect(INSTALL_KEY.test(newVerifier())).toBe(true));
  it('expires within hours, not days', () => expect(INSTALL_KEY_TTL_MS).toBeLessThanOrEqual(6 * 3600_000));
  it('the manifest opens the icon on /welcome?k=', async () => {
    const k = newVerifier();
    const res = await GET(new Request(`https://x.test/api/public/manifest?k=${k}`));
    expect((await res.json()).start_url).toBe(`/welcome?k=${k}`);
  });
  it('a malformed key falls back to the feed', async () => {
    const res = await GET(new Request('https://x.test/api/public/manifest?k=short'));
    expect((await res.json()).start_url).toBe('/feed');
  });
});
