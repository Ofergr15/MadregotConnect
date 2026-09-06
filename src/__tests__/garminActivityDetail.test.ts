import { describe, expect, it } from 'vitest';
import { mapActivityDetail } from '@/lib/garmin/activity-detail';

// The list row Garmin's /activities endpoint returns — the fallback source.
const LIST = {
  startLatitude: 32.0853,
  startLongitude: 34.7818,
  endLatitude: 32.09,
  endLongitude: 34.79,
  averageRunningCadence: 168,
  avgStrideLength: 118,
  vO2MaxValue: 52,
  lapCount: 6,
  locationName: 'Tel Aviv',
  movingDuration: 2400,
};

const ROUTE = [
  { lat: 32.1, lng: 34.8 },
  { lat: 32.11, lng: 34.81 },
  { lat: 32.12, lng: 34.82 },
];

describe('mapActivityDetail', () => {
  it('prefers summaryDTO over the detail root and the list row', () => {
    const out = mapActivityDetail(
      {
        startLatitude: 1,
        endLatitude: 2,
        summaryDTO: { startLatitude: 31.5, startLongitude: 34.5, endLatitude: 31.6, endLongitude: 34.6 },
      },
      LIST,
    );
    expect(out.start_lat).toBe(31.5);
    expect(out.start_lng).toBe(34.5);
    expect(out.end_lat).toBe(31.6);
    expect(out.end_lng).toBe(34.6);
  });

  // The production failure this module exists for: gc.getActivity() returns an
  // object whose every top-level field is null, so the mapper has to reach past
  // it to the list row rather than persisting a row of nulls.
  it('falls back to the list row when every detail field is null', () => {
    const out = mapActivityDetail(
      {
        startLatitude: null,
        startLongitude: null,
        locationName: null,
        vO2MaxValue: null,
        lapCount: null,
        hasPolyline: false,
        summaryDTO: {},
      },
      LIST,
    );
    expect(out.start_lat).toBe(32.0853);
    expect(out.start_lng).toBe(34.7818);
    expect(out.location_name).toBe('Tel Aviv');
    expect(out.vo2max).toBe(52);
    expect(out.lap_count).toBe(6);
    expect(out.avg_cadence).toBe(168);
    expect(out.avg_stride_length).toBe(118);
    expect(out.moving_duration).toBe(2400);
  });

  it('survives a completely absent detail response', () => {
    expect(mapActivityDetail(null, LIST).start_lat).toBe(32.0853);
    expect(mapActivityDetail(undefined, LIST).location_name).toBe('Tel Aviv');
  });

  it('derives has_polyline from the points, never from detail.hasPolyline', () => {
    // The flag lies in both directions; the point array is the only fact.
    expect(mapActivityDetail({ hasPolyline: false, summaryDTO: {} }, LIST, ROUTE).has_polyline).toBe(true);
    expect(mapActivityDetail({ hasPolyline: true, summaryDTO: {} }, LIST, []).has_polyline).toBe(false);
  });

  it('treats a single GPS fix as no route', () => {
    const out = mapActivityDetail(null, LIST, [{ lat: 32.1, lng: 34.8 }]);
    expect(out.has_polyline).toBe(false);
    expect(out.gps_points).toHaveLength(1);
  });

  it('recovers coordinates from the polyline when no source reports them', () => {
    const out = mapActivityDetail({ summaryDTO: {} }, {}, ROUTE);
    expect(out.start_lat).toBe(32.1);
    expect(out.start_lng).toBe(34.8);
    expect(out.end_lat).toBe(32.12);
    expect(out.end_lng).toBe(34.82);
  });

  it('scales summaryDTO stride from metres but leaves the list row in centimetres', () => {
    expect(mapActivityDetail({ summaryDTO: { strideLength: 1.24 } }, LIST).avg_stride_length).toBe(124);
    expect(mapActivityDetail({ summaryDTO: {} }, LIST).avg_stride_length).toBe(118);
  });

  it('treats zero coordinates as absent rather than the Gulf of Guinea', () => {
    const out = mapActivityDetail({ summaryDTO: { startLatitude: 0, startLongitude: 0 } }, LIST);
    expect(out.start_lat).toBe(32.0853);
    expect(out.start_lng).toBe(34.7818);
  });

  it('nulls every field when no source has anything', () => {
    const out = mapActivityDetail(null, {}, []);
    expect(out.start_lat).toBeNull();
    expect(out.location_name).toBeNull();
    expect(out.vo2max).toBeNull();
    expect(out.moving_duration).toBeNull();
    expect(out.has_polyline).toBe(false);
    expect(out.gps_points).toEqual([]);
  });

  it('converts Garmin self-evaluation to the scales the UI shows', () => {
    const out = mapActivityDetail({ summaryDTO: { directWorkoutRpe: 70, directWorkoutFeel: 75 } }, LIST);
    expect(out.perceived_rpe).toBe(7);
    expect(out.perceived_feel).toBe(3);
  });

  // 0 is a legitimate answer for both (RPE 0 / feel 0), so these use != null
  // rather than a truthiness check — unlike every numeric column above.
  it('keeps a zero self-evaluation instead of dropping it', () => {
    const out = mapActivityDetail({ summaryDTO: { directWorkoutRpe: 0, directWorkoutFeel: 0 } }, LIST);
    expect(out.perceived_rpe).toBe(0);
    expect(out.perceived_feel).toBe(0);
  });

  it('leaves self-evaluation null when the athlete never answered on-watch', () => {
    const out = mapActivityDetail({ summaryDTO: {} }, LIST);
    expect(out.perceived_rpe).toBeNull();
    expect(out.perceived_feel).toBeNull();
  });

  // The proof a pushed workout reached the watch: Garmin stamps the resulting
  // activity with the id of the structured workout it was started from, and files
  // it under a different name in each response shape.
  describe('garmin_workout_id', () => {
    it('reads the id from summaryDTO, the detail root, metadataDTO, or the list row', () => {
      expect(mapActivityDetail({ summaryDTO: { workoutId: 1234567 } }, LIST).garmin_workout_id).toBe('1234567');
      expect(mapActivityDetail({ workoutId: '987', summaryDTO: {} }, LIST).garmin_workout_id).toBe('987');
      expect(
        mapActivityDetail({ summaryDTO: {}, metadataDTO: { associatedWorkoutId: 555 } }, LIST).garmin_workout_id,
      ).toBe('555');
      expect(
        mapActivityDetail({ summaryDTO: {} }, { ...LIST, workoutId: 42 }).garmin_workout_id,
      ).toBe('42');
    });

    // A free run has no workout behind it, and 0 is what a coerced null looks
    // like. Either one becoming an id would attribute the run to whichever plan
    // slot happened to collide with it.
    it('is null for a run that was not started from a workout', () => {
      expect(mapActivityDetail({ summaryDTO: {} }, LIST).garmin_workout_id).toBeNull();
      expect(mapActivityDetail({ workoutId: null, summaryDTO: {} }, LIST).garmin_workout_id).toBeNull();
      expect(mapActivityDetail({ workoutId: 0, summaryDTO: {} }, LIST).garmin_workout_id).toBeNull();
      expect(mapActivityDetail(null, {}, []).garmin_workout_id).toBeNull();
    });

    // Kept as a string, not a number: Garmin's ids are big enough that a float
    // round-trip could change one, and workout_deliveries stores text.
    it('keeps a large id exact', () => {
      const out = mapActivityDetail({ summaryDTO: { workoutId: '1234567890123456789' } }, LIST);
      expect(out.garmin_workout_id).toBe('1234567890123456789');
    });
  });
});
