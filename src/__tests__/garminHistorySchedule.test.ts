import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The scheduled driver over the Garmin history backfill.
 *
 * The backfill itself was already resumable and is tested in
 * `garminHistoryBackfill.test.ts`; what is new here is that nobody has to read
 * `nextPage` out of a response and type it into the next request. So what these
 * cases pin is the bookkeeping, which is the only part that can silently rot: the
 * cursor advances, a finished athlete is never walked again (the one bug that
 * would spend the club's shared Garmin credential forever), a thrown walk leaves
 * the page where it was, and the round-robin means one dead credential cannot
 * park itself at the head of the queue.
 */

let walkCalls: Array<{ athleteId?: string | null; fromPage?: number; maxPages?: number }>;
/** What the fake walk returns, keyed by athlete. `Error` to make it throw. */
let walkResults: Map<string, { imported: number; nextPage: number | null; oldestStored: string | null } | Error>;

vi.mock('@/lib/garmin/history-backfill', () => ({
  backfillGarminHistory: async (_s: unknown, options: { athleteId?: string; fromPage?: number; maxPages?: number }) => {
    walkCalls.push(options);
    const outcome = walkResults.get(options.athleteId || '') ?? { imported: 0, nextPage: null, oldestStored: null };
    if (outcome instanceof Error) throw outcome;
    return {
      athletes: [{
        athleteId: options.athleteId!,
        name: null,
        imported: outcome.imported,
        scanned: outcome.imported,
        pagesFetched: 2,
        oldestStored: outcome.oldestStored,
        nextPage: outcome.nextPage,
      }],
      imported: outcome.imported,
      more: outcome.nextPage != null,
    };
  },
}));

import {
  HISTORY_CURSOR_KEY,
  historyImportStatus,
  runScheduledHistoryBackfill,
  type HistoryCursors,
} from '@/lib/garmin/history-schedule';

/** Athlete ids the fake roster reports as having a Garmin credential. */
let garminAthletes: string[];
/** The single `app_settings` row this store holds, as the route would see it. */
let settingValue: string | null;
let upserts: number;

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === 'athletes') {
        const result = Promise.resolve({ data: garminAthletes.map((id) => ({ id })), error: null });
        const chain: Record<string, unknown> = {
          select: () => chain,
          not: () => chain,
          then: (...args: Parameters<typeof result.then>) => result.then(...args),
        };
        return chain;
      }
      if (table === 'app_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: settingValue == null ? null : { value: settingValue }, error: null }),
            }),
          }),
          upsert: (row: { key: string; value: string }) => {
            expect(row.key).toBe(HISTORY_CURSOR_KEY);
            settingValue = row.value;
            upserts++;
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

const cursors = (): HistoryCursors => JSON.parse(settingValue || '{}');

beforeEach(() => {
  walkCalls = [];
  walkResults = new Map();
  garminAthletes = ['a1'];
  settingValue = null;
  upserts = 0;
});

describe('runScheduledHistoryBackfill', () => {
  it('starts an unwalked athlete at page 1 and records where to resume', async () => {
    walkResults.set('a1', { imported: 7, nextPage: 3, oldestStored: '2025-02-01T06:00:00Z' });

    const result = await runScheduledHistoryBackfill(fakeSupabase());

    expect(walkCalls).toEqual([{ athleteId: 'a1', maxPages: 2, fromPage: 1 }]);
    expect(result).toMatchObject({ imported: 7, remaining: 1 });
    expect(cursors().a1).toMatchObject({ page: 3, imported: 7, oldest: '2025-02-01T06:00:00Z', error: null });
  });

  it('resumes from the stored page and adds to the running total', async () => {
    settingValue = JSON.stringify({
      a1: { page: 3, imported: 7, pages: 2, oldest: '2025-02-01T06:00:00Z', updatedAt: '2026-09-01T05:00:00Z' },
    });
    walkResults.set('a1', { imported: 4, nextPage: 5, oldestStored: '2024-11-01T06:00:00Z' });

    await runScheduledHistoryBackfill(fakeSupabase());

    expect(walkCalls[0].fromPage).toBe(3);
    expect(cursors().a1).toMatchObject({ page: 5, imported: 11, pages: 4, oldest: '2024-11-01T06:00:00Z' });
  });

  /**
   * The expensive bug, and the reason this returns null rather than an empty
   * report: a driver that kept asking Garmin for pages past the end of a drained
   * athlete would burn the club's one shared credential every five minutes,
   * forever, for nothing.
   */
  it('goes quiet once every athlete is drained', async () => {
    settingValue = JSON.stringify({
      a1: { page: null, imported: 40, pages: 12, oldest: '2023-01-01T06:00:00Z', updatedAt: '2026-09-01T05:00:00Z' },
    });

    expect(await runScheduledHistoryBackfill(fakeSupabase())).toBeNull();
    expect(walkCalls).toEqual([]);
    expect(upserts).toBe(0);
  });

  it('walks one athlete per tick, least-recently-touched first', async () => {
    garminAthletes = ['a1', 'a2', 'a3'];
    settingValue = JSON.stringify({
      a1: { page: 4, imported: 1, pages: 6, oldest: null, updatedAt: '2026-09-01T09:00:00Z' },
      a2: { page: 2, imported: 1, pages: 2, oldest: null, updatedAt: '2026-09-01T07:00:00Z' },
    });
    walkResults.set('a3', { imported: 1, nextPage: 3, oldestStored: null });

    // a3 has never been walked at all, so it sorts ahead of both stored cursors.
    await runScheduledHistoryBackfill(fakeSupabase());
    expect(walkCalls.map((c) => c.athleteId)).toEqual(['a3']);
  });

  /**
   * A revoked credential must not park itself at the head of the queue: the
   * failed athlete keeps its page (so the same offset is retried) but its
   * `updatedAt` moves, which sends it behind everyone still waiting.
   */
  it('keeps the page after a failed walk and yields the next tick to someone else', async () => {
    garminAthletes = ['dead', 'ok'];
    settingValue = JSON.stringify({
      dead: { page: 2, imported: 0, pages: 2, oldest: null, updatedAt: '2026-09-01T07:00:00Z' },
      ok: { page: 6, imported: 3, pages: 10, oldest: null, updatedAt: '2026-09-01T08:00:00Z' },
    });
    walkResults.set('dead', new Error('garmin auth failed'));
    walkResults.set('ok', { imported: 2, nextPage: 7, oldestStored: '2025-05-05T06:00:00Z' });

    await runScheduledHistoryBackfill(fakeSupabase());
    expect(cursors().dead).toMatchObject({ page: 2, error: 'garmin auth failed' });

    await runScheduledHistoryBackfill(fakeSupabase());
    expect(walkCalls.map((c) => c.athleteId)).toEqual(['dead', 'ok']);
  });

  it('does nothing when nobody has a Garmin credential', async () => {
    garminAthletes = [];
    expect(await runScheduledHistoryBackfill(fakeSupabase())).toBeNull();
    expect(upserts).toBe(0);
  });
});

describe('historyImportStatus', () => {
  const cursor = { page: null, imported: 40, pages: 12, oldest: '2023-01-01T06:00:00Z', updatedAt: 'x' };

  it('claims complete only when the walk actually ran out of pages', () => {
    expect(historyImportStatus(cursor, true)).toEqual({ state: 'complete', oldest: '2023-01-01T06:00:00Z', imported: 40 });
    expect(historyImportStatus({ ...cursor, page: 4 }, true).state).toBe('importing');
  });

  it('says nothing about an athlete the schedule has not reached, or one with no Garmin', () => {
    expect(historyImportStatus(undefined, true)).toEqual({ state: 'none', oldest: null, imported: 0 });
    // Disconnected since: a claim about a credential they revoked would be a lie.
    expect(historyImportStatus(cursor, false).state).toBe('none');
  });
});
