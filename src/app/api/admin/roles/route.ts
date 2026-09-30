import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canGrantAdmin } from '@/lib/constants';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { GRANTABLE_ROLES, grantedRoles, hasRole, rolesToColumns, type GrantableRole, type RolePerson } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// "תפקידים" — who holds which role, and switching them (migration 127).
//
// Admin-only, unlike the single-role dropdown in Settings → Users, which any
// staff account may use: this screen can make somebody an academy manager, and
// that is a management decision. Granting or removing ADMIN itself stays with
// the same accounts that could do it before (the club account and the super
// user) — this screen must not become a second, wider door to it.

/** Postgres "column does not exist" — migration 127 not pasted in yet. */
const UNDEFINED_COLUMN = '42703';

const BASE = 'id, name, email, avatar_url, role, status';

async function requireRoleAdmin(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!caller.isSuperUser && !hasRole(caller, 'admin')) {
    return { denied: NextResponse.json({ error: 'Admin access required' }, { status: 403 }), caller };
  }
  return { denied: null, caller };
}

function mayGrantAdmin(caller: Pick<VerifiedCaller, 'isSuperUser' | 'email'>): boolean {
  return caller.isSuperUser || canGrantAdmin(caller.email);
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await requireRoleAdmin(request);
    if (denied) return denied;

    const supabase = createServerClient();
    let migrated = true;
    // Cast: the column list differs between the two reads, and the rows are
    // read loosely below either way.
    let res = (await supabase.from('athletes').select(`${BASE}, extra_roles`).order('name')) as {
      data: unknown[] | null;
      error: { code?: string } | null;
    };
    if (res.error?.code === UNDEFINED_COLUMN) {
      migrated = false;
      res = await supabase.from('athletes').select(BASE).order('name');
    }
    if (res.error) throw res.error;

    const people: RolePerson[] = ((res.data || []) as any[])
      .filter(a => a.status !== 'removed')
      .map(a => ({
        id: a.id,
        name: a.name || '',
        email: a.email || '',
        avatarUrl: a.avatar_url || null,
        roles: grantedRoles(a.role, a.extra_roles),
      }));

    return NextResponse.json({ people, migrated, canGrantAdmin: mayGrantAdmin(caller) });
  } catch (error) {
    console.error('Failed to list roles:', error);
    return NextResponse.json({ error: 'Failed to list roles' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { denied, caller } = await requireRoleAdmin(request);
    if (denied) return denied;

    const body = (await request.json().catch(() => ({}))) as { athleteId?: unknown; roles?: unknown };
    const athleteId = typeof body.athleteId === 'string' ? body.athleteId : '';
    if (!athleteId || !Array.isArray(body.roles)) {
      return NextResponse.json({ error: 'athleteId and roles are required' }, { status: 400 });
    }
    if (body.roles.some(r => !(GRANTABLE_ROLES as readonly unknown[]).includes(r))) {
      return NextResponse.json({ error: 'Unknown role' }, { status: 400 });
    }
    const wanted = body.roles as GrantableRole[];

    const supabase = createServerClient();
    let migrated = true;
    let found = await supabase.from('athletes').select('id, role, extra_roles').eq('id', athleteId).maybeSingle();
    if (found.error?.code === UNDEFINED_COLUMN) {
      migrated = false;
      found = await supabase.from('athletes').select('id, role').eq('id', athleteId).maybeSingle() as typeof found;
    }
    if (found.error) throw found.error;
    const athlete = found.data as { id: string; role: string | null; extra_roles?: string[] | null } | null;
    if (!athlete) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const before = grantedRoles(athlete.role, athlete.extra_roles);
    if (before.includes('admin') !== wanted.includes('admin') && !mayGrantAdmin(caller)) {
      return NextResponse.json(
        { error: 'Only the club admin account can grant or remove the admin role.' },
        { status: 403 },
      );
    }
    // Nobody takes admin away from themselves here: it is the one change on this
    // screen that locks the person making it out of the screen.
    if (athlete.id === caller.athleteId && before.includes('admin') && !wanted.includes('admin')) {
      return NextResponse.json({ error: 'You cannot remove your own admin role.' }, { status: 400 });
    }

    const next = rolesToColumns(wanted, athlete.role);
    if (!migrated && next.extra_roles.length) {
      // One role still fits the old column; two need 127. Say so rather than
      // silently saving half of what was asked for.
      return NextResponse.json({ error: 'migration_127_required' }, { status: 409 });
    }

    const update = migrated ? { role: next.role, extra_roles: next.extra_roles } : { role: next.role };
    const { error } = await supabase.from('athletes').update(update).eq('id', athlete.id);
    if (error) throw error;

    return NextResponse.json({ success: true, roles: grantedRoles(next.role, next.extra_roles) });
  } catch (error) {
    console.error('Failed to update roles:', error);
    return NextResponse.json({ error: 'Failed to update roles' }, { status: 500 });
  }
}
