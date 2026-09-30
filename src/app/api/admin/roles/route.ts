import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canGrantAdmin } from '@/lib/constants';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { GRANTABLE_ROLES, grantedRoles, hasRole, rolesToColumns, type GrantableRole, type RolePerson } from '@/lib/auth/roles';
import { notifyAthlete } from '@/lib/push';
import { academyJoinedCopy, roleGrantedCopy } from '@/lib/notifications/copy';
import { applyAcademyMembership } from '@/lib/academy/membership-server';
import { newlyGranted, welcomeRoleOf, WELCOME_PARAM } from '@/lib/role-views';

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

const BASE = 'id, name, email, avatar_url, role, status, is_academy';

// "רץ אקדמיה" is not a role column. It is `athletes.is_academy`, the flag that
// "accept" on the applicants board turns on and everything academy reads (the
// academy tab, watch pace targets, the academy feed). The switch here writes
// that same flag, so the two doors can never disagree.

async function requireRoleAdmin(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!caller.isSuperUser && !hasRole(caller, 'admin')) {
    return { denied: NextResponse.json({ error: 'Admin access required' }, { status: 403 }), caller };
  }
  return { denied: null, caller };
}

/** The notification kind, also how GET finds when each person was last told. */
const ROLE_GRANTED_KIND = 'role_granted';

/**
 * "קיבלת תפקיד חדש" to the person, opening the app in that role's view (see
 * WELCOME_PARAM in role-views.ts). Best-effort: a failed push never fails the save.
 */
async function sendRoleGranted(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  role: string,
  caller: Pick<VerifiedCaller, 'athleteId'>,
): Promise<boolean> {
  try {
    let by: string | null = null;
    if (caller.athleteId && caller.athleteId !== athleteId) {
      const me = await supabase.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle();
      by = (me.data as { name?: string | null } | null)?.name || null;
    }
    await notifyAthlete({
      athleteId,
      kind: ROLE_GRANTED_KIND,
      actorAthleteId: caller.athleteId,
      copy: locale => roleGrantedCopy(locale, { role, by }),
      url: `/dashboard?${WELCOME_PARAM}=${role}`,
      tag: 'role-granted',
    });
    return true;
  } catch (err) {
    console.error('Roles: role-granted push failed:', err);
    return false;
  }
}

/** "נכנסת לאקדמיה", opening the academy tab. Best-effort, like the role push. */
async function sendAcademyJoined(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  caller: Pick<VerifiedCaller, 'athleteId'>,
): Promise<boolean> {
  try {
    let by: string | null = null;
    if (caller.athleteId && caller.athleteId !== athleteId) {
      const me = await supabase.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle();
      by = (me.data as { name?: string | null } | null)?.name || null;
    }
    await notifyAthlete({
      athleteId,
      kind: ACADEMY_JOINED_KIND,
      actorAthleteId: caller.athleteId,
      copy: locale => academyJoinedCopy(locale, { by }),
      url: '/dashboard/academy',
      tag: 'academy-joined',
    });
    return true;
  } catch (err) {
    console.error('Roles: academy-joined push failed:', err);
    return false;
  }
}

const ACADEMY_JOINED_KIND = 'academy_joined';

