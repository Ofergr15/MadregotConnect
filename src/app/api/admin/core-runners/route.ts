import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { CORE_RUNNER_ROLE, isCoreRunner, isLegacyCoreRunner } from '@/lib/core-runner';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * הגרעין — the club's core squad, as a managed list.
 *
 * GET  → every club member, with whether they are in and how it is recorded.
 * PUT  → { athleteId, isCoreRunner } toggles one person.
 *
 * WHY ITS OWN ROUTE rather than a field on /api/admin/users: that route's PUT
 * writes `role`, and the whole point of migration 091 is that גרעין membership is
 * NOT a role. Folding it in would have re-created the coupling in the API layer
 * one migration after removing it from the schema.
 *
 * Staff-gated, matching /api/admin/users. It reveals the club's member list and
 * who holds sponsor entitlements worth real money (a free annual gym membership,
 * a shoe allocation), so it is not a read for the whole club.
 */

/** Postgres "column does not exist" — migration 091 not pasted in yet. */
const UNDEFINED_COLUMN = '42703';

async function requireStaff(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!caller.isSuperUser && !caller.isStaff) {
    return { denied: NextResponse.json({ error: 'Staff access required' }, { status: 403 }), caller };
  }
  return { denied: null, caller };
}

export async function GET(request: Request) {
  try {
    const { denied } = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('athletes')
      .select('id, name, email, role, group_id, status, is_core_runner')
      .order('name');

    if (error) {
      // Migrations here are applied by hand, so "the column isn't there yet" is a
      // state a reader can hit. Say it plainly, the way /api/admin/registrations
      // does for its table, instead of 500ing a screen that could still explain
      // itself. The legacy role is readable without the column, so the list is
      // still correct — it just cannot be edited.
      if (error.code === UNDEFINED_COLUMN) {
        const legacy = await supabase
          .from('athletes')
          .select('id, name, email, role, group_id, status')
          .order('name');
        return NextResponse.json({
          migrated: false,
          athletes: (legacy.data || []).map(shape),
        });
      }
      throw error;
    }

    return NextResponse.json({ migrated: true, athletes: (data || []).map(shape) });
  } catch (error) {
    console.error('Failed to load core runners:', error);
    return NextResponse.json({ error: 'Failed to load core runners' }, { status: 500 });
  }
}

function shape(a: {
  id: string; name: string | null; email: string | null; role: string | null;
  group_id?: string | null; status?: string | null; is_core_runner?: boolean | null;
}) {
  return {
    id: a.id,
    name: a.name || '',
    email: a.email || '',
    role: a.role || 'runner',
    groupId: a.group_id || null,
    status: a.status || null,
    isCoreRunner: isCoreRunner(a),
    /** In via the old role value only. Those rows cannot also hold a staff role
     *  until they are converted — which the toggle does on the way out. */
    isLegacy: isLegacyCoreRunner(a),
  };
}

export async function PUT(request: Request) {
  try {
    const { denied } = await requireStaff(request);
    if (denied) return denied;

    const body = (await request.json().catch(() => ({}))) as {
      athleteId?: string;
      isCoreRunner?: boolean;
    };
    if (!body.athleteId || typeof body.isCoreRunner !== 'boolean') {
      return NextResponse.json({ error: 'athleteId and isCoreRunner are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: athlete, error: findError } = await supabase
      .from('athletes')
      .select('id, role')
      .eq('id', body.athleteId)
      .maybeSingle();
    if (findError) throw findError;
    if (!athlete) return NextResponse.json({ error: 'not-found' }, { status: 404 });

    const patch: Record<string, unknown> = { is_core_runner: body.isCoreRunner };

    // ⚠️ TURNING IT OFF HAS TO CLEAR THE LEGACY ROLE TOO.
    //
    // isCoreRunner() is true on EITHER source, so on a row still carrying
    // role = 'core_runner' clearing only the flag leaves the person in the גרעין
    // — perks and badge unchanged — while the switch reads off. A control that
    // silently does nothing is worse than no control.
    //
    // 'runner' is the right landing place: it is the default for a club member
    // (see /api/admin/users) and it is what migration 008's core_runner
    // permissions were an expansion OF. A staff role is never overwritten here,
    // because a staff row cannot be carrying role='core_runner' in the first
    // place — that was the exclusivity this feature exists to remove.
    const clearingLegacy = !body.isCoreRunner && athlete.role === CORE_RUNNER_ROLE;
    if (clearingLegacy) patch.role = 'runner';

    const { error: updateError } = await supabase.from('athletes').update(patch).eq('id', athlete.id);
    if (updateError) {
      if (updateError.code === UNDEFINED_COLUMN) {
        return NextResponse.json(
          { error: 'migration-missing', detail: 'supabase/migrations/091_athlete_core_runner_flag.sql' },
          { status: 409 },
        );
      }
      throw updateError;
    }

    // NOT invalidating the session cache: this changes what the TARGET sees, not
    // the caller, and requireSession is memoised per token — so the athlete picks
    // it up within the cache TTL on their next request. Worth knowing when
    // testing on yourself: your own 🌰 will not appear on the very next tap.
    return NextResponse.json({ success: true, isCoreRunner: body.isCoreRunner, roleReset: clearingLegacy });
  } catch (error) {
    console.error('Failed to update core-runner flag:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
