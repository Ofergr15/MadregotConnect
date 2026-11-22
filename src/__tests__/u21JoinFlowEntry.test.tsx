// @vitest-environment happy-dom
/**
 * The U21 section must render on the LIVE registration screen.
 *
 * The first version of this change patched /register's classic and onboarding-v2
 * looks — but JOIN_UNIFIED_FOR_ALL=true means strangers actually get JoinFlow's
 * path step, and nothing showed on the deployed preview. These tests mount the
 * real JoinFlow so the section's presence is verified on the screen people see,
 * not on a dead render path.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JoinFlow } from '@/components/join/JoinFlow';
import { U21RegisterEntry } from '@/app/register/U21RegisterEntry';
import { TEST_PREVIEW_NOTE, U21_TRACKS } from '@/lib/u21/intake';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

// The server flag u21_entry, as GET /api/features/public answers it. JoinFlow also asks for the
// pace groups on mount; the path step does not need them.
let flag: boolean | undefined = true;
const stubFetch = () => vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
  json: () => Promise.resolve(String(url).includes('/api/features/public') ? { features: flag === undefined ? {} : { u21_entry: flag } } : { groups: [] }),
})));
beforeEach(() => { flag = true; stubFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('U21 entry is default OFF (server flag u21_entry)', () => {
  it.each([false, undefined])('flag %s → nothing, on its own and inside JoinFlow', async (v) => {
    flag = v;
    const a = render(<U21RegisterEntry />);
    await tick();
    expect(a.queryByTestId('u21-register-entry')).toBeNull();
    cleanup();
    const b = render(<JoinFlow />);
    await tick();
    expect(b.queryByTestId('u21-register-entry')).toBeNull();
  });
  it('a failing flag read → nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const a = render(<U21RegisterEntry />);
    await tick();
    expect(a.queryByTestId('u21-register-entry')).toBeNull();
  });
});

describe('U21RegisterEntry (the section itself)', () => {
  it('offers every track as a deep link into the intake, with the test-preview note', async () => {
    const { findByTestId } = render(<U21RegisterEntry />);
    const sec = await findByTestId('u21-register-entry');
    expect(sec.textContent).toContain('U21');
    expect(sec.textContent).toContain(TEST_PREVIEW_NOTE);
    const hrefs = [...sec.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs.sort()).toEqual(U21_TRACKS.map(t => `/u21?track=${t.id}`).sort());
  });

  it('asks for no Strava/Google connection and shows no prices (demo stage)', async () => {
    const { findByTestId } = render(<U21RegisterEntry />);
    const sec = await findByTestId('u21-register-entry');
    expect(sec.textContent).toContain('סטראבה');
    expect(sec.textContent).toContain('גוגל');
    expect(sec.textContent).not.toContain('₪');
  });
});

describe('the live registration screen (JoinFlow path step)', () => {
  it('renders the U21 section at the bottom, after the club/academy choice', async () => {
    const { getByTestId, findByTestId } = render(<JoinFlow />);
    const sec = await findByTestId('u21-register-entry');
    const screen = getByTestId('join-path');
    expect(screen.contains(sec)).toBe(true);
    // Bottom means after the "not sure?" guidance line that closes the picker.
    const unsure = [...screen.querySelectorAll('p')].find(p => p.textContent?.includes('לא בטוח'));
    expect(unsure).toBeTruthy();
    expect(unsure!.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const hrefs = [...sec.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs.sort()).toEqual(U21_TRACKS.map(t => `/u21?track=${t.id}`).sort());
  });
});
