import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';

export const dynamic = 'force-dynamic';

// GET /api/feedback-prompts → { enabled, prompts: [{activityId, mode: 'card'|'quiet', plannedKind, createdAt}] }
// The caller's own open prompts (unanswered, undismissed, < 7 days) — the single
// source the feed card and the week card both read, so dismissing one clears both.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ enabled: false, prompts: [] });
  const db = createServerClient();
  if (!(await isFeatureEnabled('feedback_pain', caller.athleteId, db))) return NextResponse.json({ enabled: false, prompts: [] });
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data, error } = await db.from('feedback_prompts')
    .select('activity_id, mode, planned_kind, created_at')
    .eq('athlete_id', caller.athleteId).neq('mode', 'none').is('answered_at', null).is('dismissed_at', null)
    .gte('created_at', since).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ enabled: true, prompts: [] });
  return NextResponse.json({
    enabled: true,
    prompts: ((data || []) as Array<{ activity_id: string; mode: string; planned_kind: string | null; created_at: string }>).map((r) => ({
      activityId: r.activity_id, mode: r.mode, plannedKind: r.planned_kind, createdAt: r.created_at,
    })),
  });
}
