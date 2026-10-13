import { hasRole } from '@/lib/auth/roles';
import { COACH_ID } from '@/lib/constants';
import { isAcademyManager } from './pairing-server';
import { traineeIdsOfCoach } from './trainee-coaches';

type Db = { from: (table: string) => any };

/**
 * Whose records a STAFF caller may read in a club-wide list (launch report BL9 / N8c, N8d).
 *
 * "Staff" includes academy coaches, and the club-wide lists — workout feedback with pain
 * details, pending benchmark results — handed an academy coach every club member's rows.
 *
 *  - `null` — the whole club: the super user, an admin, an approver, a club `coach`;
 *  - every academy member — an academy manager (the academy is theirs, the club is not);
 *  - the caller's own trainees — an academy coach.
 */
export interface ScopeCaller {
  isSuperUser: boolean;
  canApprove?: boolean;
  athleteId: string | null;
  role?: string | null;
  roles?: string[];
}

export function isClubStaff(caller: ScopeCaller): boolean {
  return caller.isSuperUser || !!caller.canApprove || hasRole(caller, 'admin') || hasRole(caller, 'coach');
}

export async function staffAthleteScope(supabase: Db, caller: ScopeCaller): Promise<Set<string> | null> {
  if (isClubStaff(caller)) return null;
  if (isAcademyManager({ isSuperUser: caller.isSuperUser, role: caller.role, roles: caller.roles })) {
    try {
      const { data } = await supabase.from('athletes').select('id').eq('coach_id', COACH_ID).eq('is_academy', true);
      return new Set(((data || []) as Array<{ id: string }>).map((r) => r.id));
    } catch {
      return new Set();
    }
  }
  if (!caller.athleteId) return new Set();
  return new Set(await traineeIdsOfCoach(supabase as never, caller.athleteId).catch(() => [] as string[]));
}

export function inScope<T>(rows: T[] | null | undefined, scope: Set<string> | null, idOf: (r: T) => string | null | undefined): T[] {
  const list = rows || [];
  if (!scope) return list;
  return list.filter((r) => {
    const id = idOf(r);
    return !!id && scope.has(id);
  });
}
