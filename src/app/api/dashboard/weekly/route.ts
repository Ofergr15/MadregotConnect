import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';

const TIMEZONE = 'Asia/Jerusalem';
// After this hour on Saturday, athletes preview the UPCOMING week's plan.
const ROLLOVER_HOUR = 20;

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().split('T')[0];
}

/**
 * Israel wall-clock parts for a given instant (handles IDT/IST DST via Intl).
 */
function israelParts(date: Date): { year: number; month: number; day: number; weekday: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday as string] ?? 0,
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
  };
}

/**
 * The plan week (Sunday YYYY-MM-DD) that athletes should currently SEE.
 * Normally the current Israel week, but after Saturday 20:00 it advances to the
 * upcoming week so athletes can preview next week's training on Sat evening.
 */
function getDisplayWeekStart(now: Date): string {
  const p = israelParts(now);
  // Build a UTC date anchored to the Israel calendar day (time-of-day irrelevant
  // for week math since we only use it to find the Sunday).
  const israelMidday = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  // Days since Sunday, in Israel local terms.
  let daysSinceSunday = p.weekday;
  // Saturday (weekday 6) at/after ROLLOVER_HOUR → jump to next week's Sunday.
  if (p.weekday === 6 && p.hour >= ROLLOVER_HOUR) {
    daysSinceSunday = -1; // Sunday is 1 day ahead
  }
  const sunday = new Date(israelMidday);
  sunday.setUTCDate(israelMidday.getUTCDate() - daysSinceSunday);
  return sunday.toISOString().split('T')[0];
}

function extractWorkouts(parsedWorkouts: any): ParsedWorkout[] {
  if (!parsedWorkouts) return [];

  // Format: { workouts: [...] }
  if (Array.isArray(parsedWorkouts.workouts)) {
    return parsedWorkouts.workouts;
  }

  // Format: { group1: { workouts: [...] }, group2: {...}, ... }
  // Use group1 as the default display group
  for (const key of ['group1', 'group2', 'group3']) {
    const group = parsedWorkouts[key];
    if (group?.workouts && Array.isArray(group.workouts)) {
      return group.workouts;
    }
  }

  // Try any key that has workouts array
  for (const val of Object.values(parsedWorkouts)) {
    if (val && typeof val === 'object' && 'workouts' in (val as any)) {
      const w = (val as any).workouts;
      if (Array.isArray(w)) return w;
    }
  }

  return [];
}

function computeStepDistance(step: WorkoutStep): { min: number; max: number } {
  if (step.repeatCount && step.repeatSteps) {
    let subMin = 0;
    let subMax = 0;
    for (const sub of step.repeatSteps) {
      const subDist = computeStepDistance(sub);
      subMin += subDist.min;
      subMax += subDist.max;
    }
    return { min: subMin * step.repeatCount, max: subMax * step.repeatCount };
  }

  if (step.durationType === 'distance' && step.durationValue) {
    return { min: step.durationValue, max: step.durationValue };
  }

  if (step.durationType === 'time' && step.durationValue) {
    const paceMin = step.targetPaceMinPerKm || 300;
    const paceMax = step.targetPaceMaxPerKm || 360;
    const timeSec = step.durationValue;
    const distMax = (timeSec / paceMin) * 1000;
    const distMin = (timeSec / paceMax) * 1000;
    return { min: Math.round(distMin), max: Math.round(distMax) };
  }

  // Open duration with pace: estimate based on typical duration for the step type
  if (step.durationType === 'open' && step.targetPaceMinPerKm) {
    const pace = (step.targetPaceMinPerKm + (step.targetPaceMaxPerKm || step.targetPaceMinPerKm)) / 2;
    let estimatedMin = 0;
    if (step.type === 'warmup' || step.type === 'cooldown') {
      estimatedMin = 10 * 60; // 10 min warmup/cooldown
    } else if (step.type === 'active' || step.type === 'interval') {
      estimatedMin = 40 * 60; // 40 min for main active blocks
    }
    if (estimatedMin > 0) {
      const dist = (estimatedMin / pace) * 1000;
      return { min: Math.round(dist * 0.8), max: Math.round(dist * 1.2) };
    }
  }

  // Open warmup/cooldown without pace: default 2km
  if (step.durationType === 'open' && (step.type === 'warmup' || step.type === 'cooldown')) {
    return { min: 1500, max: 2500 };
  }

  return { min: 0, max: 0 };
}

