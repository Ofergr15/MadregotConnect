import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { addDaysToDateStr, israelToday, planWeekStartOf } from '@/lib/utils';
import { requireCallerForAthlete, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayCoach, visibleTraineeIds } from '@/lib/academy/pairing-server';
import { allAcademyTraineeIds } from '@/lib/academy/book-server';
import { buildCoachTools } from '@/lib/academy/coach-tools-build';
import { thresholdOn } from '@/lib/academy/load';
import { loadTestsFor, plannedLoads } from '@/lib/academy/load-server';
import { sortReadiness } from '@/lib/academy/readiness';
import { loadReadinessInputs, loadWeekCounts } from '@/lib/academy/readiness-server';
import {
  projectionOf, readinessAlert, readinessRows, weeklySeries,
  type ReadinessDetailResponse, type ReadinessInputs, type ReadinessListResponse,
} from '@/lib/academy/readiness-board';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/academy/readiness[?scope=coach]            C1: every trainee's readiness
 * GET /api/academy/readiness?athleteId=…              C2: one trainee
 * (mockup trainee-experience-v2, the coach's phones C1 and C2)
 *
 * C1 — STAFF ONLY, scoped exactly like /api/academy/coach-tools: the manager sees the
 * academy, a coach their own trainees, `?scope=coach` narrows a manager to theirs. One row
 * per trainee (form and its word, the 7-week fitness spark, the ONE fact that stands out)
 * and the one alert: the most severe trainee the gate pauses for being very tired and/or a
 * resting HR above the range.
 *
 * C2 — staff on the academy's 1:1 line (`mayCoach`: the manager or one of the trainee's own
 * coaches; the trainee themself is not staff and gets 403 — this is the coach's view). The
 * three numbers, 8 weeks of fitness and fatigue, and the projection: what is left of this
 * week and the trainee's next week as planned, priced with the planned-load formula (E2)
 * and run forward to next Saturday. Then feel / effort / pain and this week's sessions, the
 * body against its range, and the pace suggestion with its gate.
 *
 * SIDE EFFECT: pricing the loads that have no stored row yet (migration 142), at most 100
 * per trainee. Skipped under view-as, which prices them in memory instead.
 */
export async function GET(request: Request) {
  try {
    const athleteId = new URL(request.url).searchParams.get('athleteId') || '';
    return athleteId ? await detail(request, athleteId) : await list(request);
  } catch (error) {
    console.error('readiness error:', error);
    return NextResponse.json({ error: 'Failed to load the readiness' }, { status: 500 });
  }
}

async function list(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.isSuperUser && !caller.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }
  const supabase = createServerClient();
  const visible = await visibleTraineeIds(caller, request);
  const ids = visible === null ? await allAcademyTraineeIds(supabase) : [...visible];
  const today = israelToday();
  const [reads, weeks] = await Promise.all([
    loadReadinessInputs(supabase, ids, today, { write: !caller.viewingAsBy }),
    loadWeekCounts(ids, today),
  ]);
  const trainees = ids
    .filter(id => reads[id] && reads[id].isAcademy && reads[id].active)
    .map(id => ({ athleteId: id, name: reads[id].name, gender: reads[id].gender }));
  const inputsBy: Record<string, ReadinessInputs> = Object.fromEntries(trainees.map(t => [t.athleteId, reads[t.athleteId].inputs]));
  const alert = readinessAlert(trainees, inputsBy);
  const rows = sortReadiness(readinessRows(trainees, inputsBy, weeks, alert?.athleteId ?? null), 'tired');
  return NextResponse.json({ today, rows, alert } satisfies ReadinessListResponse);
}

async function detail(request: Request, athleteId: string) {
  const { denied, caller } = await requireCallerForAthlete(request, athleteId);
  if (denied) return denied;
  if (!caller.isStaff && !caller.isSuperUser) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }
  if (!(await mayCoach(caller, athleteId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const supabase = createServerClient();
  const today = israelToday();
  const write = !caller.viewingAsBy;
  const thisWeek = planWeekStartOf(today);
  const nextWeek = addDaysToDateStr(thisWeek, 7);
  const [reads, weeks, tests] = await Promise.all([
    loadReadinessInputs(supabase, [athleteId], today, { write }),
    loadWeekCounts([athleteId], today),
    loadTestsFor(supabase, [athleteId]),
  ]);
  const read = reads[athleteId];
  if (!read) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const T = thresholdOn(today, tests[athleteId] || [])?.thresholdSec ?? null;
  const [planned, tools] = await Promise.all([
    plannedLoads(supabase, athleteId, [thisWeek, nextWeek], T),
    // The same suggestion the home lists, gated with the readiness just read.
    buildCoachTools(supabase, [athleteId], { withMissedKm: false, write, readiness: reads }),
  ]);

  const i = read.inputs;
  const ranRows = read.rows.filter(r => r.date === today && r.load != null);
  const ranToday = ranRows.length ? ranRows.reduce((s, r) => s + (r.load ?? 0), 0) : null;
  const week = weeks[athleteId];
  const body: ReadinessDetailResponse = {
    today,
    athleteId,
    name: read.name,
    gender: read.gender,
    status: i.status,
    numbers: i.pmcToday && i.bandKey && i.rampWordKey
      ? { ...i.pmcToday, bandKey: i.bandKey, rampWordKey: i.rampWordKey, heavyLastWeek: i.heavyLastWeek }
      : null,
    series: weeklySeries(read.series, today),
    projection: projectionOf({ pmc: { status: i.status, series: read.series }, today, ranToday, plannedByDate: planned.byDate }),
    feel: {
      face: i.feelFace,
      effort: i.effortAvg4,
      n: i.feelN,
      pain: i.pain7,
      weekDone: week?.done ?? 0,
      weekPlanned: week?.planned ?? 0,
    },
    body: {
      rhr: { today: i.rhr.today, isToday: i.rhr.isToday, range: i.rhr.range, aboveRun: i.rhr.streak.aboveRun, flag: i.rhr.streak.flag },
      sleep: i.sleep,
    },
    pace: {
      suggestion: tools.pace.find(p => p.athleteId === athleteId) ?? null,
      held: tools.paused?.find(p => p.athleteId === athleteId)?.reasons ?? null,
      gate: i.gate,
    },
  };
  return NextResponse.json(body);
}
