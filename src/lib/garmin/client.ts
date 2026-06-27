import { GarminConnect } from 'garmin-connect';
import { GarminAuth, GarminWorkout } from './types';
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
