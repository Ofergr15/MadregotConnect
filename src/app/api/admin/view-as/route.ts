import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, mayViewAs, requireSession } from '@/lib/auth-session';
import { COACH_ID } from '@/lib/constants';
import { heldRoles } from '@/lib/auth/roles';
import { viewAsTag, type ViewAsPerson } from '@/lib/auth/view-as';
import { coachIdsByTrainee } from '@/lib/academy/trainee-coaches';
import { REMOVED_STATUS } from '@/lib/admin/entry-queue';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/admin/view-as — everybody the admin can "view as" (lib/auth/view-as.ts),
// with what each one is. Admin-only, and on VIEW_AS_DENY so it is always answered
// as the real admin: the chooser is how you switch from one member to another, so
// it has to keep working while you are looking through somebody else's eyes.
//
// Names, roles, group and coach, plus the row's address and group id for the
// client's stand-in identity. No approval state or connections: the chooser needs
// to find a person, not to audit them, and /api/admin/people is the screen for that.

/** Postgres "column does not exist" — migration 127 not pasted in yet. */
const UNDEFINED_COLUMN = '42703';
const BASE = 'id, name, email, role, status, is_academy, avatar_url, group_id, academy_coach_id';

interface Row {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  is_academy: boolean | null;
  avatar_url: string | null;
  group_id: string | null;
  academy_coach_id?: string | null;
  extra_roles?: string[] | null;
}

export async function GET(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    if (!mayViewAs(auth.user)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const supabase = createServerClient();
    let res = (await supabase
      .from('athletes')
      .select(`${BASE}, extra_roles`)
      .eq('coach_id', COACH_ID)
      .order('name')) as { data: unknown[] | null; error: { code?: string } | null };
    if (res.error?.code === UNDEFINED_COLUMN) {
      res = await supabase.from('athletes').select(BASE).eq('coach_id', COACH_ID).order('name');
    }
    if (res.error) throw res.error;
    const rows = ((res.data || []) as Row[]).filter((r) => r.status !== REMOVED_STATUS);

    const [groups, coachMap] = await Promise.all([
      supabase.from('groups').select('id, name').eq('coach_id', COACH_ID),
      coachIdsByTrainee(supabase, undefined, rows.map((r) => ({ id: r.id, academy_coach_id: r.academy_coach_id ?? null }))),
    ]);
    const groupName = new Map(((groups.data || []) as { id: string; name: string }[]).map((g) => [g.id, g.name]));
    const nameOf = new Map(rows.map((r) => [r.id, r.name || '']));
    const traineesOf = new Map<string, number>();
    for (const r of rows) {
      if (!r.is_academy) continue;
      for (const c of coachMap.get(r.id) ?? []) traineesOf.set(c, (traineesOf.get(c) ?? 0) + 1);
    }

    const people: ViewAsPerson[] = rows
      // Yourself is not somebody to view as.
      .filter((r) => r.id !== auth.user.athleteId)
      .map((r) => {
        const tag = viewAsTag(heldRoles(r.role, r.extra_roles), r.is_academy === true);
        const coachId = tag === 'trainee' ? (coachMap.get(r.id) ?? [])[0] : undefined;
        return {
          id: r.id,
          name: r.name || '',
          tag,
          avatarUrl: r.avatar_url || null,
          email: r.email || null,
          groupId: r.group_id || null,
          groupName: (r.group_id && groupName.get(r.group_id)) || null,
          coachName: (coachId && nameOf.get(coachId)) || null,
          trainees: traineesOf.get(r.id) ?? 0,
        };
      });

    return NextResponse.json({ people });
  } catch (error) {
    console.error('GET /api/admin/view-as failed:', error);
    return NextResponse.json({ error: 'Failed to list people' }, { status: 500 });
  }
}
