import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';
import { authError, requireSession } from '@/lib/auth-session';
import { groupDisplayName } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/registrations — the approval queue behind /dashboard/registrations.
 * `?status=pending|approved|rejected|member|all` (default: pending).
 *
 * 'member' is a submission from somebody who already had an account (migration 089).
 * It is a record, not a task: it never has approved_by/rejected_by set and there is
 * nothing to do to it. It shows up under `all`, which is what the screen's second
 * tab asks for, so no filtering change was needed here.
 *
 * Gated on canApprove(), not merely on having a session. This returns a list of
 * strangers' email addresses; any signed-in member could otherwise read it, and
 * "who applied to the club and was turned down" is not club-wide information.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    if (!canApprove(auth.user.email)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const status = new URL(request.url).searchParams.get('status') || 'pending';
    const supabase = createServerClient();

    let query = supabase
      .from('signup_requests')
      .select('id, email, group_id, status, created_at, approved_at, approved_by, rejected_at, rejected_by, athlete_id')
      // Oldest first for the queue: whoever has been waiting longest is the one
      // to deal with. (An approved/rejected list is nicer newest-first, so it is
      // reversed below rather than ordered twice in SQL.)
      .order('created_at', { ascending: true });

    if (status !== 'all') query = query.eq('status', status);

    const { data: rows, error } = await query;
    if (error) {
      // The table only exists once 083 has been pasted into the SQL editor —
      // migrations here are applied by hand. Say so plainly instead of 500ing,
      // so the page can show the reason rather than "failed to load".
      if (error.code === '42P01') {
        return NextResponse.json(
          { requests: [], migrated: false, error: 'signup_requests table missing (run supabase/migrations/083_signup_requests.sql)' },
          { status: 200 },
        );
      }
      throw error;
    }

    // One read for the group names rather than a nested select: the FK alias for
    // `groups` differs between environments here, and a bad embed fails the whole
    // request (same reason /api/onboarding reads groups separately).
    const groupIds = [...new Set((rows || []).map(r => r.group_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (groupIds.length) {
      const { data: groups } = await supabase.from('groups').select('id, name').in('id', groupIds);
      for (const g of groups || []) names.set(g.id, groupDisplayName(g.name));
    }

    const requests = (rows || []).map(r => ({
      id: r.id,
      email: r.email,
      groupId: r.group_id,
      groupName: r.group_id ? names.get(r.group_id) || null : null,
      status: r.status,
      createdAt: r.created_at,
      approvedAt: r.approved_at,
      approvedBy: r.approved_by,
      rejectedAt: r.rejected_at,
      rejectedBy: r.rejected_by,
      athleteId: r.athlete_id,
    }));

    return NextResponse.json({
      requests: status === 'pending' ? requests : requests.reverse(),
      migrated: true,
    });
  } catch (err) {
    console.error('Failed to load signup requests:', err);
    return NextResponse.json({ error: 'Failed to load registrations' }, { status: 500 });
  }
}
