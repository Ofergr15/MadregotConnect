import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { clearMaintenanceCache, readMaintenance } from '@/lib/maintenance';
import { REMOVED_STATUS, entryHandles } from '@/lib/admin/entry-queue';

export const dynamic = 'force-dynamic';

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/admin/entry-queue/remove  { athleteId, action?: 'remove' | 'restore' }
//
// Take somebody out of the club, or put them back. SOFT, and deliberately so:
// 25 tables cascade off `athletes(id)`, so a hard delete would take their runs,
// badges, attendance, orders and feed posts with it, irreversibly. This writes
// `status = 'removed'` and nothing else — every club-facing query already filters
// `status = 'active'`, and `membershipFor` already turns a non-active status into
// the AccessBlocked screen. See the block in lib/admin/entry-queue.ts.
//
// The hard delete still exists at DELETE /api/admin/users, reachable from the
// settings screen. This is not that, on purpose: the queue is where you look at
// somebody who never got in, and "never got in" is the worst possible moment to
// offer an irreversible button.
//
// ADMIN-ONLY, unlike everything else on this screen. Approving, releasing and
// nudging are all recoverable in one tap; ending a membership is not the kind of
// thing a coach should reach by mis-tapping next to it. `isSuperUser` is checked
// as well as the role because the club's own owner account carries role 'runner'
// with the super-user flag set — gating on the role alone would lock out the one
// person this is for.
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && caller.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { athleteId, action } = (await request.json().catch(() => ({}))) as {
      athleteId?: string;
      action?: 'remove' | 'restore';
    };
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    const restoring = action === 'restore';
    const supabase = createServerClient();

    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, name, email, role, status, is_super_user')
      .eq('id', athleteId)
      .maybeSingle();
    if (!athlete) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Two rows nobody gets to remove from a phone: an admin, and the caller
    // themselves. Locking yourself out of the screen that grants access is not a
    // recoverable mistake — it needs somebody else, or the SQL editor.
    if (!restoring) {
      if (athlete.role === 'admin' || athlete.is_super_user) {
        return NextResponse.json({ error: 'Cannot remove an admin' }, { status: 400 });
      }
      if (caller.athleteId && caller.athleteId === athleteId) {
        return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
      }
    }

    const { error } = await supabase
      .from('athletes')
      .update({ status: restoring ? 'active' : REMOVED_STATUS })
      .eq('id', athleteId);
    if (error) throw error;

    // Their exemption from an open maintenance window goes with them. Leaving it
    // behind would mean a removed member is still on the list that lets people in,
    // and the next window would quietly hold the door open for somebody who is no
    // longer in the club.
    let allowlistTrimmed = false;
    if (!restoring) {
      const state = await readMaintenance();
      const handles = entryHandles({ id: athlete.id, email: athlete.email });
      const next = (state.allow || []).filter((entry) => !handles.includes(entry));
      if (next.length !== (state.allow || []).length) {
        // Same upsert shape as PUT /api/maintenance, and the cache has to be
        // dropped with it or this screen reads its own stale allowlist for 15s.
        await supabase
          .from('app_settings')
          .upsert([{ key: 'maintenance_allow', value: next.join(',') }], { onConflict: 'key' });
        clearMaintenanceCache();
        allowlistTrimmed = true;
      }
    }

    console.log(
      `[entry-queue] ${caller.email} ${restoring ? 'restored' : 'removed'} athlete ${athleteId} (${athlete.name})`,
    );

    return NextResponse.json({ ok: true, removed: !restoring, allowlistTrimmed });
  } catch (err) {
    console.error('Failed to update club membership:', err);
    return NextResponse.json({ error: 'Failed to update club membership' }, { status: 500 });
  }
}
