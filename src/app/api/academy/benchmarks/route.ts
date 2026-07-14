import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const TOP_N = 3; // athlete self-submissions that would rank in the top-N need approval.

// Try to link a result to a registered athlete by exact (trimmed) name match.
async function resolveAthleteId(supabase: any, name: string): Promise<string | null> {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const { data } = await supabase
    .from('athletes').select('id, name').eq('coach_id', COACH_ID).ilike('name', trimmed);
  return data && data.length ? data[0].id : null;
}

/**
 * GET /api/academy/benchmarks?test=&athleteId=&name=&status=
 * status defaults to 'approved' (public board). Pass status=pending for the admin
 * queue, or status=all. Rank is computed over APPROVED results only.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const test = searchParams.get('test');
    const athleteId = searchParams.get('athleteId');
    const name = searchParams.get('name');
    const status = searchParams.get('status') || 'approved';

    const supabase = createServerClient();
    let q = supabase
      .from('benchmark_results')
      .select('id, test_name, athlete_name, athlete_id, time_seconds, notes, recorded_on, status, submitted_by, submitted_at')
      .eq('coach_id', COACH_ID)
      .order('time_seconds', { ascending: true });
    if (test) q = q.eq('test_name', test);

    let { data, error } = await q;
    if (error) {
      // Column `status` may not be migrated yet → retry without it (all treated approved).
      const retry = await supabase
        .from('benchmark_results')
        .select('id, test_name, athlete_name, athlete_id, time_seconds, notes, recorded_on')
        .eq('coach_id', COACH_ID)
        .order('time_seconds', { ascending: true });
      if (retry.error) return NextResponse.json({ tests: [], results: [] });
      data = (retry.data || []).map((r: any) => ({ ...r, status: 'approved' }));
    }

    const rows = (data || []) as any[];

    // Rank within each test over APPROVED results only (pending don't take a slot yet).
    const rankByTest: Record<string, number> = {};
    const ranked = rows.map((r) => {
      let rank: number | null = null;
      if (r.status === 'approved') {
        rankByTest[r.test_name] = (rankByTest[r.test_name] || 0) + 1;
        rank = rankByTest[r.test_name];
      }
      return { ...r, rank };
    });

    let results = ranked;
    if (status !== 'all') results = results.filter((r) => r.status === status);
    if (athleteId) results = results.filter((r) => r.athlete_id === athleteId);
    else if (name) results = results.filter((r) => (r.athlete_name || '').trim().toLowerCase() === name.trim().toLowerCase());

    const tests = Array.from(new Set(ranked.filter(r => r.status === 'approved').map((r) => r.test_name)));
    return NextResponse.json({ tests, results });
  } catch (error: any) {
    console.error('Benchmarks GET error:', error);
    return NextResponse.json({ tests: [], results: [] });
  }
}

/**
 * POST /api/academy/benchmarks
 * Body: { id?, testName, athleteName, timeSeconds, notes?, recordedOn?, athleteId?, submittedBy? }
 * - Coach entry (no submittedBy): status 'approved'.
 * - Athlete self-submit (submittedBy set): 'pending' if it would rank in the top-3
 *   of that test, else 'approved'.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, testName, athleteName, timeSeconds, notes, recordedOn, athleteId, submittedBy } = body;
    if (!athleteName || timeSeconds == null) {
      return NextResponse.json({ error: 'athleteName and timeSeconds are required' }, { status: 400 });
    }
    const test = testName || '2000m';
    const supabase = createServerClient();
    const linkedId = athleteId !== undefined ? athleteId : await resolveAthleteId(supabase, athleteName);

    // Decide status.
    let status = 'approved';
    if (submittedBy && !id) {
      // Would this time land in the current approved top-3?
      const { data: top } = await supabase
        .from('benchmark_results')
        .select('time_seconds')
        .eq('coach_id', COACH_ID).eq('test_name', test).eq('status', 'approved')
        .order('time_seconds', { ascending: true })
        .limit(TOP_N);
      const slowestTop = (top || []).length ? (top as any[])[top!.length - 1].time_seconds : null;
      const wouldRankTop = (top || []).length < TOP_N || (slowestTop != null && timeSeconds < slowestTop);
      status = wouldRankTop ? 'pending' : 'approved';
    }

    const row: Record<string, any> = {
      coach_id: COACH_ID,
      test_name: test,
      athlete_name: athleteName.trim(),
      time_seconds: timeSeconds,
      notes: notes || null,
      recorded_on: recordedOn || null,
      athlete_id: linkedId,
      status,
      submitted_by: submittedBy || null,
      submitted_at: submittedBy ? new Date().toISOString() : null,
    };

    if (id) {
      const { data, error } = await supabase
        .from('benchmark_results').update(row).eq('id', id).eq('coach_id', COACH_ID).select().single();
      if (error) throw error;
      return NextResponse.json({ result: data });
    }
    const { data, error } = await supabase.from('benchmark_results').insert(row).select().single();
    if (error) throw error;
    return NextResponse.json({ result: data, pending: status === 'pending' }, { status: 201 });
  } catch (error: any) {
    console.error('Benchmarks POST error:', error);
    return NextResponse.json({ error: error.message || 'Failed to save result' }, { status: 500 });
  }
}

/** PATCH /api/academy/benchmarks — approve/reject a pending result. Body: { id, action }. */
export async function PATCH(request: Request) {
  try {
    const { id, action } = await request.json();
    if (!id || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'id and action (approve|reject) required' }, { status: 400 });
    }
    const supabase = createServerClient();
    if (action === 'reject') {
      const { error } = await supabase.from('benchmark_results').delete().eq('id', id).eq('coach_id', COACH_ID);
      if (error) throw error;
      return NextResponse.json({ success: true, rejected: true });
    }
    const { data, error } = await supabase
      .from('benchmark_results').update({ status: 'approved' }).eq('id', id).eq('coach_id', COACH_ID).select().single();
    if (error) throw error;
    return NextResponse.json({ result: data });
  } catch (error: any) {
    console.error('Benchmarks PATCH error:', error);
    return NextResponse.json({ error: error.message || 'Failed to update result' }, { status: 500 });
  }
}

/** DELETE /api/academy/benchmarks?id=xxx */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const supabase = createServerClient();
    const { error } = await supabase.from('benchmark_results').delete().eq('id', id).eq('coach_id', COACH_ID);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Benchmarks DELETE error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete result' }, { status: 500 });
  }
}
