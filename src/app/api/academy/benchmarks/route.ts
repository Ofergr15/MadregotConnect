import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// Try to link a result to a registered athlete by exact (trimmed) name match.
async function resolveAthleteId(supabase: any, name: string): Promise<string | null> {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const { data } = await supabase
    .from('athletes')
    .select('id, name')
    .eq('coach_id', COACH_ID)
    .ilike('name', trimmed);
  return data && data.length ? data[0].id : null;
}

/**
 * GET /api/academy/benchmarks?test=2000m[&athleteId=xxx][&name=...]
 * Returns results ranked fastest-first, with a computed rank.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const test = searchParams.get('test');
    const athleteId = searchParams.get('athleteId');
    const name = searchParams.get('name');

    const supabase = createServerClient();
    let q = supabase
      .from('benchmark_results')
      .select('id, test_name, athlete_name, athlete_id, time_seconds, notes, recorded_on')
      .eq('coach_id', COACH_ID)
      .order('time_seconds', { ascending: true });
    if (test) q = q.eq('test_name', test);

    const { data, error } = await q;
    if (error) return NextResponse.json({ tests: [], results: [] });

    // Rank within each test (fastest = 1).
    const rankByTest: Record<string, number> = {};
    const ranked = (data || []).map((r: any) => {
      rankByTest[r.test_name] = (rankByTest[r.test_name] || 0) + 1;
      return { ...r, rank: rankByTest[r.test_name] };
    });

    // Optional filtering to a single athlete (for the profile "Best" section).
    let results = ranked;
    if (athleteId) results = ranked.filter((r: any) => r.athlete_id === athleteId);
    else if (name) results = ranked.filter((r: any) => (r.athlete_name || '').trim().toLowerCase() === name.trim().toLowerCase());

    const tests = Array.from(new Set(ranked.map((r: any) => r.test_name)));
    return NextResponse.json({ tests, results });
  } catch (error: any) {
    console.error('Benchmarks GET error:', error);
    return NextResponse.json({ tests: [], results: [] });
  }
}

/**
 * POST /api/academy/benchmarks
 * Body: { id?, testName, athleteName, timeSeconds, notes?, recordedOn?, athleteId? }
 * Upserts a result. athlete_id auto-resolved from athleteName when not given.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, testName, athleteName, timeSeconds, notes, recordedOn, athleteId } = body;
    if (!athleteName || timeSeconds == null) {
      return NextResponse.json({ error: 'athleteName and timeSeconds are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const linkedId = athleteId !== undefined ? athleteId : await resolveAthleteId(supabase, athleteName);

    const row: Record<string, any> = {
      coach_id: COACH_ID,
      test_name: testName || '2000m',
      athlete_name: athleteName.trim(),
      time_seconds: timeSeconds,
      notes: notes || null,
      recorded_on: recordedOn || null,
      athlete_id: linkedId,
    };

    if (id) {
      const { data, error } = await supabase
        .from('benchmark_results').update(row).eq('id', id).eq('coach_id', COACH_ID)
        .select().single();
      if (error) throw error;
      return NextResponse.json({ result: data });
    }

    const { data, error } = await supabase
      .from('benchmark_results').insert(row).select().single();
    if (error) throw error;
    return NextResponse.json({ result: data }, { status: 201 });
  } catch (error: any) {
    console.error('Benchmarks POST error:', error);
    return NextResponse.json({ error: error.message || 'Failed to save result' }, { status: 500 });
  }
}

/** DELETE /api/academy/benchmarks?id=xxx */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const supabase = createServerClient();
    const { error } = await supabase
      .from('benchmark_results').delete().eq('id', id).eq('coach_id', COACH_ID);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Benchmarks DELETE error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete result' }, { status: 500 });
  }
}
