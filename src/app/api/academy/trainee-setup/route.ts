import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { COACH_ID } from '@/lib/constants';
import { isCoachingType, setupMissing } from '@/lib/academy/trainee-setup';
import { israelToday } from '@/lib/utils';
import {
  BASELINE_DISTANCES, BASELINE_PROTOCOL, baselineNotes, baselineTestRow, isBaselineDistance, parseBaselineNotes,
  readSheetResults, suggestFromSheet, thresholdFromRace, validResult, type BaselineSource,
} from '@/lib/academy/coach-baseline';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/trainee-setup?athleteId=  — the coach's "טופס התאמה": the coaching type,
 *     the band (and the bands to pick from), the trainee's funnel card (whose characterization
 *     holds goal and days), and what is still missing.
 * PUT { athleteId, coachingType?, bandId?, baseline? } — the trainee's own coach or a manager;
 *     never the trainee (these are the coach's calls — Ofer, 2026-10-19). `baseline`
 *     { distance, km?, sec, origin } is the pace baseline instead of a test (coach-baseline.ts):
 *     one `academy_tests` row per trainee, protocol 'coach_baseline', written as its 30-minute
 *     equivalent; `baseline: null` removes it.
 */
async function gate(request: Request, athleteId: string) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, callerId: null };
  if (!athleteId || caller.athleteId === athleteId || !(await mayCoach(caller, athleteId))) {
    return { denied: NextResponse.json({ error: 'Not allowed' }, { status: 403 }), callerId: null };
  }
  return { denied: null as null, callerId: caller.athleteId ?? null };
}

/**
 * The coach's pace baseline: one row per trainee (the old one goes), today's date, approved on
 * arrival like any staff entry. Null clears it. A response only on a bad request or a failure.
 */
