// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Task 147: the viewer page renders the stale fallbacks.
const NOW = Date.parse('2026-12-06T09:00:00Z');
const board = { current: null as unknown };
vi.mock('@/lib/api', () => ({ useApi: () => ({ data: board.current, error: null }) }));
vi.mock('@/components/FeedAvatar', () => ({ FeedAvatar: () => null }));

const { default: Page } = await import('@/app/(app)/dashboard/race-live/[eventId]/page');
const runner = (id: string, msAgo: number | null, extra: Record<string, unknown> = {}) => ({
  athleteId: id, name: `R${id}`, avatarUrl: null, bib: null, isSelf: false,
  state: 'running', splits: [], lastPoint: 'half', lastSec: 5400, predictedSec: null,
  position: msAgo == null ? null : { distanceM: 25000, elapsedSec: 6000, at: new Date(NOW - msAgo).toISOString() },
  ...extra,
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

async function renderAt(runners: unknown[]) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  board.current = { enabled: true, active: true, runners };
  let out!: ReturnType<typeof render>;
  await act(async () => { out = render(<Page params={Promise.resolve({ eventId: 'e1' })} />); });
  return out;
}

describe('race-live viewer page — stale fallbacks', () => {
  it('a stale row shows "עודכן לפני X דק׳" and the last split; the board banner appears', async () => {
    const { container, getByTestId } = await renderAt([runner('1', 5 * 60_000)]);
    expect(container.textContent).toContain('עודכן לפני 5 דק׳');
    expect(getByTestId('stale-split').textContent).toContain('חצי · 1:30:00');
    expect(getByTestId('board-stale').textContent).toContain('עודכן לפני 5 דק׳');
  });
  it('with one fresh runner: no banner, the fresh row has no "עודכן"', async () => {
    const { queryByTestId, container } = await renderAt([runner('1', 5 * 60_000), runner('2', 20_000)]);
    expect(queryByTestId('board-stale')).toBeNull();
    expect(container.querySelector('[data-stale="0"]')!.textContent).not.toContain('עודכן');
  });
});
