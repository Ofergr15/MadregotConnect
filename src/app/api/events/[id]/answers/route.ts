import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingSchema, isVisibleTo } from '@/lib/events/lifecycle';
import { loadBlocks } from '@/lib/events/server';
import { suggestPaceGroup } from '@/lib/events/pace-groups';
import { chosenBand, eventDistanceM, loadPaceGroups, loadRunnerData } from '@/lib/events/runner-data';

export const dynamic = 'force-dynamic';

async function context(request: Request, id: string, athleteParam: string | null) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  const athleteId = athleteParam || caller.athleteId;
  if (!athleteId) return { denied: NextResponse.json({ error: 'athleteId required' }, { status: 400 }) };
  if (!mayActFor(caller, athleteId)) return { denied: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  const supabase = createServerClient();
  const { data: event, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!event || !isVisibleTo(event, caller.isStaff || caller.isSuperUser, new Date())) {
    return { denied: NextResponse.json({ error: 'Event not found' }, { status: 404 }) };
  }
  return { denied: null, caller, athleteId, supabase, event };
}

async function view(supabase: ReturnType<typeof createServerClient>, event: any, athleteId: string, answers: Record<string, unknown> | null) {
  const blocks = await loadBlocks(supabase, event.id);
  const groups = (await loadPaceGroups(supabase, event.id)) ?? [];
  const data = (await loadRunnerData(supabase, [athleteId])).get(athleteId)!;
  const D = eventDistanceM(event, blocks) ?? 0;
  const band = chosenBand(blocks, answers);
  const suggestion = suggestPaceGroup({ eventDistanceM: D, goalBand: band, latestResult: data.latestResult, avgWeeklyKm8w: data.avgWeeklyKm8w, groups });
  const { data: asg } = await supabase
    .from('event_group_assignments')
    .select('group_id, source, approved')
    .eq('event_id', event.id)
    .eq('athlete_id', athleteId)
    .maybeSingle();
  return { answers, data, eventDistanceM: D || null, suggestion, assignment: asg ?? null, groups };
}

/** GET /api/events/[id]/answers?athleteId= — self-or-staff. The runner's answers, own data, suggestion, assignment. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await context(request, id, new URL(request.url).searchParams.get('athleteId'));
    if (ctx.denied) return ctx.denied;
    const { data, error } = await ctx.supabase!.from('event_answers').select('answers').eq('event_id', id).eq('athlete_id', ctx.athleteId!).maybeSingle();
    if (error && !isMissingSchema(error)) throw error;
    return NextResponse.json(await view(ctx.supabase!, ctx.event, ctx.athleteId!, (data?.answers as Record<string, unknown>) ?? null));
  } catch (e) {
    console.error('event answers GET', e);
    return NextResponse.json({ error: 'Failed to load answers' }, { status: 500 });
  }
}

/**
 * PUT /api/events/[id]/answers { answers, athleteId? } — self-or-staff (mayActFor).
 * Saves the answers and, unless a coach already placed the runner, (re)writes the
 * AUTO suggestion as an unapproved assignment. The coach approves the final one.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
      return NextResponse.json({ error: 'answers object required' }, { status: 400 });
    }
    const ctx = await context(request, id, body.athleteId ?? null);
    if (ctx.denied) return ctx.denied;
    const supabase = ctx.supabase!;
    const { error } = await supabase
      .from('event_answers')
      .upsert({ event_id: id, athlete_id: ctx.athleteId, answers: body.answers, updated_at: new Date().toISOString() }, { onConflict: 'event_id,athlete_id' });
    if (error) {
      if (isMissingSchema(error)) return NextResponse.json({ error: 'Questionnaire needs migration 184' }, { status: 409 });
      throw error;
    }
    const v = await view(supabase, ctx.event, ctx.athleteId!, body.answers);
    if (v.suggestion.groupId && (!v.assignment || v.assignment.source === 'auto')) {
      await supabase.from('event_group_assignments').upsert(
        { event_id: id, athlete_id: ctx.athleteId, group_id: v.suggestion.groupId, source: 'auto', approved: false, updated_at: new Date().toISOString() },
        { onConflict: 'event_id,athlete_id' },
      );
      v.assignment = { group_id: v.suggestion.groupId, source: 'auto', approved: false };
    }
    return NextResponse.json(v);
  } catch (e) {
    console.error('event answers PUT', e);
    return NextResponse.json({ error: 'Failed to save answers' }, { status: 500 });
  }
}
