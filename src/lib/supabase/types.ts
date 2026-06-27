/**
 * Database schema types for MadregotConnect.
 *
 * These types are generated to match the Supabase schema exactly.
 * See supabase/schema.sql for the actual database schema.
 */

/**
 * Represents a running coach who manages athletes and creates workout plans.
 */
export interface Coach {
  id: string; // uuid
  email: string;
  name: string;
  created_at: string; // timestamp
}

/**
 * Represents a group of athletes with shared pace profiles.
 * Used to apply consistent pacing to workout prescriptions.
 */
export interface Group {
  id: string; // uuid
  coach_id: string; // FK to coaches
  name: string;
  /**
   * Pace profile defining different training zones in seconds per kilometer.
   *
   * @example
   * {
   *   "easy": 360,      // 6:00/km
   *   "tempo": 300,     // 5:00/km
   *   "threshold": 270, // 4:30/km
   *   "interval": 240   // 4:00/km
   * }
   */
  pace_profile: {
    easy?: number;
    tempo?: number;
    threshold?: number;
    interval?: number;
    [key: string]: number | undefined;
  };
  created_at: string; // timestamp
}

/**
 * Athlete status values.
 */
export type AthleteStatus = 'active' | 'invited' | 'disconnected';

/**
 * Represents an athlete managed by a coach.
 */
export interface Athlete {
  id: string; // uuid
  coach_id: string; // FK to coaches
  group_id: string | null; // FK to groups, nullable
  name: string;
  email: string;
  /**
   * Encrypted Garmin OAuth tokens and session data.
   * Should be treated as sensitive data.
   *
   * @example
   * {
   *   "access_token": "encrypted_token",
   *   "refresh_token": "encrypted_token",
   *   "expires_at": 1234567890
   * }
   */
  garmin_auth: Record<string, unknown> | null;
  status: AthleteStatus;
  invite_token: string | null;
  created_at: string; // timestamp
}

/**
 * Status of a weekly plan.
 */
export type WeeklyPlanStatus = 'draft' | 'pushed' | 'partial';

/**
 * Represents a week's worth of workout plans created by a coach.
 */
export interface WeeklyPlan {
  id: string; // uuid
  coach_id: string; // FK to coaches
  week_start_date: string; // date (YYYY-MM-DD)
  /**
   * The original text or image URL input from the coach.
   * Could be plain text workout description or URL to an image of a training plan.
   */
  original_input: string;
  /**
   * Structured workout data parsed from the original input.
   *
   * @example
   * {
   *   "monday": {
   *     "type": "easy_run",
   *     "duration": 45,
   *     "pace": "easy",
   *     "description": "45min easy"
   *   },
   *   "tuesday": {
   *     "type": "intervals",
   *     "warmup": 15,
   *     "intervals": [{ "duration": 4, "pace": "threshold", "recovery": 2 }],
   *     "cooldown": 10
   *   }
   * }
   */
  parsed_workouts: Record<string, unknown>;
  status: WeeklyPlanStatus;
  created_at: string; // timestamp
}

/**
 * Status of a workout delivery to an athlete.
 */
export type WorkoutDeliveryStatus = 'pending' | 'success' | 'failed';

/**
 * Represents the delivery of a single workout to a specific athlete's Garmin device.
 */
export interface WorkoutDelivery {
  id: string; // uuid
  plan_id: string; // FK to weekly_plans
  athlete_id: string; // FK to athletes
  workout_date: string; // date (YYYY-MM-DD)
  /**
   * The workout data formatted for Garmin API.
   * Includes steps, intervals, paces calculated from athlete's group profile.
   */
  workout_data: Record<string, unknown>;
  garmin_workout_id: string | null; // Garmin's ID for the workout after successful push
  status: WorkoutDeliveryStatus;
  error_message: string | null;
  created_at: string; // timestamp
}

/**
 * Database schema definition for use with Supabase client.
 */
export interface Database {
  public: {
    Tables: {
      coaches: {
        Row: Coach;
        Insert: Omit<Coach, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Coach, 'id' | 'created_at'>>;
      };
      groups: {
        Row: Group;
        Insert: Omit<Group, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Group, 'id' | 'created_at'>>;
      };
      athletes: {
        Row: Athlete;
        Insert: Omit<Athlete, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
          group_id?: string | null;
          garmin_auth?: Record<string, unknown> | null;
          status?: AthleteStatus;
          invite_token?: string | null;
        };
        Update: Partial<Omit<Athlete, 'id' | 'created_at'>>;
      };
      weekly_plans: {
        Row: WeeklyPlan;
        Insert: Omit<WeeklyPlan, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
          status?: WeeklyPlanStatus;
        };
        Update: Partial<Omit<WeeklyPlan, 'id' | 'created_at'>>;
      };
      workout_deliveries: {
        Row: WorkoutDelivery;
        Insert: Omit<WorkoutDelivery, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
          garmin_workout_id?: string | null;
          status?: WorkoutDeliveryStatus;
          error_message?: string | null;
        };
        Update: Partial<Omit<WorkoutDelivery, 'id' | 'created_at'>>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      athlete_status: AthleteStatus;
      weekly_plan_status: WeeklyPlanStatus;
      workout_delivery_status: WorkoutDeliveryStatus;
    };
  };
}
