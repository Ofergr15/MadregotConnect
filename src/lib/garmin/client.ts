import { GarminConnect } from 'garmin-connect';
import { GarminAuth, GarminWorkout, GarminActivity } from './types';
import {
  assertWorkoutOnAccount,
  readCreatedWorkoutId,
  readGarminId,
  readScheduleConfirmation,
  type ScheduleConfirmation,
} from './delivery';
import { decrypt } from '../encryption';
import { parseActivityStream, polylineFromDetails, type ParsedStream } from './streams';

export class GarminClient {
  private gc: GarminConnect;
  private auth: GarminAuth;

  constructor(auth: GarminAuth | string) {
    if (typeof auth === 'string') {
      this.auth = decrypt(auth) as GarminAuth;
    } else {
      this.auth = auth;
    }
    this.gc = new GarminConnect({
      username: this.auth.email,
      password: '',
    });
  }

  static async authenticate(email: string, password: string): Promise<GarminAuth> {
    const gc = new GarminConnect({ username: email, password });
    await gc.login();
    const tokens = gc.exportToken();

    return {
      email,
      tokens: tokens as unknown as Record<string, unknown>,
      lastAuth: new Date().toISOString(),
    };
  }

  async restoreSession(): Promise<void> {
    if (this.auth.tokens) {
      const { oauth1, oauth2 } = this.auth.tokens as any;
      if (oauth1 && oauth2) {
        this.gc.loadToken(oauth1, oauth2);
      }
    }
  }

  /**
   * Create the workout on the athlete's Garmin account. Throws rather than
   * returning a placeholder id when Garmin's response carries none — see
   * `readCreatedWorkoutId`; a caller that gets a string back from here is
   * holding an id Garmin issued.
   */
  async createWorkout(workout: GarminWorkout): Promise<string> {
    await this.restoreSession();
    const response = await this.gc.addWorkout(workout as any);
    return readCreatedWorkoutId(response);
  }

  /**
   * Put the workout on a date in the athlete's Garmin calendar, and return what
   * Garmin says it did — this response used to be thrown away, which is why a
   * schedule landing on the wrong day was invisible.
   */
  async scheduleWorkout(workoutId: string, date: string): Promise<ScheduleConfirmation> {
    if (!workoutId) {
      throw new Error('scheduleWorkout called without a workout id');
    }
    await this.restoreSession();
    const response = await (this.gc as any).client.post(
      `https://connectapi.garmin.com/workout-service/schedule/${workoutId}`,
      { date }
    );
    return readScheduleConfirmation(response, date);
  }

