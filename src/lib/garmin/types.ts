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

export interface PaceProfile {
  easy: { min: number; max: number };
  threshold: { min: number; max: number };
  interval: { min: number; max: number };
  tempo: { min: number; max: number };
  sprint: { min: number; max: number };
  marathon_pace: { min: number; max: number };
}

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
