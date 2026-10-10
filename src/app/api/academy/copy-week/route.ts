import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { israelToday, planWeekStartOf } from '@/lib/utils';
import { requireTraineeAccess, visibleTraineeIds } from '@/lib/academy/pairing-server';
import { allAcademyTraineeIds, loadTrainees, loadTraineeWeeks } from '@/lib/academy/book-server';
import {
  PROGRESSIONS, activeAdjust, copyWeek, targetWeeks, type Progression,
} from '@/lib/academy/coach-tools';
import {
  daysFrom, loadDecisions, loadTestBasis, recordDecision, weekCounts, writeWeek, type WeekWriteResult,
} from '@/lib/academy/coach-tools-server';
import type { CopyWeekResponse } from '@/lib/academy/coach-tools-payload';

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
 *        → each recipient's own copy (their threshold, their pace update; no test = no
 *          paces), REPLACING the target weeks, saved, and sent to the watch when `send`.
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
    const candidates = trainees
      .filter(t => t.id === athleteId || (t.isAcademy && t.active))
      .map(t => ({
        id: t.id,
        name: t.name,
        thresholdSec: basis[t.id]?.thresholdSec ?? null,
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
        thresholdSec: basis[athleteId]?.thresholdSec ?? null,
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

    const results: Array<WeekWriteResult & { name: string; paced: boolean }> = [];
    for (const id of recipients) {
      const t = byId.get(id);
      if (!t || (id !== sourceId && !(t.isAcademy && t.active))) continue;
      const adjust = activeAdjust(decisions.rows.filter(d => d.athleteId === id), basis[id]?.testDate ?? null).adjust;
      for (let k = 0; k < weeks.length; k++) {
        const weekStart = weeks[k];
        const copied = copyWeek({
          workouts,
          sourceThresholdSec: basis[sourceId]?.thresholdSec ?? null,
          targetThresholdSec: basis[id]?.thresholdSec ?? null,
          targetAdjust: adjust,
          sameTrainee: id === sourceId,
          mode,
          times: mode === 'plus5' || mode === 'plus10' ? k + 1 : 1,
        });
        const open = new Set(daysFrom(weekStart, today));
        const res = await writeWeek(supabase, {
          athleteId: id,
          weekStart,
          workouts: copied.map(c => c.workout),
          pushDays: send ? copied.map(c => c.workout.dayOfWeek).filter(d => open.has(d)) : [],
        }, { cleanDayOnce: caller.isSuperUser });
        results.push({ ...res, name: t.name, paced: copied.every(c => c.paced) });
      }
    }
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
