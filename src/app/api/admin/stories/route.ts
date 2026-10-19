import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireBirthdayAdmin } from '@/lib/birthday-year/access';
import { STORY_FEATURES, STORY_STATES, type StoryFeature, type StoryState } from '@/lib/stories/gate';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/stories — the per-feature state, the tester list, and the pause switch.
 * PUT  /api/admin/stories {feature, state} — phase 1 lets only 'weekly' be changed here.
 * Admin / super-user only. `ready:false` = migration 156 isn't pasted yet.
 */
export async function GET(request: Request) {
  const { denied } = await requireBirthdayAdmin(request);
  if (denied) return denied;
  const db = createServerClient();
  const [s, t, p] = await Promise.all([
    db.from('story_feature_settings').select('feature, state, updated_at'),
    db.from('story_testers').select('athlete_id, added_at'),
    db.from('app_settings').select('value').eq('key', 'stories_paused').maybeSingle(),
  ]);
  if (s.error || t.error) return NextResponse.json({ ready: false, settings: [], testers: [], paused: false });
  const ids = ((t.data || []) as { athlete_id: string }[]).map((r) => r.athlete_id);
  const names = new Map<string, { name: string | null; status: string | null }>();
  if (ids.length) {
    const { data } = await db.from('athletes').select('id, name, status').in('id', ids);
    for (const a of (data || []) as { id: string; name: string | null; status: string | null }[]) names.set(a.id, a);
  }
  return NextResponse.json({
    ready: true,
    paused: (p.data as { value?: string } | null)?.value === 'on',
    settings: s.data,
    testers: ((t.data || []) as { athlete_id: string; added_at: string }[]).map((r) => ({
      athleteId: r.athlete_id, addedAt: r.added_at, name: names.get(r.athlete_id)?.name ?? null, status: names.get(r.athlete_id)?.status ?? null,
    })),
  });
}

export async function PUT(request: Request) {
  const { denied, caller } = await requireBirthdayAdmin(request);
  if (denied) return denied;
  const { feature, state } = (await request.json().catch(() => ({}))) as { feature?: StoryFeature; state?: StoryState };
  if (!feature || !STORY_FEATURES.includes(feature) || !state || !STORY_STATES.includes(state)) {
    return NextResponse.json({ error: 'bad feature/state' }, { status: 400 });
  }
  // Phase 1: birthday still runs on its own switch (/dashboard/birthdays); don't let
  // this page suggest otherwise.
  if (feature !== 'weekly') return NextResponse.json({ error: 'only weekly in phase 1' }, { status: 400 });
  const db = createServerClient();
  const { error } = await db.from('story_feature_settings')
    .update({ state, updated_by: caller.athleteId, updated_at: new Date().toISOString() })
    .eq('feature', feature);
  if (error) return NextResponse.json({ error: 'save failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
