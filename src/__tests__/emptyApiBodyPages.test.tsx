// @vitest-environment happy-dom
/**
 * Home (/), /dashboard/week and /dashboard/records rendered with every API answering `{}`
 * (a partial/empty body: a proxy error page, a deploy mid-swap, the a11y run's fixture).
 * All three used to throw (`stats.topResults.length`, `data.staff.find`, `data.boards[…]`)
 * and show the crash screen; now each renders its empty state. Stubbed: fetch, the API hook,
 * the router and the Supabase session (logged out). Nothing reaches a network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import he from '../../messages/he.json';

const router = { replace: vi.fn(), push: vi.fn(), prefetch: vi.fn(), back: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }), setSession: async () => ({ error: null }) } }),
}));
vi.mock('@/lib/auth/silent-reauth', () => ({ trySilentReauth: async () => null }));
vi.mock('@/lib/api', () => ({
  useApi: (key: string | null) => ({ data: key ? {} : undefined, error: undefined, isLoading: false, isStale: false, mutate: vi.fn(async () => undefined) }),
  apiHeaders: vi.fn(async () => ({})),
}));

import HomePage from '@/app/page';
import WeekSetupPage from '@/app/(app)/dashboard/week/page';
import ClubRecordsPage from '@/app/(app)/dashboard/records/page';
import { normalizePublicStats } from '@/lib/public-stats';
import { normalizeWeekData } from '@/lib/week-setup/normalize';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let errors: string[] = [];

async function render(Page: React.ComponentType) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host, { onUncaughtError: (e) => { errors.push(String(e)); } });
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="he" messages={he} timeZone="Asia/Jerusalem">
        <Page />
      </NextIntlClientProvider>,
    );
  });
  // Let the effects' fetches (`{}`) land and re-render.
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return host;
}

beforeEach(() => {
  errors = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('pages on an empty API body ({})', () => {
  it('Home renders the public page, no stats band, no throw', async () => {
    const host = await render(HomePage);
    expect(errors).toEqual([]);
    expect(host.textContent?.length).toBeGreaterThan(0);
  });

  it('/dashboard/week renders an empty week, no throw', async () => {
    const host = await render(WeekSetupPage);
    expect(errors).toEqual([]);
    expect(host.textContent).toContain(he.weekSetup.title);
  });

  it('/dashboard/records renders the empty champions board, no throw', async () => {
    const host = await render(ClubRecordsPage);
    expect(errors).toEqual([]);
    expect(host.textContent).toContain(he.records.title);
    expect(host.textContent).toContain('עוד אין תוצאות רשמיות כאן');
    expect(host.textContent).not.toContain('מחכה למיגרציה 163');
  });
});

describe('normalizers', () => {
  it('normalizePublicStats: {} → zeros and an empty list; non-objects → null', () => {
    expect(normalizePublicStats({})).toEqual({ since: undefined, athletes: 0, totalKm: 0, workouts: 0, totalHours: 0, topResults: [], testDate: null });
    expect(normalizePublicStats(null)).toBeNull();
    expect(normalizePublicStats([])).toBeNull();
    const full = { since: '2025-01-01', athletes: 3, totalKm: 10, workouts: 2, totalHours: 1, topResults: [{ name: 'A', timeSeconds: 600, test: '3k' }], testDate: '2026-11-01' };
    expect(normalizePublicStats(full)).toEqual(full);
  });

  it('normalizeWeekData: {} → an empty week with every list present', () => {
    const d = normalizeWeekData({}, '2026-11-22');
    expect(d.weekStart).toBe('2026-11-22');
    expect(d.days).toEqual([]);
    expect(d.staff).toEqual([]);
    expect(d.log).toEqual([]);
    expect(d.me).toEqual({ id: null, admin: false, coach: false, approver: false });
    expect(d.readiness.total).toBeGreaterThan(0);
    expect(d.plan).toEqual({ status: 'none', createdAt: null });
  });
});
