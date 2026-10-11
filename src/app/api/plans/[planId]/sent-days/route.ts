import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import { sentDaysFrom } from '@/lib/plans/resend-warning';

/**
 * GET → per date of this plan: when it was last confirmed on Garmin, and for how
 * many athletes. The send sheet uses it to say, before a re-send close to the
 * session, that whoever already synced will have to sync again
 * (lib/plans/resend-warning). Staff only.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  const { planId } = await params;
  const { data, error } = await createServerClient()
    .from('workout_deliveries')
    .select('workout_date, athlete_id, created_at')
    .eq('plan_id', planId)
    .eq('status', 'success')
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ days: sentDaysFrom(data || []) });
}
