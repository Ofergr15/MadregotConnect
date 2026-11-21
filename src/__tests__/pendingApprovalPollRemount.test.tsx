// @vitest-environment happy-dom
/**
 * The waiting screen must keep polling /api/auth/me after a remount (React StrictMode's
 * development double-mount, a fast refresh), poll from ONE loop only, and leave for '/'
 * once the answer turns 'active'. The old shared-ref guard stopped polling for good.
 */
import { StrictMode } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/api', () => ({ apiHeaders: async () => ({}) }));
vi.mock('@/lib/auth/sign-out', () => ({ signOutEverywhere: async () => {} }));
vi.mock('@/components/ui', () => ({ Spinner: () => null }));
vi.mock('@/components/PushOptIn', () => ({ ApprovalPushOptIn: () => null }));
vi.mock('@/components/ClaimExistingAccount', () => ({ default: () => null }));
vi.mock('@/components/onboarding/InstallStepProvider', () => ({ InstallStepProvider: ({ children }: { children: unknown }) => children }));
vi.mock('@/lib/install/use-computer', () => ({ useIsComputer: () => false }));
vi.mock('@/components/onboarding/journey-ui', () => {
  const Pass = ({ children }: { children?: unknown }) => (children ?? null) as never;
  return { JOURNEY: {}, JourneyCard: Pass, JourneyHero: () => null, JourneyRow: () => null, JourneyScreen: Pass, JourneyTracker: () => null };
});
vi.mock('@/components/onboarding/ApprovalEmailStep', () => ({
  ApprovalEmailSent: () => null, ApprovalEmailStep: () => null, useApprovalContact: () => [{ email: 'x@example.test', known: true }, () => {}],
}));
vi.mock('@/components/ViewAsBanner', () => ({ ViewAsBanner: () => null }));
vi.mock('@/lib/view-as-person', () => ({ useViewAsReadOnly: () => false }));

let membership = 'pending';
let meCalls = 0;
const fetchMock = vi.fn(async (u: string) => {
  if (String(u).includes('/api/auth/me')) { meCalls++; return new Response(JSON.stringify({ membership }), { status: 200 }); }
  return new Response('{}', { status: 200 });
});
let navigatedTo: string | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  membership = 'pending'; meCalls = 0; navigatedTo = null;
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(window, 'location', { configurable: true, value: { set href(v: string) { navigatedTo = v; }, get href() { return 'http://x/pending-approval'; } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const flush = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('waiting screen poll', () => {
  it('under StrictMode it keeps polling every 12 s from a single loop, then leaves for / when active', async () => {
    const { default: Page } = await import('@/app/pending-approval/page');
    render(<StrictMode><Page /></StrictMode>);
    await flush(100);
    const afterMount = meCalls;
    expect(afterMount).toBeGreaterThanOrEqual(1);
    await flush(12_000);
    const afterOne = meCalls;
    expect(afterOne - afterMount).toBe(1);     // exactly one more call: ONE loop, and it did not stop
    await flush(12_000);
    expect(meCalls - afterOne).toBe(1);
    membership = 'active';
    await flush(12_000);
    expect(navigatedTo).toBe('/');
    const atExit = meCalls;
    await flush(36_000);
    expect(meCalls).toBe(atExit);              // stops for good after letting them in
  });
});
