import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { addDaysToDateStr, planWeekStartOf } from '@/lib/utils';
import { requireTraineeAccess, visibleTraineeIds } from '@/lib/academy/pairing-server';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { laneForBand, lanesDiffer, type Lane } from '@/lib/academy/group-lane';
import { pickSeniorDay } from '@/lib/academy/senior-pick';
import {
  allAcademyTraineeIds, loadClubWeek, loadLaneReferences, loadThresholds, loadTrainees, loadTraineeWeeks,
} from '@/lib/academy/book-server';
import { decideRecipients, hasWorkoutOn, mergeDay, type SkipReason } from '@/lib/academy/day-send';
import {
  hasAbsolutePaces, resolveLibraryWorkout, type LibraryStep,
} from '@/lib/academy/library';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';
import { applyPaceAdjust } from '@/lib/academy/coach-tools';
import { loadPaceAdjusts } from '@/lib/academy/coach-tools-server';
import { revalidateWeeklyPlans } from '@/lib/plans/cache';
import { pushWeekToAthlete } from '@/lib/garmin/push-week';
import type { ParsedWorkout } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';
// A handful of trainees, one workout each: two Garmin calls and a read-back per trainee.
export const maxDuration = 120;

/**
 * One trainee's day — the workout book v3's "לבחור → להתאים → לשלוח".
 *
 *   GET  /api/academy/day-plan?athleteId=…&date=YYYY-MM-DD[&lane=1|2|3]
 *        → the trainee (band, lane, threshold), the senior groups' session that day and
 *          their other sessions that week (both relative, see senior-pick.ts), what the
 *          trainee already has that day, and the coach's other trainees for "send to
 *          others too".
 *
 *   POST /api/academy/day-plan
 *        { date, recipients: [primary, …others], workout: { name, notes, steps }, entryId? }
 *        → each recipient's own copy, resolved from THEIR threshold, saved into their week
 *          and pushed to their watch through `pushWeekToAthlete` — the same delivery the
 *          planner and "לשלוח שוב" use. ("לשמור בספר" is the book's own POST, which already
 *          guards what an entry may hold.)
 *
 * Gated per trainee by `requireTraineeAccess` (the manager, or that trainee's own coach),
 * which is narrower than push-workouts' any-staff: this route takes steps in the body, and
 * the only people who may put a session on a trainee's watch are the ones coaching them.
 *
 * The steps arrive RELATIVE (`hasAbsolutePaces` refuses anything else) and are resolved
 * here, per recipient. A pace computed on the phone for the first trainee is never what a
 * second trainee receives — the defect plan-slot.ts exists to prevent.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayOfWeekOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const athleteId = (url.searchParams.get('athleteId') || '').trim();
    const date = url.searchParams.get('date') || '';
    if (!athleteId || !DATE.test(date)) {
      return NextResponse.json({ error: 'athleteId and date=YYYY-MM-DD are required' }, { status: 400 });
    }
    const { denied, caller, pair } = await requireTraineeAccess(request, athleteId);
    if (denied) return denied;

    const supabase = createServerClient();
    const weekStart = planWeekStartOf(date);
    const dayOfWeek = dayOfWeekOf(date);

    const visible = await visibleTraineeIds(caller);
    const rosterIds = visible === null ? await allAcademyTraineeIds(supabase) : [...visible];
    const ids = [...new Set([athleteId, ...rosterIds])];

    const [trainees, thresholds, weeks, club, refs, adjusts] = await Promise.all([
      loadTrainees(supabase, ids),
      loadThresholds(supabase, ids),
      loadTraineeWeeks(supabase, ids, weekStart),
      loadClubWeek(supabase, weekStart),
      loadLaneReferences(supabase),
      // The coach's pace update in force that week (coach tools, migration 139): every pace
      // the screens draw and every pace sent goes through it. `{}` = none = as before.
      loadPaceAdjusts(supabase, ids, weekStart),
    ]);

    const me = trainees.find(t => t.id === athleteId);
    const bandLane = laneForBand(me?.bandNumber);
    const asked = Number(url.searchParams.get('lane'));
    const lane: Lane = asked === 1 || asked === 2 || asked === 3 ? asked : bandLane ?? 2;
    const senior = pickSeniorDay(club, lane, dayOfWeek, refs[lane]);
    const myWeek = weeks[athleteId] ?? { planId: null, workouts: [] };

    const others = trainees
      .filter(t => t.id !== athleteId && t.isAcademy && t.active)
      .map(t => ({
        id: t.id,
        name: t.name,
        thresholdSec: thresholds[t.id] ?? null,
        paceAdjust: adjusts[t.id] ?? {},
        hasGarmin: t.hasGarmin,
        lane: laneForBand(t.bandNumber),
        busy: hasWorkoutOn(weeks[t.id]?.workouts ?? [], dayOfWeek),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      date,
      weekStart,
      dayOfWeek,
      trainee: {
        id: athleteId,
        name: me?.name ?? pair?.name ?? '',
        bandNumber: me?.bandNumber ?? null,
        lane,
        bandLane,
        thresholdSec: thresholds[athleteId] ?? null,
        paceAdjust: adjusts[athleteId] ?? {},
        hasGarmin: !!me?.hasGarmin,
      },
      lanesDiffer: club ? lanesDiffer(club) : false,
      hasClubWeek: !!club,
      senior,
      existing: myWeek.workouts.filter(w => w.dayOfWeek === dayOfWeek),
      others,
    });
  } catch (error) {
    console.error('day-plan GET error:', error);
    return NextResponse.json({ error: 'Failed to load the day' }, { status: 500 });
  }
}

interface SendResult {
  athleteId: string;
  name: string;
  status: 'sent' | 'saved' | 'skipped' | 'failed';
  reason?: SkipReason | 'push-failed' | 'save-failed' | 'not-yours';
  detail?: string | null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const date = typeof body?.date === 'string' ? body.date : '';
    const recipients: string[] = Array.isArray(body?.recipients)
      ? [...new Set((body.recipients as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()))].slice(0, 30)
      : [];
    const name = String(body?.workout?.name || '').trim();
    const notes = String(body?.workout?.notes || '').trim() || null;
    const steps = body?.workout?.steps as LibraryStep[] | undefined;
    if (!DATE.test(date) || !recipients.length || !name) {
      return NextResponse.json({ error: 'date, recipients and workout.name are required' }, { status: 400 });
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'A workout needs at least one step' }, { status: 400 });
    }
    if (hasAbsolutePaces(steps)) {
      return NextResponse.json({ error: 'Steps must be relative to threshold, not absolute paces' }, { status: 400 });
    }

    // Every recipient, checked before anything is written — a send that pushes to the
    // first three and then 403s on the fourth leaves a week nobody asked for.
    const access = await Promise.all(recipients.map(id => requireTraineeAccess(request, id)));
    const primaryDenied = access[0]?.denied;
    if (primaryDenied) return primaryDenied;
    const caller = access[0]!.caller;

    const supabase = createServerClient();
    const weekStart = planWeekStartOf(date);
    const dayOfWeek = dayOfWeekOf(date);
    const allowed = recipients.filter((_, i) => !access[i]!.denied);

    const [trainees, thresholds, weeks, settings, adjusts] = await Promise.all([
      loadTrainees(supabase, allowed),
      loadThresholds(supabase, allowed),
      loadTraineeWeeks(supabase, allowed, weekStart),
      loadAcademySettings(),
      loadPaceAdjusts(supabase, allowed, weekStart),
    ]);
    const byId = new Map(trainees.map(t => [t.id, t]));

    const decisions = decideRecipients(allowed.map(id => ({
      id,
      isPrimary: id === recipients[0],
      thresholdSec: thresholds[id] ?? null,
      hasWorkoutThatDay: hasWorkoutOn(weeks[id]?.workouts ?? [], dayOfWeek),
      isAcademy: !!byId.get(id)?.isAcademy,
      active: !!byId.get(id)?.active,
    })));

    const results: SendResult[] = recipients
      .filter((_, i) => access[i]!.denied)
      .map(id => ({ athleteId: id, name: '', status: 'skipped', reason: 'not-yours' }));

    // Garmin needs the token, which the roster read deliberately does not carry around.
    const sendIds = decisions.filter(d => d.action === 'send').map(d => d.id);
    const { data: tokens } = sendIds.length
      ? await supabase.from('athletes').select('id, name, garmin_auth, is_academy, group_id, groups!group_id(pace_profile)').in('id', sendIds)
      : { data: [] as any[] };
    const athleteRow = new Map(((tokens || []) as any[]).map(a => [String(a.id), a]));

    let assigned = 0;
    for (const decision of decisions) {
      const who = byId.get(decision.id);
      const label = who?.name ?? '';
      if (decision.action === 'skip') {
        results.push({ athleteId: decision.id, name: label, status: 'skipped', reason: decision.reason });
        continue;
      }

      // Their own threshold, then their pace update — the same function and marker as the
      // stored weeks (coach-tools.ts), so a later update moves this session by the difference.
      // No update: `applyPaceAdjust` hands the workout back untouched.
      const plain = resolveLibraryWorkout({ name, notes, steps }, { thresholdPaceSec: decision.thresholdSec, dayOfWeek });
      const resolved = plain ? applyPaceAdjust(plain, decision.thresholdSec, adjusts[decision.id] ?? {}) : null;
      if (!resolved) {
        results.push({ athleteId: decision.id, name: label, status: 'skipped', reason: 'no-test' });
        continue;
      }

      const week = weeks[decision.id] ?? { planId: null, workouts: [] };
      const parsed = normalizeParsedWorkouts({ workouts: mergeDay(week.workouts, resolved) });
      const others = parsed.workouts.filter(w => w.dayOfWeek !== dayOfWeek).length;
      let planId = week.planId;
      const write = planId
        ? await supabase.from('weekly_plans').update({ parsed_workouts: parsed }).eq('id', planId).select('id').single()
        : await supabase.from('weekly_plans').insert({
          coach_id: COACH_ID,
          week_start_date: weekStart,
          original_input: '[built in-app]',
          parsed_workouts: parsed,
          status: 'draft',
          athlete_id: decision.id,
        }).select('id').single();
      if (write.error || !write.data) {
        results.push({ athleteId: decision.id, name: label, status: 'failed', reason: 'save-failed', detail: write.error?.message ?? null });
        continue;
      }
      planId = String(write.data.id);
      assigned += 1;

      const athlete = athleteRow.get(decision.id);
      if (!athlete?.garmin_auth) {
        // Saved anyway: their app and their adherence read the plan row, and a trainee on
        // Strava has a session to follow even with no watch to put it on.
        results.push({ athleteId: decision.id, name: label, status: 'saved' });
        continue;
      }

      // Only this day's part(s) go to Garmin. `pushWeekToAthlete` replaces whatever this
      // plan put on that DATE before, so the rest of the week on the watch is untouched.
      const today = parsed.workouts.filter(w => w.dayOfWeek === dayOfWeek) as ParsedWorkout[];
      const push = await pushWeekToAthlete({
        supabase,
        athlete,
        plannedWorkouts: today,
        weekStartDate: weekStart,
        planId,
        // Priced from the trainee's own test, so a pace alert is set to a number that is
        // theirs — the one case the planner's veto exists for does not arise here.
        paceTarget: !!athlete.is_academy && settings.paceAlerts,
        cleanDayOnce: caller.isSuperUser,
      });
      if (push.status === 'success') {
        await supabase.from('weekly_plans').update({ status: others ? 'partial' : 'pushed' }).eq('id', planId);
        results.push({ athleteId: decision.id, name: label, status: 'sent' });
      } else {
        results.push({ athleteId: decision.id, name: label, status: 'failed', reason: 'push-failed', detail: push.error ?? null });
      }
    }
    if (assigned) revalidateWeeklyPlans();

    // The book: the entry this came from is used once per trainee who got it.
    const entryId = typeof body?.entryId === 'string' ? body.entryId : null;
    if (entryId && assigned) {
      const { data: row } = await supabase.from('academy_workout_library').select('use_count').eq('id', entryId).maybeSingle();
      if (row) {
        await supabase.from('academy_workout_library')
          .update({ use_count: Number(row.use_count || 0) + assigned, last_used_at: new Date().toISOString() })
          .eq('id', entryId);
      }
    }

    return NextResponse.json({ date, weekStart, weekEnd: addDaysToDateStr(weekStart, 6), assigned, results });
  } catch (error) {
    console.error('day-plan POST error:', error);
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }
}