async function saveBaseline(db: ReturnType<typeof createServerClient>, athleteId: string, raw: unknown, authorId: string | null): Promise<NextResponse | null> {
  const del = await db.from('academy_tests').delete().eq('athlete_id', athleteId).eq('protocol', BASELINE_PROTOCOL);
  if (del.error) {
    console.error('[academy/trainee-setup] baseline clear failed:', del.error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  if (raw === null) return null;
  const v = raw as { distance?: unknown; km?: unknown; sec?: unknown; origin?: unknown } | null;
  const distance = isBaselineDistance(v?.distance) ? v!.distance : 'other';
  const km = distance === 'other' ? Number(v?.km) : BASELINE_DISTANCES[distance].km;
  const sec = Math.round(Number(v?.sec));
  if (!validResult(km, sec) || !thresholdFromRace(km, sec)) return NextResponse.json({ error: 'bad baseline' }, { status: 400 });
  const origin: BaselineSource['origin'] = v?.origin === 'sheet' || v?.origin === 'race' ? v.origin : 'estimate';
  const row = baselineTestRow(km, sec)!;
  const { error } = await db.from('academy_tests').insert({
    athlete_id: athleteId,
    test_date: israelToday(),
    protocol: BASELINE_PROTOCOL,
    ...row,
    notes: baselineNotes({ distance, km, sec, origin }),
    author_id: authorId,
    status: 'approved',
    approved_by: authorId,
    approved_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[academy/trainee-setup] baseline save failed:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  return null;
}

export async function GET(request: Request) {
  const athleteId = new URL(request.url).searchParams.get('athleteId') || '';
  const g = await gate(request, athleteId);
  if (g.denied) return g.denied;
  const db = createServerClient();
  const [{ data: a }, { data: bands }, { data: card }, { data: tests }] = await Promise.all([
    db.from('athletes').select('id, name, academy_intake, academy_band_id').eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle(),
    db.from('academy_bands').select('id, name, active, pace_profile').eq('active', true).order('name'),
    db.from('academy_candidates').select('id').eq('athlete_id', athleteId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('academy_tests').select('test_date, protocol, status, excluded_reason, duration_sec, distance_m, notes').eq('athlete_id', athleteId).order('test_date', { ascending: false }).limit(20),
  ]);
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const row = a as { name: string | null; academy_intake: Record<string, unknown> | null; academy_band_id: string | null };
  const candidateId = (card as { id: string } | null)?.id ?? null;
  let goalType: string | null = null;
  let availableDays: number[] = [];
  if (candidateId) {
    const { data: c } = await db.from('academy_characterizations').select('goal_type, available_days').eq('candidate_id', candidateId).maybeSingle();
    const ch = c as { goal_type?: string | null; available_days?: number[] | null } | null;
    goalType = ch?.goal_type ?? null;
    availableDays = Array.isArray(ch?.available_days) ? ch!.available_days! : [];
  }
  const coachingType = typeof row.academy_intake?.focus === 'string' ? (row.academy_intake.focus as string) : null;
  const intake = row.academy_intake || {};
  type TestLite = { test_date: string; protocol: string | null; status: string | null; excluded_reason: string | null; duration_sec: number; distance_m: number; notes: string | null };
  const rows = ((tests || []) as TestLite[]).filter((t) => !t.excluded_reason && (t.status ?? 'approved') === 'approved');
  const tested = rows.some((t) => (t.protocol ?? '30min') === '30min');
  const baseRow = rows.find((t) => t.protocol === BASELINE_PROTOCOL);
  const baseline = baseRow ? {
    date: String(baseRow.test_date).slice(0, 10),
    thresholdSec: Math.round(Number(baseRow.duration_sec) / (Number(baseRow.distance_m) / 1000)),
    source: parseBaselineNotes(baseRow.notes),
  } : null;
  const sheetResults = readSheetResults(intake);
  return NextResponse.json({
    name: row.name,
    coachingType,
    bandId: row.academy_band_id,
    bands: ((bands || []) as Array<{ id: string; name: string; pace_profile?: { description?: unknown } | null }>).map((b) => ({
      id: b.id, name: b.name,
      description: typeof b.pace_profile?.description === 'string' ? b.pace_profile.description : null,
    })),
    // The pace basis: an approved 30-minute test makes the baseline unnecessary (and wins over it).
    tested,
    baseline,
    sheetResults,
    suggestion: suggestFromSheet(sheetResults),
    candidateId,
    // What the trainee answered in their form, for the coach to read first.
    fromTrainee: {
      medicalHistory: typeof intake.medicalHistory === 'string' ? intake.medicalHistory : null,
      medicalDetails: typeof intake.medicalDetails === 'string' ? intake.medicalDetails : null,
    },
    missing: setupMissing({ coachingType, bandId: row.academy_band_id, goalType, availableDays, hasPaceBasis: tested || !!baseline }),
  });
}

export async function PUT(request: Request) {
  const b = (await request.json().catch(() => null)) as { athleteId?: unknown; coachingType?: unknown; bandId?: unknown; baseline?: unknown } | null;
  const athleteId = typeof b?.athleteId === 'string' ? b.athleteId : '';
  const g = await gate(request, athleteId);
  if (g.denied) return g.denied;
  const db = createServerClient();
  const patch: Record<string, unknown> = {};
  if (b && 'coachingType' in b) {
    if (b.coachingType !== null && !isCoachingType(b.coachingType)) return NextResponse.json({ error: 'bad coaching type' }, { status: 400 });
    // Into the same answers the form writes, so every screen that shows "מה מדבר אליו" agrees.
    const { data: a } = await db.from('athletes').select('academy_intake').eq('id', athleteId).maybeSingle();
    const intake = { ...((a as { academy_intake?: Record<string, unknown> | null } | null)?.academy_intake || {}) };
    if (b.coachingType === null) delete intake.focus; else intake.focus = b.coachingType;
    patch.academy_intake = intake;
  }
  if (b && 'bandId' in b) {
    if (b.bandId !== null) {
      if (typeof b.bandId !== 'string') return NextResponse.json({ error: 'bad band' }, { status: 400 });
      const { data: band } = await db.from('academy_bands').select('id, active').eq('id', b.bandId).maybeSingle();
      if (!band || (band as { active?: boolean }).active === false) return NextResponse.json({ error: 'No such band' }, { status: 400 });
    }
    patch.academy_band_id = b.bandId;
  }
  if (b && 'baseline' in b) {
    const res = await saveBaseline(db, athleteId, b.baseline, g.callerId);
    if (res) return res;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });
  const { error } = await db.from('athletes').update(patch).eq('id', athleteId).eq('coach_id', COACH_ID);
  if (error) {
    console.error('[academy/trainee-setup] save failed:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
