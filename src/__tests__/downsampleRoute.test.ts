import { describe, expect, it } from 'vitest';
import { downsampleRoute } from '@/lib/run-chat/attachments';

describe('downsampleRoute', () => {
  it('returns an empty list for non-array GPS payloads', () => {
    expect(
      downsampleRoute({
        type: 'LineString',
        coordinates: [
          [34.8, 32.1],
          [34.81, 32.11],
        ],
      }),
    ).toEqual([]);
  });

  it('keeps only finite lat/lng points and downsamples', () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      lat: 32 + index / 100,
      lng: 34 + index / 100,
    }));
    points.splice(3, 0, { lat: Number.NaN, lng: 1 });

    const sampled = downsampleRoute(points, 5);
    expect(sampled).toHaveLength(5);
    expect(sampled[0]).toEqual({ lat: 32, lng: 34 });
    expect(sampled[4]).toEqual({ lat: 32.39, lng: 34.39 });
  });
});