function computeWorkoutDistance(workout: ParsedWorkout): { min: number; max: number } {
  let totalMin = 0;
  let totalMax = 0;
  for (const step of workout.steps) {
    const d = computeStepDistance(step);
    totalMin += d.min;
    totalMax += d.max;
  }
  return { min: totalMin, max: totalMax };
}

function getWorkoutType(workout: ParsedWorkout): string {
  const name = workout.name.toLowerCase();
  const desc = ((workout as any).description || '').toLowerCase();
  const text = `${name} ${desc}`;

  if (/fartlek|פרטלק/.test(text)) return 'fartlek';
  if (/long run|ארוכה/.test(text)) return 'long_run';
  if (/interval|אינטרוול|pyramid/.test(text)) return 'intervals';
  if (/tempo|טמפו/.test(text)) return 'tempo';
  if (/easy|שחרור|recovery/.test(text)) return 'easy';
  if (/progressive|מתגברת/.test(text)) return 'progressive';

  // Only 1 step with open duration = easy run
  if (workout.steps.length === 1 && workout.steps[0].durationType === 'open') return 'easy';

  const hasIntervals = workout.steps.some(s => s.repeatCount || s.type === 'interval');
  if (hasIntervals) return 'intervals';

  return 'easy';
}

/**
 * Compact duration for a repeat's rep, used in the "Nx…" highlight badge.
 * Distance -> "200m"; time -> "Nmin" for whole minutes, else "M:SS" (so a 30s
 * rep reads "0:30", not the old buggy "0min").
 */
function formatRepDuration(rep: WorkoutStep): string {
  if (rep.durationType === 'distance' && rep.durationValue) {
    return `${rep.durationValue}m`;
  }
  if (rep.durationType === 'time' && rep.durationValue) {
    const s = rep.durationValue;
    if (s % 60 === 0) return `${s / 60}min`;
    if (s < 60) return `0:${s.toString().padStart(2, '0')}`;
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }
  return '';
}

