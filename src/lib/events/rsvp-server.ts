import type { SupabaseClient } from '@supabase/supabase-js';
import { promotionsFor } from './rsvp';

/**
 * Fill free spots from the waitlist, oldest first (lib/events/rsvp.ts). Returns the
 * promoted athlete ids. Called after a cancel and after any capacity change.
 */
export async function rebalanceWaitlist(db: SupabaseClient, eventId: string, capacity: number | null): Promise<string[]> {
  const [{ count: registered, error: cErr }, { data: waiting, error: wErr }] = await Promise.all([
    db.from('event_registrations').select('id', { count: 'exact', head: true }).eq('event_id', eventId).eq('status', 'registered'),
    db.from('event_registrations').select('id, athlete_id, created_at').eq('event_id', eventId).eq('status', 'waitlisted')
      .order('created_at', { ascending: true }).limit(500),
  ]);
  if (cErr) throw cErr;
  if (wErr) throw wErr;
  const rows = (waiting ?? []) as Array<{ id: string; athlete_id: string }>;
  const ids = promotionsFor(capacity, registered ?? 0, rows);
  if (!ids.length) return [];
  const { error } = await db.from('event_registrations').update({ status: 'registered' }).in('id', ids).eq('status', 'waitlisted');
  if (error) throw error;
  const byId = new Map(rows.map((r) => [r.id, r.athlete_id]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}
