import { after } from 'next/server';
import { sendWaitingAfterReconnect, withinMs } from '@/lib/watch/reconnect';

/**
 * What a fresh Garmin connection does on the native routes, in parity with the web
 * exchange (lib/garmin/store-auth.ts → /api/athletes/connect's old inline step, and the
 * profile page's follow-up sync):
 *
 *  1. Re-send the workouts waiting for the watch — same helper, same 25 s ceiling, 0 on
 *     timeout or failure. Never fails the connect.
 *  2. Start this athlete's activity sync, after the response (next/server `after`), so the
 *     connect answers at once. Best-effort: a throw is logged by kind and swallowed.
 *
 * Takes only the athlete id the caller resolved from the JWT; never sees the credential.
 */
export async function afterGarminConnect(athleteId: string): Promise<{ watchResent: number }> {
  const watchResent = await withinMs(sendWaitingAfterReconnect(athleteId), 25000, 0);
  try {
    after(async () => {
      try {
        const { runSyncRequest } = await import('@/app/api/garmin/sync-activities/route');
        await runSyncRequest(new Request('http://internal/garmin/sync', {
          method: 'POST',
          body: JSON.stringify({ athleteId }),
        }));
      } catch (e: any) {
        console.error('garmin native connect: sync failed', e?.code ?? e?.name);
      }
    });
  } catch (e: any) {
    console.error('garmin native connect: could not schedule sync', e?.name);
  }
  return { watchResent };
}
