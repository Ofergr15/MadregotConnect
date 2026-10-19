import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { COACH_ID } from '@/lib/constants';
import { isCoachingType, setupMissing } from '@/lib/academy/trainee-setup';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/trainee-setup?athleteId=  — the coach's "טופס התאמה": the coaching type,
 *     the band (and the bands to pick from), the trainee's funnel card (whose characterization
 *     holds goal and days), and what is still missing.
 * PUT { athleteId, coachingType?, bandId? } — the trainee's own coach or a manager; never the
 *     trainee (these are the coach's calls — Ofer, 2026-10-19).
 */
async function gate(request: Request, athleteId: string) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  if (!athleteId || caller.athleteId === athleteId || !(await mayCoach(caller, athleteId))) {
    return { denied: NextResponse.json({ error: 'Not allowed' }, { status: 403 }) };
  }
  return { denied: null as null };
}

export async function GET(request: Request) {
  const athleteId = new URL(request.url).searchParams.get('athleteId') || '';
  const g = await gate(request, athleteId);
  if (g.denied) return g.denied;
  const db = createServerClient();
  const [{ data: a }, { data: bands }, { data: card }] = await Promise.all([
    db.from('athletes').select('id, name, academy_intake, academy_band_id').eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle(),
    db.from('academy_bands').select('id, name, active').eq('active', true).order('name'),
    db.from('academy_candidates').select('id').eq('athlete_id', athleteId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
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
  return NextResponse.json({
    name: row.name,
    coachingType,
    bandId: row.academy_band_id,
    bands: ((bands || []) as Array<{ id: string; name: string }>).map((b) => ({ id: b.id, name: b.name })),
    candidateId,
    // What the trainee answered in their form, for the coach to read first.
    fromTrainee: {
      medicalHistory: typeof intake.medicalHistory === 'string' ? intake.medicalHistory : null,
      medicalDetails: typeof intake.medicalDetails === 'string' ? intake.medicalDetails : null,
    },
    missing: setupMissing({ coachingType, bandId: row.academy_band_id, goalType, availableDays }),
  });
}

export async function PUT(request: Request) {
  const b = (await request.json().catch(() => null)) as { athleteId?: unknown; coachingType?: unknown; bandId?: unknown } | null;
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
  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });
  const { error } = await db.from('athletes').update(patch).eq('id', athleteId).eq('coach_id', COACH_ID);
  if (error) {
    console.error('[academy/trainee-setup] save failed:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
