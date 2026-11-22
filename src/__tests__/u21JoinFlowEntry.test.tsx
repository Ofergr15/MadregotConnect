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

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_U21_ENTRY', '1');
  // JoinFlow asks for the pace groups on mount; the path step does not need them.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ groups: [] }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('U21 entry is default OFF', () => {
  it('renders nothing without NEXT_PUBLIC_U21_ENTRY=1, on its own and inside JoinFlow', () => {
    vi.stubEnv('NEXT_PUBLIC_U21_ENTRY', '');
    expect(render(<U21RegisterEntry />).queryByTestId('u21-register-entry')).toBeNull();
    cleanup();
    expect(render(<JoinFlow />).queryByTestId('u21-register-entry')).toBeNull();
  });
});

describe('U21RegisterEntry (the section itself)', () => {
  it('offers every track as a deep link into the intake, with the test-preview note', () => {
    const { getByTestId } = render(<U21RegisterEntry />);
    const sec = getByTestId('u21-register-entry');
    expect(sec.textContent).toContain('U21');
    expect(sec.textContent).toContain(TEST_PREVIEW_NOTE);
    const hrefs = [...sec.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs.sort()).toEqual(U21_TRACKS.map(t => `/u21?track=${t.id}`).sort());
  });

  it('asks for no Strava/Google connection and shows no prices (demo stage)', () => {
    const { getByTestId } = render(<U21RegisterEntry />);
    const sec = getByTestId('u21-register-entry');
    expect(sec.textContent).toContain('סטראבה');
    expect(sec.textContent).toContain('גוגל');
    expect(sec.textContent).not.toContain('₪');
  });
});

describe('the live registration screen (JoinFlow path step)', () => {
  it('renders the U21 section at the bottom, after the club/academy choice', () => {
    const { getByTestId } = render(<JoinFlow />);
    const screen = getByTestId('join-path');
    const sec = getByTestId('u21-register-entry');
    expect(screen.contains(sec)).toBe(true);
    // Bottom means after the "not sure?" guidance line that closes the picker.
    const unsure = [...screen.querySelectorAll('p')].find(p => p.textContent?.includes('לא בטוח'));
    expect(unsure).toBeTruthy();
    expect(unsure!.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const hrefs = [...sec.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs.sort()).toEqual(U21_TRACKS.map(t => `/u21?track=${t.id}`).sort());
  });
});
