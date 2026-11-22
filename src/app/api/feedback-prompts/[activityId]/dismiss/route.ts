import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// POST /api/feedback-prompts/[activityId]/dismiss → "לא עכשיו". Own prompt only
// (scoped by the verified caller's id, never a body field). Counts as a skip
// toward the 2-skip / 7-day push mute.
export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'athlete account required' }, { status: 403 });
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const { error } = await createServerClient().from('feedback_prompts').update({ dismissed_at: new Date().toISOString() })
    .eq('athlete_id', caller.athleteId).eq('activity_id', activityId).is('dismissed_at', null);
  if (error) return NextResponse.json({ error: 'Failed', details: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
