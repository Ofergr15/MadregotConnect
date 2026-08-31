import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// Remove a device's push subscription (on opt-out).
//
// NOTE: nothing in the app calls this — grep finds zero references in src/ or
// public/, and src/lib/pwa.ts has no unsubscribe counterpart to subscribeToPush
// (rows are retired either by subscribeToPush naming the endpoint it discarded,
// or by sendPushDetailed's 404/410 cleanup). Kept rather than deleted, since a
// stale client or a future settings screen may still reach for it — but it was
// an unauthenticated delete-by-endpoint: anyone holding an endpoint string could
// silence that device, and the athlete would only find out by noticing the
// silence. Now the caller must own the row, unless they're staff.
export async function POST(request: Request) {
  try {
    const { endpoint } = await request.json();
    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
    }

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const supabase = createServerClient();
    // Staff (and the super-user) can retire any endpoint — that's the support
    // path for a phone whose owner can no longer sign in. Everyone else deletes
    // only their own rows, so the athlete_id filter is the whole gate here:
    // an endpoint belonging to someone else simply matches nothing.
    let query = supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (!caller.isSuperUser && !caller.isStaff) {
      if (!caller.athleteId) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      query = query.eq('athlete_id', caller.athleteId);
    }
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
