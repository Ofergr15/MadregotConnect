import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { isAcademyManager } from '@/lib/academy/pairing-server';
import { loadLaneReferences, loadThresholds } from '@/lib/academy/book-server';
import { buildImport, importSummary, type ImportPlanRow } from '@/lib/academy/book-import';
import { hasAbsolutePaces, type LibraryStep } from '@/lib/academy/library';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Bring every workout the app already holds into the book.
 *
 *   GET  /api/academy/library/import          → the review list (nothing written)
 *   POST /api/academy/library/import { keys } → write the chosen candidates
 *
 * MANAGER ONLY (`isAcademyManager`: admin, academy manager, super user) — the entries land
 * on the academy shelf, which is the canon every coach pushes from.
 *
 * The POST takes structure KEYS, not steps. The list is rebuilt here from the same plans,
 * so what is written is exactly what the review showed and a client cannot write arbitrary
 * steps through this door; a key the rebuild no longer produces is simply not written.
 */

async function build(supabase: ReturnType<typeof createServerClient>) {
  const { data: plans, error } = await supabase
    .from('weekly_plans')
    .select('id, athlete_id, week_start_date, parsed_workouts')
    .eq('coach_id', COACH_ID)
    .order('week_start_date', { ascending: true });
  if (error) throw error;

  const rows: ImportPlanRow[] = (plans || []).map((p: any) => ({
    id: String(p.id),
    athleteId: p.athlete_id ? String(p.athlete_id) : null,
    weekStart: String(p.week_start_date),
    parsed: p.parsed_workouts,
  }));
  const academyIds = [...new Set(rows.map(r => r.athleteId).filter((x): x is string => !!x))];

  const [thresholds, refs, existingRes] = await Promise.all([
    loadThresholds(supabase, academyIds),
    loadLaneReferences(supabase),
    supabase.from('academy_workout_library').select('id, name, steps').is('archived_at', null),
  ]);
  if (existingRes.error && isMissingTable(existingRes.error)) return { notSetUp: true as const };

  const existing = (existingRes.data || []).map((e: any) => ({
    id: String(e.id), name: String(e.name || ''), steps: (Array.isArray(e.steps) ? e.steps : []) as LibraryStep[],
  }));
  const candidates = buildImport({ plans: rows, thresholds, clubReferenceSec: refs[1], existing });
  return { notSetUp: false as const, candidates, plansScanned: rows.length };
}

async function gate(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!isAcademyManager(caller)) {
    return { denied: NextResponse.json({ error: 'Manager access required' }, { status: 403 }), caller };
  }
  return { denied: null, caller };
}

export async function GET(request: Request) {
  try {
    const { denied } = await gate(request);
    if (denied) return denied;
    const supabase = createServerClient();
    const result = await build(supabase);
    if (result.notSetUp) return NextResponse.json({ tableMissing: true, candidates: [] });
    return NextResponse.json({
      plansScanned: result.plansScanned,
      summary: importSummary(result.candidates),
      // The sources are for the count and the date; the plan ids stay here.
      candidates: result.candidates.map(({ sources, ...c }) => ({
        ...c,
        sources: sources.map(s => ({ weekStart: s.weekStart, dayOfWeek: s.dayOfWeek, origin: s.origin })),
      })),
    });
  } catch (error) {
    console.error('library import GET error:', error);
    return NextResponse.json({ error: 'Failed to build the import' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { denied, caller } = await gate(request);
    if (denied) return denied;
    if (!caller.athleteId) {
      return NextResponse.json({ error: 'Only a coach with an athlete record may write to the book' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const keys = new Set(Array.isArray(body?.keys) ? (body.keys as unknown[]).filter((k): k is string => typeof k === 'string') : []);
    if (!keys.size) return NextResponse.json({ error: 'keys are required' }, { status: 400 });

    const supabase = createServerClient();
    const result = await build(supabase);
    if (result.notSetUp) return NextResponse.json({ tableMissing: true }, { status: 503 });

    const chosen = result.candidates.filter(c => keys.has(c.key) && c.saveable && c.steps && !hasAbsolutePaces(c.steps));
    if (!chosen.length) return NextResponse.json({ written: 0, skipped: keys.size });

    const { data, error } = await supabase
      .from('academy_workout_library')
      .insert(chosen.map(c => ({
        scope: 'academy',
        owner_id: caller.athleteId,
        name: c.name,
        kind: c.kind,
        notes: null,
        steps: c.steps,
        use_count: c.uses,
        last_used_at: c.lastWeek ? `${c.lastWeek}T12:00:00Z` : null,
      })))
      .select('id');
    if (error) {
      if (String((error as { code?: string }).code) === '23505') {
        return NextResponse.json({ error: 'A workout by one of these names is already on the shelf' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to write the import' }, { status: 500 });
    }
    return NextResponse.json({ written: (data || []).length, skipped: keys.size - chosen.length });
  } catch (error) {
    console.error('library import POST error:', error);
    return NextResponse.json({ error: 'Failed to write the import' }, { status: 500 });
  }
}