  /**
   * Read a workout back off the account: proof that the create + schedule writes
   * actually stuck, rather than "the POSTs didn't throw". This is as far as
   * verification can go — Garmin exposes nothing about what a *device* holds, so
   * a confirmed workout is one the watch will pull on its next sync, not one
   * already on the wrist.
   *
   * Retried once, because the only expected failure of an immediate read-after-
   * write is a transient one and a false negative here would mark a perfectly
   * good push as failed.
   */
  async verifyWorkoutOnAccount(workoutId: string): Promise<void> {
    await this.restoreSession();
    try {
      assertWorkoutOnAccount(await this.gc.getWorkoutDetail({ workoutId }), workoutId);
    } catch (first) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        assertWorkoutOnAccount(await this.gc.getWorkoutDetail({ workoutId }), workoutId);
      } catch {
        throw first;
      }
    }
  }

  async deleteWorkout(workoutId: string): Promise<void> {
    if (!workoutId) {
      // Rows written before createWorkout started throwing can hold an empty id.
      // The package's own guard says "Missing workout", which reads like a bug in
      // the call rather than a delivery that never happened.
      throw new Error('deleteWorkout called without a workout id — nothing was ever created to delete');
    }
    await this.restoreSession();
    await this.gc.deleteWorkout({ workoutId });
  }

  async getActivities(start = 0, limit = 20): Promise<GarminActivity[]> {
    await this.restoreSession();
    const raw = await this.gc.getActivities(start, limit) as any[];
    return raw.map(a => ({
      activityId: a.activityId,
      activityName: a.activityName || '',
      activityType: a.activityType?.typeKey || 'unknown',
      startTimeLocal: a.startTimeLocal || '',
      distance: a.distance || 0,
      duration: a.duration || 0,
      movingDuration: a.movingDuration || a.duration || 0,
      averageSpeed: a.averageSpeed || 0,
      maxSpeed: a.maxSpeed || 0,
      averageHR: a.averageHR || null,
      maxHR: a.maxHR || null,
      calories: a.calories || 0,
      elevationGain: a.elevationGain || null,
      elevationLoss: a.elevationLoss || null,
      averageRunningCadence: a.averageRunningCadenceInStepsPerMinute || a.averageRunningCadence || null,
      avgStrideLength: a.avgStrideLength || null,
      vO2MaxValue: a.vO2MaxValue || null,
      lapCount: a.lapCount || null,
      locationName: a.locationName || null,
      startLatitude: a.startLatitude || null,
      startLongitude: a.startLongitude || null,
      endLatitude: a.endLatitude || null,
      endLongitude: a.endLongitude || null,
      hasPolyline: a.hasPolyline || false,
      steps: a.steps || null,
      workoutId: readGarminId(a.workoutId),
    }));
  }

  async getActivityFull(activityId: number): Promise<any> {
    await this.restoreSession();
    return this.gc.getActivity({ activityId });
  }

  /**
   * `maxChartSize` is how many samples Garmin will return from the trace, and it is
   * a resolution decision, not a size one. At 2000 a 90-minute run comes back at
   * one sample every 2.7 s, which cannot show a 15-second stride at all and blurs
   * the boundaries of a 400 m rep. Asking for 12000 gets the watch's native ~1 Hz
   * for any run up to about three hours; Garmin caps it silently if it disagrees,
   * which is why the actual interval is measured and stored rather than assumed.
   *
   * The polyline stays at 2000 — that one is genuinely a size decision, and a map
   * does not get better past a couple of thousand points.
   */
  async getActivityDetails(activityId: number, maxChartSize = 2000): Promise<any> {
    await this.restoreSession();
    // Use the library's internal HTTP client which handles auth properly
    return (this.gc as any).client.get(
      `https://connectapi.garmin.com/activity-service/activity/${activityId}/details`,
      { params: { maxChartSize, maxPolylineSize: 2000 } }
    );
  }

  /**
   * The route AND the per-sample trace from ONE details call.
   *
   * The sync used to call this endpoint for the polyline and discard the trace in
   * the same response — the data that answers "did they run the 20 km at 4:25, and
   * did the 8 strides happen" was being thrown away once per activity. Callers that
   * only want the map should keep using `getActivityGpsPoints`.
   *
   * Never throws: a missing trace must cost a run its verdict, not its sync.
   */
  async getActivityTrace(activityId: number, expectedDistanceM?: number): Promise<{
    gpsPoints: Array<{ lat: number; lng: number }>;
    stream: ParsedStream | null;
  }> {
    try {
      const details = await this.getActivityDetails(activityId, 12000);
      return {
        gpsPoints: polylineFromDetails(details),
        stream: parseActivityStream(details, expectedDistanceM),
      };
    } catch {
      return { gpsPoints: [], stream: null };
    }
  }

  /**
   * Fetch the GPS route as [{lat,lng}]. Returns [] when the activity has no GPS
   * (treadmill/indoor) or on any error, so callers can persist a definitive
   * "no route" value.
   */
  async getActivityGpsPoints(activityId: number): Promise<Array<{ lat: number; lng: number }>> {
    try {
      const details = await this.getActivityDetails(activityId);
      const poly = details?.geoPolylineDTO?.polyline;
      if (Array.isArray(poly)) {
        return poly
          .filter((p: any) => p?.lat != null && p?.lon != null)
          .map((p: any) => ({ lat: p.lat, lng: p.lon }));
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * The structured workout this activity was run from, as the DEVICE had it.
   *
   * Not the same thing as fetching `workout-service/workout/{workoutId}`: most of
   * these workouts belong to the coach's account rather than the athlete's, and that
   * endpoint answers 403 for them. This one hangs off the activity, so the athlete's
   * own session can always read it — and it returns the step list Garmin numbered,
   * which is what a lap's `wktStepIndex` points into.
   *
   * `[]` for a run not started from a workout (most runs) and on any error: a run's
   * verdict may go without this, its sync may not.
   */
  async getActivityWorkout(activityId: number): Promise<any[]> {
    await this.restoreSession();
    try {
      const data = await (this.gc as any).client.get(
        `https://connectapi.garmin.com/activity-service/activity/${activityId}/workouts`
      );
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getActivitySplits(activityId: number): Promise<any[]> {
    await this.restoreSession();
    try {
      const data = await (this.gc as any).client.get(
        `https://connectapi.garmin.com/activity-service/activity/${activityId}/splits`
      );
      return data?.lapDTOs || data?.splits || [];
    } catch {
      return [];
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.restoreSession();
      await this.gc.getUserSettings();
      return true;
    } catch {
      return false;
    }
  }
}
