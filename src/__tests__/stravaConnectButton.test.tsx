// @vitest-environment happy-dom
// The profile's "connect Strava" button, rendered for real. Stubbed: `fetch` (the
// /api/strava answer), the session headers and the navigation to Strava. Nothing else.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/lib/api', () => ({ apiHeaders: vi.fn(async () => ({ authorization: 'Bearer test' })) }));
import { StravaConnectButton, startStravaLink } from '@/components/profile/StravaConnectButton';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

async function renderButton(onFailed = vi.fn()) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(StravaConnectButton, { athleteId: 'a1', label: 'Connect', connectingLabel: 'Connecting…', onFailed })); });
  const button = host.querySelector('button')!;
  return { host, button, onFailed, root };
}

beforeEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('StravaConnectButton', () => {
  it.each([[403, { error: 'forbidden' }], [503, { error: 'Could not start Strava linking' }], [200, {}], [500, 'not json']])(
    'HTTP %s: gives the button back (not stuck on "connecting") and reports the failure', async (status, body) => {
      vi.stubGlobal('fetch', answer(status, body));
      const { button, onFailed } = await renderButton();
      await act(async () => { button.click(); });
      expect(button.textContent).toBe('Connect');
      expect(button.disabled).toBe(false);
      expect(onFailed).toHaveBeenCalledTimes(1);
    });
  it('network error: same', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { button, onFailed } = await renderButton();
    await act(async () => { button.click(); });
    expect(button.textContent).toBe('Connect');
    expect(onFailed).toHaveBeenCalledTimes(1);
  });
  it('asks the signed route for its own athlete, with the session, and stays "connecting" while it leaves for Strava', async () => {
    let release!: (r: Response) => void;
    const f = vi.fn(() => new Promise<Response>((r) => { release = r; }));
    vi.stubGlobal('fetch', f);
    const { button } = await renderButton();
    await act(async () => { button.click(); });
    expect(button.textContent).toBe('Connecting…');
    expect(button.disabled).toBe(true);
    expect(f).toHaveBeenCalledWith('/api/strava?athleteId=a1', { headers: { authorization: 'Bearer test' } });
  });
  it('startStravaLink: authUrl → navigates there; switchAccount adds switch=1', async () => {
    const go = vi.fn();
    const f = answer(200, { authUrl: 'https://www.strava.com/oauth/authorize?state=link.x' });
    expect(await startStravaLink('a1', { switchAccount: true }, { fetch: f as never, headers: async () => ({}), go })).toBe('redirected');
    expect(go).toHaveBeenCalledWith('https://www.strava.com/oauth/authorize?state=link.x');
    expect((f.mock.calls[0] as unknown[])[0]).toBe('/api/strava?athleteId=a1&switch=1');
  });
});
