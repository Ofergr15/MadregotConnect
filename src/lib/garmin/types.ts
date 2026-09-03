export interface GarminAuth {
  email: string;
  tokens: Record<string, unknown>;
  lastAuth: string;
}

export interface GarminWorkout {
  workoutName: string;
  description?: string;
  sportType: { sportTypeId: number; sportTypeKey: string };
  workoutSegments: GarminWorkoutSegment[];
}

export interface GarminWorkoutSegment {
  segmentOrder: number;
  sportType: { sportTypeId: number; sportTypeKey: string };
  workoutSteps: GarminWorkoutStep[];
}

export interface GarminWorkoutStep {
  type: 'ExecutableStepDTO' | 'RepeatGroupDTO';
  stepOrder: number;
  stepType: { stepTypeId: number; stepTypeKey: string };
  endCondition: { conditionTypeId: number; conditionTypeKey: string };
  endConditionValue?: number;
  targetType: { workoutTargetTypeId: number; workoutTargetTypeKey: string };
  targetValueOne?: number;
  targetValueTwo?: number;
  description?: string;
  numberOfIterations?: number;
  workoutSteps?: GarminWorkoutStep[];
}

/**
 * A zone → pace-range table: the shape the converter can read a pace out of.
 *
 * Nothing in this database has ever held one. It exists as the *target* shape —
 * `getDefaultPaceProfile()` builds one, and the converter tests inject it — so
 * treat it as a capability the converter supports, not as a description of the
 * `pace_profile` column. See `StoredPaceProfile`.
 */
export interface PaceProfile {
  easy: { min: number; max: number };
  threshold: { min: number; max: number };
  interval: { min: number; max: number };
  tempo: { min: number; max: number };
  sprint: { min: number; max: number };
  marathon_pace: { min: number; max: number };
}

/**
 * What `groups.pace_profile` and `academy_bands.pace_profile` actually hold:
 * a goal and a sec/km offset. No zone table, no per-zone paces.
 *
 * Written by `/api/groups` and `/api/academy/bands`; live values are
 * `{ marathonGoal: 'SUB 2:30', offsetSeconds: 0 }` and the two like it. Also
 * mirrored as `BandPaceProfile` in `@/lib/academy/bands`, which is the
 * academy-side reader.
 */
export interface OffsetPaceProfile {
  marathonGoal?: string;
  offsetSeconds?: number;
  level?: string;
}

/**
 * Either shape may come out of a `pace_profile` column, and in production it is
 * always the offset one — so anything reading that column has to cope with a
 * profile that carries no zone paces at all rather than assume a table it can
 * index. This union is deliberately not narrowed by a cast at the call site:
 * casting `{marathonGoal, offsetSeconds}` to `PaceProfile` is exactly what let
 * `getPaceForZone` return undefined and crash a whole athlete's push.
 */
export type StoredPaceProfile = Partial<PaceProfile> | OffsetPaceProfile;

export interface GarminActivity {
  activityId: number;
  activityName: string;
  activityType: string;
  startTimeLocal: string;
  distance: number;
  duration: number;
  movingDuration: number;
  averageSpeed: number;
  maxSpeed: number;
  averageHR: number | null;
  maxHR: number | null;
  calories: number;
  elevationGain: number | null;
  elevationLoss: number | null;
  averageRunningCadence: number | null;
  avgStrideLength: number | null;
  vO2MaxValue: number | null;
  lapCount: number | null;
  locationName: string | null;
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
  hasPolyline: boolean;
  steps: number | null;
}
