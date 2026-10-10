import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { addDaysToDateStr, israelToday, planWeekStartOf } from '@/lib/utils';
import { requireTraineeAccess } from '@/lib/academy/pairing-server';
import { loadTraineeWeeks } from '@/lib/academy/book-server';
import { MISSED_OPTIONS, activeAdjust, copyWeek, type MissedOption } from '@/lib/academy/coach-tools';
import {
  daysFrom, loadDecisions, loadTestBasis, recordDecision, writeWeek,
} from '@/lib/academy/coach-tools-server';
import type { ParsedWorkout } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/academy/missed-week { athleteId, weekStart, option } — "לעדכן את השבוע הבא" on
 * the missed-workouts screen (mockup phone 3). `weekStart` is the MISSED week; the change
 * lands on the week after it.
 *
 *   light    the same workouts at 70% of the volume, fast reps run easy (next week's own
 *            workouts; if next week is still empty, the missed week's)
 *   planned  nothing changes — recorded, so the suggestion goes away
 *   repeat   next week = the missed week again, at the trainee's paces today
 *   talk     nothing changes; the client opens the thread
 *
 * Only days from today on are rewritten: a session already past is history. The rewritten
 * days go to the watch when the trainee has one. WHO: the manager or one of their coaches.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const athleteId = typeof body?.athleteId === 'string' ? body.athleteId.trim() : '';
    const weekStart = typeof body?.weekStart === 'string' && DATE.test(body.weekStart) ? planWeekStartOf(body.weekStart) : '';
    const option = body?.option as MissedOption;
    if (!athleteId || !weekStart || !MISSED_OPTIONS.includes(option)) {
      return NextResponse.json({ error: 'athleteId, weekStart and option are required' }, { status: 400 });
    }
    const { denied, caller } = await requireTraineeAccess(request, athleteId);
    if (denied) return denied;

    const supabase = createServerClient();
    const today = israelToday();
    const targetWeek = addDaysToDateStr(weekStart, 7);
    const [basis, decisions, target, missed] = await Promise.all([
      loadTestBasis(supabase, [athleteId]),
      loadDecisions(supabase, [athleteId]),
      loadTraineeWeeks(supabase, [athleteId], targetWeek),
      loadTraineeWeeks(supabase, [athleteId], weekStart),
    ]);
    const b = basis[athleteId];
    const T = b?.thresholdSec ?? null;
    const adjust = activeAdjust(decisions.rows, b?.testDate ?? null).adjust;

    let changed: ParsedWorkout[] | null = null;
    const open = new Set(daysFrom(targetWeek, today));
    const targetWorkouts = target[athleteId]?.workouts ?? [];
    if (option === 'light' || option === 'repeat') {
      const base = option === 'repeat' || !targetWorkouts.length ? (missed[athleteId]?.workouts ?? []) : targetWorkouts;
      if (!base.length) {
        return NextResponse.json({ error: 'nothing-to-build', detail: 'Neither week has workouts' }, { status: 409 });
      }
      const built = copyWeek({
        workouts: base.filter(w => open.has(w.dayOfWeek)),
        sourceThresholdSec: T,
        targetThresholdSec: T,
        targetAdjust: adjust,
        sameTrainee: true,
        mode: option === 'light' ? 'light' : 'same',
      }).map(c => c.workout);
      // The days already past keep what they had; every open day is the new version.
      changed = [...targetWorkouts.filter(w => !open.has(w.dayOfWeek)), ...built].sort((a, b2) => a.dayOfWeek - b2.dayOfWeek);
    }

    let result: Awaited<ReturnType<typeof writeWeek>> | null = null;
    if (changed) {
      result = await writeWeek(supabase, {
        athleteId,
        weekStart: targetWeek,
        workouts: changed,
        pushDays: changed.filter(w => open.has(w.dayOfWeek)).map(w => w.dayOfWeek),
      }, { cleanDayOnce: caller.isSuperUser });
      if (result.status === 'failed' && result.stage === 'save') {
        return NextResponse.json({ error: 'save-failed', detail: result.detail }, { status: 500 });
      }
    }
    const stored = await recordDecision(supabase, {
      athleteId, coachId: caller.athleteId, kind: 'missed', action: option,
      basisTestDate: b?.testDate ?? null, weekStart,
      evidence: { targetWeek, workouts: changed?.length ?? null },
    });
    return NextResponse.json({
      ok: true, stored, option, targetWeek,
      status: result?.status ?? 'unchanged',
      workouts: changed?.length ?? null,
      openThread: option === 'talk',
    });
  } catch (error) {
    console.error('missed-week error:', error);
    return NextResponse.json({ error: 'Failed to update the week' }, { status: 500 });
  }
}