/** Newest role_granted notification per person — the sheet's "נשלחה" line. */
async function lastNotified(supabase: ReturnType<typeof createServerClient>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data, error } = await supabase
    .from('scheduled_notifications')
    .select('audience_id, last_sent_at')
    .eq('kind', ROLE_GRANTED_KIND)
    .eq('audience_type', 'athlete')
    .order('last_sent_at', { ascending: false })
    .limit(500);
  if (error) return out;
  for (const r of (data || []) as Array<{ audience_id: string | null; last_sent_at: string | null }>) {
    if (r.audience_id && r.last_sent_at && !out.has(r.audience_id)) out.set(r.audience_id, r.last_sent_at);
  }
  return out;
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
    const notified = await lastNotified(supabase);

    const people: RolePerson[] = ((res.data || []) as any[])
      .filter(a => a.status !== 'removed')
      .map(a => ({
        id: a.id,
        name: a.name || '',
        email: a.email || '',
        avatarUrl: a.avatar_url || null,
        roles: grantedRoles(a.role, a.extra_roles),
        academy: a.is_academy === true,
        lastNotifiedAt: notified.get(a.id) ?? null,
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

    const body = (await request.json().catch(() => ({}))) as { athleteId?: unknown; roles?: unknown; academy?: unknown };
    const athleteId = typeof body.athleteId === 'string' ? body.athleteId : '';
    if (!athleteId || !Array.isArray(body.roles) || (body.academy !== undefined && typeof body.academy !== 'boolean')) {
      return NextResponse.json({ error: 'athleteId and roles are required' }, { status: 400 });
    }
    if (body.roles.some(r => !(GRANTABLE_ROLES as readonly unknown[]).includes(r))) {
      return NextResponse.json({ error: 'Unknown role' }, { status: 400 });
    }
    const wanted = body.roles as GrantableRole[];

    const supabase = createServerClient();
    let migrated = true;
    let found = await supabase.from('athletes').select('id, role, extra_roles, is_academy').eq('id', athleteId).maybeSingle();
    if (found.error?.code === UNDEFINED_COLUMN) {
      migrated = false;
      found = await supabase.from('athletes').select('id, role, is_academy').eq('id', athleteId).maybeSingle() as typeof found;
    }
    if (found.error) throw found.error;
    const athlete = found.data as { id: string; role: string | null; extra_roles?: string[] | null; is_academy?: boolean | null } | null;
    if (!athlete) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const wasAcademy = athlete.is_academy === true;
    const academy = typeof body.academy === 'boolean' ? body.academy : wasAcademy;

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

    const update: Record<string, unknown> = migrated ? { role: next.role, extra_roles: next.extra_roles } : { role: next.role };
    if (academy !== wasAcademy) update.is_academy = academy;
    const { error } = await supabase.from('athletes').update(update).eq('id', athlete.id);
    if (error) throw error;
    if (academy !== wasAcademy) await applyAcademyMembership(supabase, athlete.id, academy);

    const roles = grantedRoles(next.role, next.extra_roles);
    // Only a role switched ON is news to them. Taking one away sends nothing.
    const added = newlyGranted(before, roles)[0] ?? null;
    const notified = added ? await sendRoleGranted(supabase, athlete.id, added, caller) : false;
    const academyNotified = academy && !wasAcademy ? await sendAcademyJoined(supabase, athlete.id, caller) : false;

    return NextResponse.json({ success: true, roles, academy, notified: notified ? added : null, academyNotified });
  } catch (error) {
    console.error('Failed to update roles:', error);
    return NextResponse.json({ error: 'Failed to update roles' }, { status: 500 });
  }
}

/**
 * POST { athleteId, action: 'notify' } — send the role push again, for somebody
 * who already holds a role: the ones granted before the push existed, or a
 * phone that missed it.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireRoleAdmin(request);
    if (denied) return denied;

    const body = (await request.json().catch(() => ({}))) as { athleteId?: unknown; action?: unknown };
    const athleteId = typeof body.athleteId === 'string' ? body.athleteId : '';
    if (!athleteId || body.action !== 'notify') {
      return NextResponse.json({ error: 'athleteId and action=notify are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    let found = await supabase.from('athletes').select('id, role, extra_roles').eq('id', athleteId).maybeSingle();
    if (found.error?.code === UNDEFINED_COLUMN) {
      found = await supabase.from('athletes').select('id, role').eq('id', athleteId).maybeSingle() as typeof found;
    }
    if (found.error) throw found.error;
    const athlete = found.data as { id: string; role: string | null; extra_roles?: string[] | null } | null;
    if (!athlete) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const role = welcomeRoleOf(grantedRoles(athlete.role, athlete.extra_roles));
    if (!role) return NextResponse.json({ error: 'no_role' }, { status: 400 });

    const sent = await sendRoleGranted(supabase, athlete.id, role, caller);
    if (!sent) return NextResponse.json({ error: 'push_failed' }, { status: 502 });
    return NextResponse.json({ success: true, role, sentAt: new Date().toISOString() });
  } catch (error) {
    console.error('Failed to resend the role notification:', error);
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }
}
