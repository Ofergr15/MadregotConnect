import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { holdsAcademyCoachRole } from '@/lib/academy/coaches';
import { coachIdsByTrainee } from '@/lib/academy/trainee-coaches';
import { grantedRoles, rolesToColumns, type GrantableRole } from '@/lib/auth/roles';
import { notifyAthlete } from '@/lib/push';
import { roleGrantedCopy } from '@/lib/notifications/copy';
import { WELCOME_PARAM } from '@/lib/role-views';

export const dynamic = 'force-dynamic';

// The academy's coaches, run by its manager. The hierarchy (2026-10-06):
//   admin            names academy managers (the roles screen, admin only)
//   academy manager  names academy coaches (here), runs the funnel, pairs trainees
//   academy coach    sees and coaches only the trainees paired with them
// So this route touches exactly one role, `academy_coach`. Everything else a
// person holds (admin, club coach, academy_manager) is read and written back as
// it was; changing those stays on the admin's roles screen.

interface CoachRow { id: string; name: string; avatar_url: string | null; role: string | null; extra_roles: string[] | null; status: string | null; approved: boolean | null; academy_coach_id: string | null; is_academy: boolean | null }

export interface AcademyCoachesResponse {
  coaches: Array<{ id: string; name: string; avatarUrl: string | null; trainees: number }>;
  /** Approved club members who could be made a coach. */
  candidates: Array<{ id: string; name: string; avatarUrl: string | null }>;
}

async function loadRows() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('athletes')
    .select('id, name, avatar_url, role, extra_roles, status, approved, academy_coach_id, is_academy')
    .eq('coach_id', COACH_ID);
  return { supabase, rows: (data || []) as CoachRow[], error };
}

/**
 * Trainees per coach. A shared trainee counts toward EACH of their coaches — a
 * coach's seats are a coach's time, and a shared trainee takes some of everyone's.
 */
async function coachLoads(
  supabase: ReturnType<typeof createServerClient>,
  rows: Array<{ id: string; is_academy: boolean | null; academy_coach_id: string | null }>,
): Promise<Map<string, number>> {
  const trainees = rows.filter((r) => r.is_academy);
  const map = await coachIdsByTrainee(supabase, undefined, trainees);
  const load = new Map<string, number>();
  for (const ids of map.values()) for (const c of ids) load.set(c, (load.get(c) || 0) + 1);
  return load;
}

/** GET — the academy coaches with their caseload, and who could be added. */
export async function GET(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;
    const { supabase, rows, error } = await loadRows();
    if (error) throw error;

    const load = await coachLoads(supabase, rows);

    const body: AcademyCoachesResponse = {
      coaches: rows
        .filter((r) => holdsAcademyCoachRole(r))
        .map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url, trainees: load.get(r.id) || 0 }))
        .sort((a, b) => b.trainees - a.trainees || a.name.localeCompare(b.name)),
      candidates: rows
        .filter((r) => !holdsAcademyCoachRole(r) && r.approved !== false && r.status !== 'removed' && r.status !== 'disconnected')
        .map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('Academy coaches GET error:', error);
    return NextResponse.json({ error: 'Failed to load the coaches' }, { status: 500 });
  }
}

/**
 * PUT { athleteId, coach: boolean } — make someone an academy coach, or stop.
 * A coach who still holds trainees is not removed (409): move them first, so a
 * trainee can never be left with nobody by a role change.
 */
export async function PUT(request: Request) {
  try {
    const { denied, caller } = await requireAcademyManager(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const athleteId = typeof body?.athleteId === 'string' ? body.athleteId : '';
    if (!athleteId || typeof body?.coach !== 'boolean') {
      return NextResponse.json({ error: 'athleteId and coach (boolean) are required' }, { status: 400 });
    }

    const { supabase, rows, error } = await loadRows();
    if (error) throw error;
    const person = rows.find((r) => r.id === athleteId);
    if (!person) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const before = grantedRoles(person.role, person.extra_roles);
    const isCoach = before.includes('academy_coach');
    if (isCoach === body.coach) return NextResponse.json({ success: true, coach: isCoach });

    if (!body.coach) {
      const holding = (await coachLoads(supabase, rows)).get(athleteId) || 0;
      if (holding > 0) {
        return NextResponse.json({ error: 'coach_has_trainees', trainees: holding }, { status: 409 });
      }
    }

    const wanted: GrantableRole[] = body.coach
      ? [...before, 'academy_coach']
      : before.filter((r) => r !== 'academy_coach');
    const next = rolesToColumns(wanted, person.role);
    const { error: writeError } = await supabase
      .from('athletes')
      .update({ role: next.role, extra_roles: next.extra_roles })
      .eq('id', athleteId);
    if (writeError) throw writeError;

    if (body.coach) {
      // The same "קיבלת תפקיד חדש" the roles screen sends. Best effort.
      try {
        const me = caller.athleteId && caller.athleteId !== athleteId
          ? await supabase.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle()
          : null;
        const by = (me?.data as { name?: string | null } | null)?.name || null;
        await notifyAthlete({
          athleteId,
          kind: 'role_granted',
          actorAthleteId: caller.athleteId,
          copy: (locale) => roleGrantedCopy(locale, { role: 'academy_coach', by }),
          url: `/dashboard?${WELCOME_PARAM}=academy_coach`,
          tag: 'role-granted',
        });
      } catch (err) {
        console.error('Academy coaches: role-granted push failed:', err);
      }
    }
    return NextResponse.json({ success: true, coach: body.coach });
  } catch (error) {
    console.error('Academy coaches PUT error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
