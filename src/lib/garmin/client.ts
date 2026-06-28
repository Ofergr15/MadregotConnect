import { GarminConnect } from 'garmin-connect';
import { GarminAuth, GarminWorkout, GarminActivity } from './types';
import { decrypt } from '../encryption';

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

  async createWorkout(workout: GarminWorkout): Promise<string> {
    await this.restoreSession();
    const response = await this.gc.addWorkout(workout as any);
    return response.workoutId?.toString() || '';
  }

  async scheduleWorkout(workoutId: string, date: string): Promise<void> {
    await this.restoreSession();
    const tokens = this.gc.exportToken() as any;
    const accessToken = tokens.oauth2?.access_token;
    if (!accessToken) throw new Error('No access token available for scheduling');

    const res = await fetch(
      `https://connectapi.garmin.com/workout-service/schedule/${workoutId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'NK': 'NT',
          'DI-Backend': 'connectapi.garmin.com',
        },
        body: JSON.stringify({ date }),
      }
    );

    if (!res.ok) {
      throw new Error(`Failed to schedule workout: ${res.status} ${await res.text()}`);
    }
  }

  async deleteWorkout(workoutId: string): Promise<void> {
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
      averageSpeed: a.averageSpeed || 0,
      maxSpeed: a.maxSpeed || 0,
      averageHR: a.averageHR || null,
      maxHR: a.maxHR || null,
      calories: a.calories || 0,
      elevationGain: a.elevationGain || null,
      averageRunningCadence: a.averageRunningCadence || null,
      steps: a.steps || null,
    }));
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
