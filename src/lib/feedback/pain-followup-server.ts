import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedCaller } from '@/lib/auth/self-or-staff';
import { callerMaySeePain, painRecipientIds } from './pain-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/**
 * Who works a pain report's follow-up: the people its alert is ROUTED to
 * (painRecipientIds — the pain_report rows of notification_routing via rolesForKind, plus
 * the runner's academy coaches / club coaches), and admins / the super user, who see
 * everything anyway. A coach in scope whom the routing screen switched off can still read
 * the report but does not get the follow-up queue. Never the runner (owner).
 */
export async function mayFollowUp(db: Db, caller: VerifiedCaller, runnerId: string, cache?: Map<string, string[]>): Promise<boolean> {
  if (!caller.athleteId && !caller.isSuperUser) return false;
  if (caller.athleteId === runnerId) return false;
  if ((await callerMaySeePain(db, caller, runnerId)) !== 'staff') return false;
  const roles = caller.roles ?? [caller.role];
  if (caller.isSuperUser || roles.includes('admin')) return true;
  let ids = cache?.get(runnerId);
  if (!ids) {
    ids = (await painRecipientIds(db, runnerId)).ids;
    cache?.set(runnerId, ids);
  }
  return !!caller.athleteId && ids.includes(caller.athleteId);
}
