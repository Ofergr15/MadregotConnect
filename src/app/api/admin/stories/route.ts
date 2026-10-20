import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStoryAdmin } from '@/lib/birthday-year/access';
import { sendingOn } from '@/lib/birthday-year/server';
import { COACH_ID } from '@/lib/constants';
import { STORY_FEATURES, type StoryFeature, type StoryState } from '@/lib/stories/gate';
import { optedOut, parseStoryPrefs } from '@/lib/stories/prefs';
import { settingsPatch } from '@/lib/stories/admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/stories — the home screen: pause switch, the 3 features' settings, the
 *   shared tester list, and the head counts each state would reach (for the summary line
 *   and the "send to N people?" confirm). `ready:false` = 156 not pasted; `ready157:false`
 *   = per-person overrides not available yet.
 * PUT  {paused} | {feature, state?, generate_at?, display_days?, min_runs?, feed_post?, send_push?}
 * Admin / super-user only, server-side.
 */
export async function GET(request: Request) {
  const { denied } = await requireStoryAdmin(request);
  if (denied) return denied;
  const db = createServerClient();
  const [s, t, p, inst] = await Promise.all([
    db.from('story_feature_settings').select('*'),
    db.from('story_testers').select('athlete_id, added_at, invited_at'),
    db.from('app_settings').select('value').eq('key', 'stories_paused').maybeSingle(),
    db.from('story_instances').select('athlete_id, feature, period, viewed_at, shared_at').order('period', { ascending: false }).limit(500),
  ]);
  if (s.error || t.error) return NextResponse.json({ ready: false, settings: [], testers: [], paused: false });
  let roster = await db.from('athletes').select('id, name, status, story_prefs').eq('coach_id', COACH_ID);
  if (roster.error) roster = await db.from('athletes').select('id, name, status').eq('coach_id', COACH_ID) as typeof roster;
  const people = (roster.data || []) as { id: string; name: string | null; status: string | null; story_prefs?: unknown }[];
  const byId = new Map(people.map((a) => [a.id, a]));
  const active = people.filter((a) => a.status === 'active');
  const testerRows = (t.data || []) as { athlete_id: string; added_at: string; invited_at: string | null }[];
  const marks = ((inst.error ? [] : inst.data) || []) as { athlete_id: string; feature: string; period: string; viewed_at: string | null; shared_at: string | null }[];
  const reach: Record<string, Record<StoryState, number>> = {};
  const stats: Record<string, { viewed: number; shared: number }> = {};
  for (const f of STORY_FEATURES) {
    const notOpted = active.filter((a) => !optedOut(parseStoryPrefs(a.story_prefs), f));
    reach[f] = { off: 0, self: 0, testers: notOpted.filter((a) => testerRows.some((r) => r.athlete_id === a.id)).length, all: notOpted.length };
    const latest = marks.find((m) => m.feature === f)?.period;
    const rows = marks.filter((m) => m.feature === f && m.period === latest);
    stats[f] = { viewed: rows.filter((m) => m.viewed_at).length, shared: rows.filter((m) => m.shared_at).length };
  }
  return NextResponse.json({
    ready: true,
    ready157: !inst.error,
    paused: (p.data as { value?: string } | null)?.value === 'on',
    legacyBirthdaySending: await sendingOn(db).catch(() => false),
    settings: s.data,
    reach,
    stats,
    testers: testerRows.map((r) => ({
      athleteId: r.athlete_id, addedAt: r.added_at, invitedAt: r.invited_at,
      name: byId.get(r.athlete_id)?.name ?? null, status: byId.get(r.athlete_id)?.status ?? null,
      viewed: marks.some((m) => m.athlete_id === r.athlete_id && m.viewed_at),
    })),
  });
}

export async function PUT(request: Request) {
  const { denied, caller } = await requireStoryAdmin(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const db = createServerClient();
  if (typeof body.paused === 'boolean') {
    const { error } = await db.from('app_settings')
      .upsert({ key: 'stories_paused', value: body.paused ? 'on' : 'off', updated_at: new Date().toISOString() }, { onConflict: 'key' });
    return error ? NextResponse.json({ error: 'save failed' }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  const feature = body.feature as StoryFeature;
  if (!STORY_FEATURES.includes(feature)) return NextResponse.json({ error: 'bad feature' }, { status: 400 });
  const { feature: _f, ...rest } = body;
  void _f;
  const r = settingsPatch(rest);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const { error } = await db.from('story_feature_settings')
    .update({ ...r.patch, updated_by: caller.athleteId, updated_at: new Date().toISOString() })
    .eq('feature', feature);
  if (error) return NextResponse.json({ error: 'save failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