export async function GET() {
  try {
    const supabase = createServerClient();
    const now = new Date();
    // Plan week to display — rolls to next week after Saturday 20:00 Israel time.
    const currentWeekStart = getDisplayWeekStart(now);

    const { data: plans } = await supabase
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, status, created_at')
      .eq('coach_id', COACH_ID)
      .order('week_start_date', { ascending: true });

    // Deduplicate plans by week (prefer 'pushed' status)
    const plansByWeek = new Map<string, typeof plans extends (infer T)[] | null ? T : never>();
    if (plans) {
      for (const plan of plans) {
        const existing = plansByWeek.get(plan.week_start_date);
        if (!existing || plan.status === 'pushed') {
          plansByWeek.set(plan.week_start_date, plan);
        }
      }
    }
    const uniquePlans = Array.from(plansByWeek.values());

    let currentPlan = uniquePlans.find(p => p.week_start_date === currentWeekStart);
    if (!currentPlan && uniquePlans.length > 0) {
      currentPlan = uniquePlans[uniquePlans.length - 1];
    }

    // Previous week = 7 days before the DISPLAYED week (keeps the delta correct
    // after the Saturday-evening rollover).
    const prevWeek = new Date(currentWeekStart);
    prevWeek.setUTCDate(prevWeek.getUTCDate() - 7);
    const previousWeekStartStr = prevWeek.toISOString().split('T')[0];
    let prevPlan = uniquePlans.find(p => p.week_start_date === previousWeekStartStr);
    if (!prevPlan && uniquePlans.length >= 2) {
      prevPlan = uniquePlans[uniquePlans.length - 2];
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyDistances: Array<{ day: string; dayOfWeek: number; min: number; max: number; type: string; sessions: Array<{ min: number; max: number; type: string; name: string }> }> = [];

    const rawWorkouts = extractWorkouts(currentPlan?.parsed_workouts);
    // Deduplicate: keep only the first workout per day (group variants share same dayOfWeek)
    const currentWorkouts = rawWorkouts.filter((w, i, arr) => arr.findIndex(x => x.dayOfWeek === w.dayOfWeek) === i);

    if (currentWorkouts.length > 0) {
      for (let d = 0; d < 7; d++) {
        const dayWorkouts = currentWorkouts.filter(w => w.dayOfWeek === d);
        if (dayWorkouts.length > 0) {
          let totalMin = 0, totalMax = 0;
          const sessions: Array<{ min: number; max: number; type: string; name: string }> = [];
          for (const workout of dayWorkouts) {
            const hasCoachKm = (workout as any).distanceMinKm || (workout as any).distanceMaxKm;
            let minKm: number, maxKm: number;
            if (hasCoachKm) {
              minKm = (workout as any).distanceMinKm || (workout as any).distanceMaxKm || 0;
              maxKm = (workout as any).distanceMaxKm || (workout as any).distanceMinKm || 0;
            } else {
              const dist = computeWorkoutDistance(workout);
              minKm = Math.round(dist.min / 1000 * 10) / 10;
              maxKm = Math.round(dist.max / 1000 * 10) / 10;
            }
            totalMin += minKm;
            totalMax += maxKm;
            sessions.push({ min: minKm, max: maxKm, type: getWorkoutType(workout), name: workout.name });
          }
          dailyDistances.push({
            day: dayNames[d],
            dayOfWeek: d,
            min: totalMin,
            max: totalMax,
            type: getWorkoutType(dayWorkouts[0]),
            sessions,
          });
        } else {
          dailyDistances.push({ day: dayNames[d], dayOfWeek: d, min: 0, max: 0, type: 'rest', sessions: [] });
        }
      }
    } else {
      for (let d = 0; d < 7; d++) {
        dailyDistances.push({ day: dayNames[d], dayOfWeek: d, min: 0, max: 0, type: 'rest', sessions: [] });
      }
    }

    const weekTotalMin = dailyDistances.reduce((sum, d) => sum + d.min, 0);
    const weekTotalMax = dailyDistances.reduce((sum, d) => sum + d.max, 0);

    function getWorkoutKm(w: ParsedWorkout): { min: number; max: number } {
      const hasCoachKm = (w as any).distanceMinKm || (w as any).distanceMaxKm;
      if (hasCoachKm) {
        return {
          min: (w as any).distanceMinKm || (w as any).distanceMaxKm || 0,
          max: (w as any).distanceMaxKm || (w as any).distanceMinKm || 0,
        };
      }
      const dist = computeWorkoutDistance(w);
      return { min: Math.round(dist.min / 1000 * 10) / 10, max: Math.round(dist.max / 1000 * 10) / 10 };
    }

    // Previous week volume
    let prevWeekTotal = 0;
    const prevWorkouts = extractWorkouts(prevPlan?.parsed_workouts).filter((w, i, arr) => arr.findIndex(x => x.dayOfWeek === w.dayOfWeek) === i);
    if (prevWorkouts.length > 0) {
      for (const w of prevWorkouts) {
        const km = getWorkoutKm(w);
        prevWeekTotal += (km.min + km.max) / 2;
      }
    }

    // Weekly volume history
    const weeklyVolumes: Array<{ week: string; volume: number; weekNum: number }> = [];
    for (const plan of uniquePlans) {
      const workouts = extractWorkouts(plan.parsed_workouts).filter((w, i, arr) => arr.findIndex(x => x.dayOfWeek === w.dayOfWeek) === i);
      if (workouts.length === 0) continue;
      let vol = 0;
      for (const w of workouts) {
        const km = getWorkoutKm(w);
        vol += (km.min + km.max) / 2;
      }
      weeklyVolumes.push({
        week: plan.week_start_date,
        volume: Math.round(vol * 10) / 10,
        weekNum: weeklyVolumes.length + 1,
      });
    }

    // Long run progression (longest workout each week)
    const longRunProgression: Array<{ week: string; distance: number }> = [];
    for (const plan of uniquePlans) {
      const workouts = extractWorkouts(plan.parsed_workouts).filter((w, i, arr) => arr.findIndex(x => x.dayOfWeek === w.dayOfWeek) === i);
      if (workouts.length === 0) continue;
      let maxDist = 0;
      for (const w of workouts) {
        const km = getWorkoutKm(w);
        const avg = (km.min + km.max) / 2;
        if (avg > maxDist) maxDist = avg;
      }
      longRunProgression.push({
        week: plan.week_start_date,
        distance: Math.round(maxDist * 10) / 10,
      });
    }

    // Key sessions this week (deduplicated by day)
    const keySessions: Array<{ day: string; dayOfWeek: number; name: string; type: string; totalKm: number; highlight: string; steps: any[] }> = [];
    const seenDays = new Set<number>();
    for (const w of currentWorkouts) {
      if (seenDays.has(w.dayOfWeek)) continue;
      const wType = getWorkoutType(w);
      if (wType !== 'easy' && wType !== 'rest') {
        seenDays.add(w.dayOfWeek);
        const km = getWorkoutKm(w);
        const avgKm = Math.round(((km.min + km.max) / 2) * 10) / 10;

        const displayName = (w as any).description || w.name;

        let highlight = '';
        if (wType === 'long_run') {
          highlight = `${km.min}–${km.max}km`;
        } else if (wType === 'fartlek') {
          const mainRepeat = w.steps.find(s => s.repeatCount && s.repeatCount > 2);
          if (mainRepeat && mainRepeat.repeatSteps?.[0]) {
            const dur = formatRepDuration(mainRepeat.repeatSteps[0]);
            if (dur) highlight = `${mainRepeat.repeatCount}x${dur}`;
          }
        } else {
          const intervalStep = w.steps.find(s => s.repeatCount && s.repeatSteps?.[0]?.durationValue);
          if (intervalStep && intervalStep.repeatSteps?.[0]) {
            const dur = formatRepDuration(intervalStep.repeatSteps[0]);
            if (dur) highlight = `${intervalStep.repeatCount}x${dur}`;
          }
        }

        keySessions.push({
          day: dayNames[w.dayOfWeek],
          dayOfWeek: w.dayOfWeek,
          name: displayName,
          type: wType,
          totalKm: avgKm,
          highlight,
          steps: w.steps,
        });
      }
    }

    // Workout type distribution
    const typeDistribution: Record<string, number> = {};
    for (const w of currentWorkouts) {
      const t = getWorkoutType(w);
      const km = getWorkoutKm(w);
      typeDistribution[t] = (typeDistribution[t] || 0) + Math.round((km.min + km.max) / 2);
    }

    // Week-over-week delta
    const currentAvg = (weekTotalMin + weekTotalMax) / 2;
    const weekDelta = prevWeekTotal > 0 ? Math.round(((currentAvg - prevWeekTotal) / prevWeekTotal) * 100) : 0;

    // Training days count
    const trainingDays = dailyDistances.filter(d => d.max > 0).length;

    return NextResponse.json({
      dailyDistances,
      weekTotalMin: Math.round(weekTotalMin * 10) / 10,
      weekTotalMax: Math.round(weekTotalMax * 10) / 10,
      weekDelta,
      prevWeekTotal,
      weeklyVolumes,
      longRunProgression,
      keySessions,
      typeDistribution,
      currentWeekStart,
      trainingDays,
    });
  } catch (error) {
    console.error('Weekly dashboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch weekly data' }, { status: 500 });
  }
}
