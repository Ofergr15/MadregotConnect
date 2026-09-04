/**
 * enrichStravaActivity's geometry write, which is the one place a stored route
 * can be destroyed.
 *
 * The sync decodes every run's route from the activity list's summary polyline.
 * Enrichment then runs over the newest handful and replaces that coarse trace
 * with the finer one from the streams endpoint. It used to write
 * `gps_points: null` whenever streams came back without a latlng channel, which
 * — now that there is something there to overwrite — would erase the route and,
 * through migration 047's trigger, the feed card's route_preview with it.
 *
 * So these tests pin the direction of the write: streams may upgrade geometry,
 * never remove it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { StravaStreams } from '@/lib/strava/client';
import { enrichStravaActivity } from '@/lib/strava/enrich';

/**
 * A Supabase stand-in that records the patch each `update()` was given.
 *
 * Only the calls enrich actually makes are implemented — the activity update
 * and the GPX upload. `update().eq()` has to resolve to `{ error: null }` while
 * `update().eq().eq()` also works, because enrich chains a second `eq` when it
 * has no row id.
 */
function fakeSupabase() {
  const patches: Array<Record<string, unknown>> = [];

  // Awaiting `update().eq(...)` must resolve, and so must the twice-chained
  // `update().eq().eq()` enrich uses when it has no row id — so this is both a
  // promise and further chainable.
  const eqChain = () => {
    const result = { error: null as null | { code?: string; message?: string } };
    return Object.assign(Promise.resolve(result), { eq: () => Promise.resolve(result) });
  };

  const supabase = {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        patches.push(values);
        return { eq: eqChain };
      },
    }),
    storage: {
      getBucket: async () => ({ data: { name: 'run-chat' } }),
      createBucket: async () => ({ data: null }),
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/run.gpx' } }),
      }),
    },
  };

  return { supabase: supabase as never, patches };
}

function fakeClient(streams: StravaStreams) {
  return {
    getActivityLaps: vi.fn(async () => []),
    getActivity: vi.fn(async () => ({ splits_metric: [] })),
    getActivityStreams: vi.fn(async () => streams),
  } as never;
}

const target = {
  athleteId: 'aaaaaaaa-0000-0000-0000-000000000001',
  stravaActivityId: 42,
  activityName: 'Evening Run',
  startTimeLocal: '2026-09-01T18:00:00',
  rowId: 'row-1',
};

describe('enrichStravaActivity geometry', () => {
  it('stores the streams route when Strava has one', async () => {
    const { supabase, patches } = fakeSupabase();
    const streams: StravaStreams = {
      latlng: { data: [[32.0853, 34.7818], [32.0861, 34.7809], [32.087, 34.7801]] },
      time: { data: [0, 10, 20] },
    };

    await enrichStravaActivity(supabase, fakeClient(streams), target);

    expect(patches).toHaveLength(1);
    expect(patches[0].has_polyline).toBe(true);
    expect(patches[0].gps_points).toEqual([
      { lat: 32.0853, lng: 34.7818 },
      { lat: 32.0861, lng: 34.7809 },
      { lat: 32.087, lng: 34.7801 },
    ]);
  });

  it('leaves geometry untouched when streams carry no route', async () => {
    // The regression this guards: a run whose route the sync had already decoded
    // from the summary polyline. Enrichment has nothing better to offer, so it
    // must not mention these columns at all — writing null would erase the map.
    const { supabase, patches } = fakeSupabase();

    await enrichStravaActivity(supabase, fakeClient({ time: { data: [0, 10] } }), target);

    expect(patches).toHaveLength(1);
    expect(patches[0]).not.toHaveProperty('gps_points');
    expect(patches[0]).not.toHaveProperty('has_polyline');
    // It still records that the run was looked at, so the sync stops re-enriching it.
    expect(patches[0].laps).toEqual([]);
  });

  it('leaves geometry untouched when the latlng channel is present but empty', async () => {
    const { supabase, patches } = fakeSupabase();

    await enrichStravaActivity(supabase, fakeClient({ latlng: { data: [] } }), target);

    expect(patches[0]).not.toHaveProperty('gps_points');
    expect(patches[0]).not.toHaveProperty('has_polyline');
  });
});
