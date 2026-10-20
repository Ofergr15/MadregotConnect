import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { israelToday, planWeekStartOf } from '@/lib/utils';
import { requireTraineeAccess, visibleTraineeIds } from '@/lib/academy/pairing-server';
import { allAcademyTraineeIds, loadSeniorSeed, loadTrainees, loadTraineeWeeks } from '@/lib/academy/book-server';
import {
  PROGRESSIONS, activeAdjust, copyWeek, targetWeeks, type Progression,
} from '@/lib/academy/coach-tools';
import {
  daysFrom, loadDecisions, loadTestBasis, recordDecision, weekCounts, writeWeek, type WeekWriteResult,
} from '@/lib/academy/coach-tools-server';
import { notifyPlanSaved } from '@/lib/academy/loop-notify';
import type { CopyWeekResponse } from '@/lib/academy/coach-tools-payload';
import { markBandPriced, resolveThreshold, type PaceBasis } from '@/lib/academy/day-send';

export const dynamic = 'force-dynamic';
// Up to 4 weeks × a handful of trainees, each week a Garmin round trip.
export const maxDuration = 300;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Copying a week (mockup phones 4 and 5): "מהשבוע של מתאמן: להעתיק".
 *
 *   GET  /api/academy/copy-week?athleteId=<source>&weekStart=YYYY-MM-DD
 *        → the source week (as stored, with the source's threshold), the trainees it may go
 *          to (the caller's own, the source included) with their thresholds, pace updates
 *          and how many workouts each already has in the next four weeks. The phone builds
 *          the preview from these with the same pure `copyWeek` this route uses to write.
 *
 *   POST /api/academy/copy-week
 *        { sourceAthleteId, sourceWeek, weeks: 1-4, recipients: [ids], mode, send }
 *        → each recipient's own copy (their threshold — or their band's own pace, marked —
 *          and their pace update; neither = no paces), REPLACING the target weeks, saved, and sent to the watch when `send`.
 *
 * WHO: the manager, or the coach of the source AND of every recipient — checked per
 * trainee before anything is written.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const athleteId = (url.searchParams.get('athleteId') || '').trim();
    const asked = url.searchParams.get('weekStart') || '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    const { denied, caller } = await requireTraineeAccess(request, athleteId);
    if (denied) return denied;

    const supabase = createServerClient();
    const today = israelToday();
    const sourceWeek = planWeekStartOf(DATE.test(asked) ? asked : today);
    const weeks = targetWeeks(sourceWeek, 4);
    const visible = await visibleTraineeIds(caller);
    const roster = visible === null ? await allAcademyTraineeIds(supabase) : [...visible];
    const ids = [...new Set([athleteId, ...roster])];

    const [trainees, basis, decisions, counts, source] = await Promise.all([
      loadTrainees(supabase, ids),
      loadTestBasis(supabase, ids),
      loadDecisions(supabase, ids),
      weekCounts(supabase, ids, weeks),
      loadTraineeWeeks(supabase, [athleteId], sourceWeek),
    ]);
    const me = trainees.find(t => t.id === athleteId);
    // The test, else the band's own pace (day-send.ts) — the same rule day-plan prices by.
    const priced = (t: { id: string; bandThresholdSec: number | null } | undefined, id: string) =>
      resolveThreshold(basis[id]?.thresholdSec, t?.bandThresholdSec, basis[id]?.source);
    const candidates = trainees
      .filter(t => t.id === athleteId || (t.isAcademy && t.active))
      .map(t => ({
        id: t.id,
        name: t.name,
        thresholdSec: priced(t, t.id).sec,
        paceBasis: priced(t, t.id).basis,
        adjust: activeAdjust(decisions.rows.filter(d => d.athleteId === t.id), basis[t.id]?.testDate ?? null).adjust,
        existing: counts[t.id] ?? {},
        hasGarmin: t.hasGarmin,
      }))
      // The source first (the mockup lists them first), then by name.
      .sort((a, b) => (a.id === athleteId ? -1 : b.id === athleteId ? 1 : a.name.localeCompare(b.name)));

    const body: CopyWeekResponse = {
      source: {
        id: athleteId,
        name: me?.name ?? '',
        weekStart: sourceWeek,
        thresholdSec: priced(me, athleteId).sec,
        workouts: source[athleteId]?.workouts ?? [],
      },
      candidates,
      weeks,
      today,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('copy-week GET error:', error);
    return NextResponse.json({ error: 'Failed to load the week' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.fromClub === true) return await copyClubWeek(request, body);
    const sourceId = typeof body?.sourceAthleteId === 'string' ? body.sourceAthleteId.trim() : '';
    const sourceWeek = typeof body?.sourceWeek === 'string' && DATE.test(body.sourceWeek) ? planWeekStartOf(body.sourceWeek) : '';
    const n = Math.max(1, Math.min(4, Number(body?.weeks) || 1));
    const mode = body?.mode as Progression;
    const send = body?.send !== false;
    const recipients: string[] = Array.isArray(body?.recipients)
      ? [...new Set((body.recipients as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()))].slice(0, 30)
      : [];
    if (!sourceId || !sourceWeek || !recipients.length || !PROGRESSIONS.includes(mode)) {
      return NextResponse.json({ error: 'sourceAthleteId, sourceWeek, recipients and mode are required' }, { status: 400 });
    }

    const source = await requireTraineeAccess(request, sourceId);
    if (source.denied) return source.denied;
    const access = await Promise.all(recipients.map(id => requireTraineeAccess(request, id)));
    const denied = recipients.filter((_, i) => access[i].denied);
    if (denied.length) {
      return NextResponse.json({ error: 'not-yours', recipients: denied }, { status: 403 });
    }
    const caller = source.caller;

    const supabase = createServerClient();
    const today = israelToday();
    const weeks = targetWeeks(sourceWeek, n);
    const ids = [...new Set([sourceId, ...recipients])];
    const [trainees, basis, decisions, src] = await Promise.all([
      loadTrainees(supabase, ids),
      loadTestBasis(supabase, ids),
      loadDecisions(supabase, ids),
      loadTraineeWeeks(supabase, [sourceId], sourceWeek),
    ]);
    const workouts = src[sourceId]?.workouts ?? [];
    if (!workouts.length) return NextResponse.json({ error: 'empty-source' }, { status: 409 });
    const byId = new Map(trainees.map(t => [t.id, t]));

    const priced = (id: string) => resolveThreshold(basis[id]?.thresholdSec, byId.get(id)?.bandThresholdSec, basis[id]?.source);
    const results: Array<WeekWriteResult & { name: string; paced: boolean; paceBasis?: PaceBasis }> = [];
    for (const id of recipients) {
      const t = byId.get(id);
      if (!t || (id !== sourceId && !(t.isAcademy && t.active))) continue;
      const target = priced(id);
      const adjust = activeAdjust(decisions.rows.filter(d => d.athleteId === id), basis[id]?.testDate ?? null).adjust;
      for (let k = 0; k < weeks.length; k++) {
        const weekStart = weeks[k];
        const copied = copyWeek({
          workouts,
          sourceThresholdSec: priced(sourceId).sec,
          targetThresholdSec: target.sec,
          targetAdjust: adjust,
          sameTrainee: id === sourceId,
          mode,
          times: mode === 'plus5' || mode === 'plus10' ? k + 1 : 1,
        });
        const open = new Set(daysFrom(weekStart, today));
        const res = await writeWeek(supabase, {
          athleteId: id,
          weekStart,
          // Band-priced (no test yet): every paced session says so.
          workouts: markBandPriced(copied, target.basis),
          pushDays: send ? copied.map(c => c.workout.dayOfWeek).filter(d => open.has(d)) : [],
        }, { cleanDayOnce: caller.isSuperUser });
        results.push({ ...res, name: t.name, paced: copied.every(c => c.paced), ...(target.basis === 'band' ? { paceBasis: 'band' as const } : {}) });
      }
    }
    // A trainee whose new weeks no watch announced (no Garmin, or the push failed) is told
    // by the app (launch BL8): once per trainee, opening the board.
    const unannounced = new Map<string, number>();
    for (const r of results) {
      if (r.status === 'saved' || (r.status === 'failed' && r.stage === 'push')) {
        unannounced.set(r.athleteId, (unannounced.get(r.athleteId) ?? 0) + workouts.length);
      }
    }
    await Promise.all([...unannounced].map(([athleteId, days]) => notifyPlanSaved({
      athleteId, actorId: caller.athleteId, date: null, days,
      failedWatch: results.some(r => r.athleteId === athleteId && r.status === 'failed'),
    })));
    await recordDecision(supabase, {
      athleteId: sourceId, coachId: caller.athleteId, kind: 'copy', action: mode,
      basisTestDate: basis[sourceId]?.testDate ?? null, weekStart: sourceWeek,
      evidence: { weeks, recipients, send },
    });
    return NextResponse.json({ ok: true, weeks, results });
  } catch (error) {
    console.error('copy-week POST error:', error);
    return NextResponse.json({ error: 'Failed to copy the week' }, { status: 500 });
  }
}

/**
 * "שבוע שלם מהקבוצה" (Ofer, 2026-10-20): the club's week for this trainee's lane, restated to
 * THEIR threshold (loadSeniorSeed — the same seed a single day uses), with their pace update and
 * manual zones on top, written as their own week. The coach then edits single days.
 *   POST { fromClub: true, athleteId, weekStart, send }
 */
async function copyClubWeek(request: Request, body: { athleteId?: unknown; weekStart?: unknown; send?: unknown }) {
  const athleteId = typeof body.athleteId === 'string' ? body.athleteId.trim() : '';
  const weekStart = typeof body.weekStart === 'string' && DATE.test(body.weekStart) ? planWeekStartOf(body.weekStart) : '';
  if (!athleteId || !weekStart) return NextResponse.json({ error: 'athleteId and weekStart are required' }, { status: 400 });
  const { denied, caller } = await requireTraineeAccess(request, athleteId);
  if (denied) return denied;
  const supabase = createServerClient();
  const [trainees, basis, decisions] = await Promise.all([
    loadTrainees(supabase, [athleteId]),
    loadTestBasis(supabase, [athleteId]),
    loadDecisions(supabase, [athleteId]),
  ]);
  const target = resolveThreshold(basis[athleteId]?.thresholdSec, trainees[0]?.bandThresholdSec, basis[athleteId]?.source);
  const seed = await loadSeniorSeed(supabase, athleteId, weekStart, target.sec);
  if (!seed.length) return NextResponse.json({ error: 'no-club-week' }, { status: 409 });
  const adjust = activeAdjust(decisions.rows, basis[athleteId]?.testDate ?? null).adjust;
  const copied = copyWeek({ workouts: seed, sourceThresholdSec: target.sec, targetThresholdSec: target.sec, targetAdjust: adjust, sameTrainee: false, mode: 'same' });
  const open = new Set(daysFrom(weekStart, israelToday()));
  const res = await writeWeek(supabase, {
    athleteId,
    weekStart,
    workouts: markBandPriced(copied, target.basis),
    pushDays: body.send !== false ? copied.map(c => c.workout.dayOfWeek).filter(d => open.has(d)) : [],
  }, { cleanDayOnce: caller.isSuperUser });
  return NextResponse.json({ results: [{ ...res, name: trainees[0]?.name ?? '', paced: copied.every(c => c.paced), ...(target.basis === 'band' || target.basis === 'coach' ? { paceBasis: target.basis } : {}) }] });
}
