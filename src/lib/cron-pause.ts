import { createServerClient } from '@/lib/supabase/server';

/**
 * A kill switch for every Vercel cron: app_settings `cron_paused` = 'on'.
 *
 * Maintenance mode gates people, not the schedule, so during the database move
 * (lib/move/state.ts) the crons kept running across the switch: a tick against
 * the frozen old database errors, and one against the new database while
 * maintenance is still on delivers due notifications to the allow-list only and
 * marks them sent for everyone. Paused, a cron answers 200 and does nothing; the
 * cutover turns it on before the freeze and off when the club is let back in.
 *
 * Fails OPEN like readMaintenance: a read that did not answer must not stop the
 * club's reminders.
 */
export async function cronPaused(): Promise<boolean> {
  try {
    const { data } = await createServerClient().from('app_settings').select('value').eq('key', 'cron_paused').maybeSingle();
    return data?.value === 'on';
  } catch {
    return false;
  }
}
