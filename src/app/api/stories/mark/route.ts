import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { STORY_FEATURES, type StoryFeature } from '@/lib/stories/gate';
import { markSeen } from '@/lib/stories/instances';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stories/mark {feature, period, mark: 'viewed'|'shared'} — the caller's own
 * story only. A super-user viewing as somebody never writes a mark (edge case #22).
 */
export async function POST(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const b = (await request.json().catch(() => ({}))) as { feature?: StoryFeature; period?: string; mark?: string };
  if (!caller.athleteId || !b.feature || !STORY_FEATURES.includes(b.feature) || !/^\d{4}-\d{2}-\d{2}$/.test(b.period || '') || !['viewed', 'shared'].includes(b.mark || '')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const ok = await markSeen(createServerClient(), caller.athleteId, b.feature, b.period!, b.mark === 'viewed' ? 'viewed_at' : 'shared_at',
    { preview: false, viewingAs: !!caller.viewingAsBy });
  return NextResponse.json({ ok });
}
