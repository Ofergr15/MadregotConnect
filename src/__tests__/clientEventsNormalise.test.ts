import { describe, it, expect } from 'vitest';
import { normaliseClientEvents, type ClientEventRow } from '@/lib/bugs/client-events';
import { TEST_ACCOUNT_IDS, TEST_RUNNER_ID } from '@/lib/auth/test-accounts';

/**
 * What the nightly detectors read (batch 10-17). Each case is a real finding:
 * #120 was the lab's Test Runner, and #118's "versions: ?" hid that the crash came
 * from 2.41.171, a build already fixed by 2.41.175.
 */
const ev = (over: Partial<ClientEventRow>): ClientEventRow => ({
  id: Math.random().toString(36).slice(2),
  athlete_id: 'm1',
  kind: 'boot',
  route: '/feed',
  message: null,
  app_version: null,
  created_at: '2026-10-16T09:00:00Z',
  ...over,
});

describe('normaliseClientEvents', () => {
  it('drops the lab accounts', () => {
    const out = normaliseClientEvents([ev({ athlete_id: TEST_RUNNER_ID, app_version: '2.41.176' }), ev({})], TEST_ACCOUNT_IDS);
    expect(out.map(e => e.athlete_id)).toEqual(['m1']);
  });

  it('reads an old boot\'s version from its message', () => {
    const [b] = normaliseClientEvents([ev({ message: '2.41.171' })], TEST_ACCOUNT_IDS);
    expect(b.app_version).toBe('2.41.171');
  });

  it('leaves the new boot message (app/browser) alone', () => {
    const [b] = normaliseClientEvents([ev({ message: 'app', app_version: '2.41.185' })], TEST_ACCOUNT_IDS);
    expect(b.app_version).toBe('2.41.185');
  });

  it('gives an error the version of the last boot before it, not a later one', () => {
    const out = normaliseClientEvents([
      ev({ message: '2.41.171', created_at: '2026-10-16T09:02:00Z' }),
      ev({ kind: 'error', route: '/dashboard/program', message: 'getOrInsertComputed is not a function', created_at: '2026-10-16T09:03:00Z' }),
      ev({ message: '2.41.178', created_at: '2026-10-16T18:00:00Z' }),
    ], TEST_ACCOUNT_IDS);
    expect(out.find(e => e.kind === 'error')!.app_version).toBe('2.41.171');
  });

  it('an error with no earlier boot stays unknown rather than guessed', () => {
    const out = normaliseClientEvents([ev({ kind: 'error', created_at: '2026-10-16T08:00:00Z' }), ev({ message: '2.41.171' })], TEST_ACCOUNT_IDS);
    expect(out.find(e => e.kind === 'error')!.app_version).toBeNull();
  });
});
