import { NextResponse } from 'next/server';
import { missingKinds, type KindChoice } from '@/lib/academy/kind-choice';
import type { LibraryKind } from '@/lib/academy/library';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingColumn, isMissingTable, withoutColumns } from '@/lib/supabase/schema-drift';
import { isAcademyManager } from '@/lib/academy/pairing-server';
import { loadLaneReferences, loadThresholds } from '@/lib/academy/book-server';
import { buildImport, daySessionRow, fillRows, importSummary, sourceCounts, templateRow, type ImportPlanRow } from '@/lib/academy/book-import';
import { hasAbsolutePaces, type LibraryStep } from '@/lib/academy/library';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Bring every workout the app already holds into the book.
 *
 *   GET  /api/academy/library/import          → the review list (nothing written), plus
 *                                               `fill`: what "למלא את הספר מכל ההיסטוריה" would add
 *   POST /api/academy/library/import { keys } → write the chosen candidates
 *   POST /api/academy/library/import { action: 'fill' }
 *                                             → write EVERY session the history holds that the
 *                                               book does not, each one unclassified (its type a
 *                                               guess until a manager chooses it — migration 159).
 *                                               Idempotent: a second run adds nothing.
 *
 * The history is every store a workout was ever written in: the club's weeks and the
 * academy's personal weeks (`weekly_plans`), the one-day sessions (`day_sessions`) and the
 * legacy templates (`academy_workouts`).
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

  // The one-day sessions and the legacy templates. Either store missing (an unpasted
  // migration) just means it adds nothing.
  const [days, templates] = await Promise.all([
    supabase.from('day_sessions').select('id, session_date, title, steps').order('session_date', { ascending: true }),
    supabase.from('academy_workouts').select('id, name, workout, created_at'),
  ]);
  for (const d of (days.error ? [] : days.data || []) as any[]) {
    const row = daySessionRow({ id: String(d.id), session_date: String(d.session_date), title: d.title, steps: d.steps });
    if (row) rows.push(row);
  }
  for (const w of (templates.error ? [] : templates.data || []) as any[]) {
    const row = templateRow({ id: String(w.id), name: w.name, workout: w.workout, created_at: w.created_at });
    if (row) rows.push(row);
  }

  const academyIds = [...new Set(rows.map(r => r.athleteId).filter((x): x is string => !!x))];

  const readExisting = (columns: string) =>
    supabase.from('academy_workout_library').select(columns).is('archived_at', null);
  let existingRes = await readExisting('id, name, steps, import_key');
  let fillReady = true;
  if (existingRes.error && isMissingColumn(existingRes.error, 'import_key')) {
    fillReady = false;
    existingRes = await readExisting('id, name, steps');
  }
  const [thresholds, refs] = await Promise.all([
    loadThresholds(supabase, academyIds),
    loadLaneReferences(supabase),
  ]);
  if (existingRes.error && isMissingTable(existingRes.error)) return { notSetUp: true as const };

  const existing = (existingRes.data || []).map((e: any) => ({
    id: String(e.id), name: String(e.name || ''), steps: (Array.isArray(e.steps) ? e.steps : []) as LibraryStep[],
    importKey: e.import_key ? String(e.import_key) : null,
  }));
  const candidates = buildImport({ plans: rows, thresholds, clubReferenceSec: refs[1], existing });
  return {
    notSetUp: false as const,
    candidates,
    plansScanned: rows.filter(r => !r.origin || r.origin === 'club' || r.origin === 'academy').length,
    sources: sourceCounts(rows),
    // Migration 159 decides whether the fill can mark its rows unclassified — and it may
    // not write them without that mark, or the guess would read as the coach's choice.
    fillReady,
    existingCount: existing.length,
  };
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
    const fill = fillRows(result.candidates);
    return NextResponse.json({
      plansScanned: result.plansScanned,
      summary: importSummary(result.candidates),
      fill: { toAdd: fill.length, sources: result.sources, alreadyIn: result.existingCount, ready: result.fillReady },
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
    if (body?.action === 'fill') return fill(caller.athleteId);
    const keys = new Set(Array.isArray(body?.keys) ? (body.keys as unknown[]).filter((k): k is string => typeof k === 'string') : []);
    if (!keys.size) return NextResponse.json({ error: 'keys are required' }, { status: 400 });
    // Each entry's type is the manager's choice, never the import's guess (kind-choice.ts).
    const kinds = (body?.kinds && typeof body.kinds === 'object' ? body.kinds : {}) as Record<string, unknown>;
    const unchosen = missingKinds(keys, kinds as Record<string, KindChoice>);
    if (unchosen.length) return NextResponse.json({ error: 'kinds are required', keys: unchosen }, { status: 400 });

    const supabase = createServerClient();
    const result = await build(supabase);
    if (result.notSetUp) return NextResponse.json({ tableMissing: true }, { status: 503 });

    const chosen = result.candidates.filter(c => keys.has(c.key) && c.saveable && c.steps && !hasAbsolutePaces(c.steps));
    if (!chosen.length) return NextResponse.json({ written: 0, skipped: keys.size });

    const payload = chosen.map(c => ({
      scope: 'academy',
      owner_id: caller.athleteId,
      name: c.name,
      kind: kinds[c.key] as LibraryKind,
      notes: null,
      steps: c.steps,
      use_count: c.uses,
      last_used_at: c.lastWeek ? `${c.lastWeek}T12:00:00Z` : null,
      // The structure it came in under, so the history fill knows it is already here.
      import_key: c.key,
    }));
    let { data, error } = await supabase.from('academy_workout_library').insert(payload).select('id');
    if (error && isMissingColumn(error, 'import_key')) {
      ({ data, error } = await supabase.from('academy_workout_library').insert(withoutColumns(payload, ['import_key'])).select('id'));
    }
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

/**
 * "למלא את הספר מכל ההיסטוריה": every session not yet in the book, written unclassified.
 * Row by row on a name clash, so one taken name never blocks the other ninety.
 */
async function fill(ownerId: string) {
  const supabase = createServerClient();
  const result = await build(supabase);
  if (result.notSetUp) return NextResponse.json({ tableMissing: true }, { status: 503 });
  if (!result.fillReady) return NextResponse.json({ error: 'migration 159 needed', needsMigration: 159 }, { status: 409 });

  const rows = fillRows(result.candidates).map(r => ({
    scope: 'academy',
    owner_id: ownerId,
    name: r.name,
    kind: r.kind,
    kind_confirmed: false,
    import_key: r.key,
    notes: null,
    steps: r.steps,
    use_count: r.uses,
    last_used_at: r.lastWeek ? `${r.lastWeek}T12:00:00Z` : null,
  }));
  if (!rows.length) return NextResponse.json({ written: 0, skipped: 0 });

  const table = () => supabase.from('academy_workout_library');
  const batch = await table().insert(rows).select('id');
  if (!batch.error) return NextResponse.json({ written: (batch.data || []).length, skipped: 0 });
  if (isMissingColumn(batch.error)) return NextResponse.json({ error: 'migration 159 needed', needsMigration: 159 }, { status: 409 });
  if (String((batch.error as { code?: string }).code) !== '23505') {
    return NextResponse.json({ error: 'Failed to fill the book' }, { status: 500 });
  }
  let written = 0;
  let skipped = 0;
  for (const row of rows) {
    const one = await table().insert(row).select('id');
    if (one.error) skipped += 1; else written += 1;
  }
  return NextResponse.json({ written, skipped });
}
