import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { isMissingSchema } from '@/lib/events/lifecycle';
import { loadBlocks } from '@/lib/events/server';
import { suggestPaceGroup } from '@/lib/events/pace-groups';
import { chosenBand, eventDistanceM, loadPaceGroups, loadRunnerData } from '@/lib/events/runner-data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/events/[id]/pace-groups — STAFF ONLY. Every respondent's answers, own data
 * (latest HM/M, 8-week km), suggestion and assignment, plus who registered and hasn't
 * answered. Named goals and race times on one screen: never member-visible.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const supabase = createServerClient();
    const { data: event } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    const groups = await loadPaceGroups(supabase, id);
    if (groups === null) return NextResponse.json({ groups: [], runners: [], answered: 0, notAnswered: 0, migrated: false });
    const blocks = await loadBlocks(supabase, id);
    const D = eventDistanceM(event, blocks) ?? 0;

    const [ansRes, asgRes, regRes] = await Promise.all([
      supabase.from('event_answers').select('athlete_id, answers, athletes!athlete_id(name, avatar_url)').eq('event_id', id),
      supabase.from('event_group_assignments').select('athlete_id, group_id, source, approved').eq('event_id', id),
      supabase.from('event_registrations').select('athlete_id').eq('event_id', id).neq('status', 'cancelled'),
    ]);
    const answers = (ansRes.data ?? []) as any[];
    const asg = new Map(((asgRes.data ?? []) as any[]).map((a) => [a.athlete_id, a]));
    const answeredIds = new Set(answers.map((a) => a.athlete_id));
    const notAnswered = ((regRes.data ?? []) as any[]).filter((r) => !answeredIds.has(r.athlete_id)).length;
    const data = await loadRunnerData(supabase, [...answeredIds]);

    const runners = answers.map((a) => {
      const d = data.get(a.athlete_id)!;
      const band = chosenBand(blocks, a.answers);
      return {
        athleteId: a.athlete_id,
        name: a.athletes?.name ?? null,
        avatarUrl: a.athletes?.avatar_url ?? null,
        goalLabel: band?.label ?? null,
        data: d,
        suggestion: suggestPaceGroup({ eventDistanceM: D, goalBand: band, latestResult: d.latestResult, avgWeeklyKm8w: d.avgWeeklyKm8w, groups }),
        assignment: asg.get(a.athlete_id) ?? null,
      };
    });
    return NextResponse.json({ groups, runners, answered: answers.length, notAnswered, eventDistanceM: D || null, migrated: true });
  } catch (e) {
    console.error('pace-groups GET', e);
    return NextResponse.json({ error: 'Failed to load pace groups' }, { status: 500 });
  }
}

/** PUT { groups: [{ id?, label, targetPaceSecPerKm }] } — staff. Replaces the event's groups in order. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const list = Array.isArray(body?.groups) ? body.groups : null;
    if (!list) return NextResponse.json({ error: 'groups array required' }, { status: 400 });
    for (const g of list) {
      if (typeof g?.label !== 'string' || !Number.isInteger(g?.targetPaceSecPerKm) || g.targetPaceSecPerKm < 120 || g.targetPaceSecPerKm > 900) {
        return NextResponse.json({ error: 'each group needs label + targetPaceSecPerKm (120..900)' }, { status: 400 });
      }
    }
    const supabase = createServerClient();
    const existing = await loadPaceGroups(supabase, id);
    if (existing === null) return NextResponse.json({ error: 'Pace groups need migration 184' }, { status: 409 });
    const keep = new Set(list.filter((g: any) => typeof g.id === 'string').map((g: any) => g.id));
    const drop = existing.filter((g) => !keep.has(g.id)).map((g) => g.id);
    if (drop.length) await supabase.from('event_pace_groups').delete().in('id', drop);
    const rows = list.map((g: any, i: number) => ({
      ...(typeof g.id === 'string' ? { id: g.id } : {}),
      event_id: id, label: g.label, target_pace_sec_per_km: g.targetPaceSecPerKm, position: i,
    }));
    const { error } = await supabase.from('event_pace_groups').upsert(rows);
    if (error) throw error;
    return NextResponse.json({ groups: await loadPaceGroups(supabase, id) });
  } catch (e) {
    console.error('pace-groups PUT', e);
    return NextResponse.json({ error: 'Failed to save pace groups' }, { status: 500 });
  }
}

/** POST { assignments: [{ athleteId, groupId, approved }] } — staff. Coach placement / approval. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const list = Array.isArray(body?.assignments) ? body.assignments : null;
    if (!list) return NextResponse.json({ error: 'assignments array required' }, { status: 400 });
    const supabase = createServerClient();
    const groups = await loadPaceGroups(supabase, id);
    if (groups === null) return NextResponse.json({ error: 'Pace groups need migration 184' }, { status: 409 });
    const valid = new Set(groups.map((g) => g.id));
    const rows = [];
    for (const a of list) {
      if (typeof a?.athleteId !== 'string' || !valid.has(a?.groupId)) {
        return NextResponse.json({ error: 'each assignment needs athleteId + a groupId of this event' }, { status: 400 });
      }
      rows.push({ event_id: id, athlete_id: a.athleteId, group_id: a.groupId, source: 'coach', approved: a.approved !== false, updated_at: new Date().toISOString() });
    }
    const { error } = await supabase.from('event_group_assignments').upsert(rows, { onConflict: 'event_id,athlete_id' });
    if (error) {
      if (isMissingSchema(error)) return NextResponse.json({ error: 'Pace groups need migration 184' }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ saved: rows.length });
  } catch (e) {
    console.error('pace-groups POST', e);
    return NextResponse.json({ error: 'Failed to save assignments' }, { status: 500 });
  }
}
