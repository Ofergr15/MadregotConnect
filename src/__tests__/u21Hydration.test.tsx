// @vitest-environment happy-dom
/**
 * /u21 must hydrate cleanly. The server has no `window`, so it always rendered the
 * track picker; a browser opened on /u21?track=basic rendered the questionnaire on
 * its FIRST render (the state initializer read window.location), and React reported
 * "Hydration failed because the server rendered HTML didn't match the client".
 *
 * Here the server HTML is rendered with no query (exactly what the server sees),
 * then hydrated on /u21?track=basic and on /u21: zero hydration errors either way,
 * and the deep link still ends on the questionnaire, the bare URL on the picker.
 */
import { act, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import U21Page from '@/app/u21/page';

afterEach(() => { document.body.innerHTML = ''; window.history.pushState({}, '', '/u21'); vi.restoreAllMocks(); });

async function hydrateAt(url: string) {
  window.history.pushState({}, '', '/u21');
  const html = renderToString(<U21Page />); // what the server sends: no query visible
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  window.history.pushState({}, '', url);
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map(String).join(' ')); });
  const recoverable: string[] = [];
  await act(async () => {
    hydrateRoot(container, <U21Page />, { onRecoverableError: e => recoverable.push(String(e)) });
  });
  return { container, hydrationErrors: [...errors, ...recoverable].filter(m => /hydrat|did not match|didn't match/i.test(m)) };
}

describe('U21 page hydration', () => {
  it('direct open /u21?track=basic: no hydration error, lands on the questionnaire', async () => {
    const { container, hydrationErrors } = await hydrateAt('/u21?track=basic');
    expect(hydrationErrors).toEqual([]);
    await waitFor(() => expect(container.textContent).toContain('שאלון היכרות'));
    expect(container.textContent).toContain('BASIC');
  });

  it('bare /u21: no hydration error, the track picker', async () => {
    const { container, hydrationErrors } = await hydrateAt('/u21');
    expect(hydrationErrors).toEqual([]);
    await waitFor(() => expect(container.textContent).toContain('מדרגות · מאמן אישי U21'));
  });

  it('unknown track falls back to the picker, as before', async () => {
    const { container, hydrationErrors } = await hydrateAt('/u21?track=gold');
    expect(hydrationErrors).toEqual([]);
    await waitFor(() => expect(container.textContent).toContain('מדרגות · מאמן אישי U21'));
  });
});
