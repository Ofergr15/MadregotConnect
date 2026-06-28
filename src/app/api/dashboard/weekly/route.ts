import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().split('T')[0];
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

export async function GET() {
  try {
    const supabase = createServerClient();
    const now = new Date();
    const currentWeekStart = getWeekStart(now);

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

    const previousWeekStart = new Date(now);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    let prevPlan = uniquePlans.find(p => p.week_start_date === getWeekStart(previousWeekStart));
    if (!prevPlan && uniquePlans.length >= 2) {
      prevPlan = uniquePlans[uniquePlans.length - 2];
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyDistances: Array<{ day: string; dayOfWeek: number; min: number; max: number; type: string }> = [];

    const currentWorkouts = extractWorkouts(currentPlan?.parsed_workouts);

    if (currentWorkouts.length > 0) {
      for (let d = 0; d < 7; d++) {
        // Use first workout for each day (skip group variants)
        const workout = currentWorkouts.find(w => w.dayOfWeek === d);
        if (workout) {
          // Prefer coach-specified km range from PDF header
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
          dailyDistances.push({
            day: dayNames[d],
            dayOfWeek: d,
            min: minKm,
            max: maxKm,
            type: getWorkoutType(workout),
          });
        } else {
          dailyDistances.push({ day: dayNames[d], dayOfWeek: d, min: 0, max: 0, type: 'rest' });
        }
      }
    } else {
      for (let d = 0; d < 7; d++) {
        dailyDistances.push({ day: dayNames[d], dayOfWeek: d, min: 0, max: 0, type: 'rest' });
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
    const prevWorkouts = extractWorkouts(prevPlan?.parsed_workouts);
    if (prevWorkouts.length > 0) {
      for (const w of prevWorkouts) {
        const km = getWorkoutKm(w);
        prevWeekTotal += (km.min + km.max) / 2;
      }
    }

    // Weekly volume history
    const weeklyVolumes: Array<{ week: string; volume: number; weekNum: number }> = [];
    for (const plan of uniquePlans) {
      const workouts = extractWorkouts(plan.parsed_workouts);
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
      const workouts = extractWorkouts(plan.parsed_workouts);
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
            const rep = mainRepeat.repeatSteps[0];
            const dur = rep.durationType === 'distance' ? `${rep.durationValue}m` :
              rep.durationType === 'time' && rep.durationValue ? `${Math.round(rep.durationValue / 60)}min` : '';
            if (dur) highlight = `${mainRepeat.repeatCount}x${dur}`;
          }
        } else {
          const intervalStep = w.steps.find(s => s.repeatCount && s.repeatSteps?.[0]?.durationValue);
          if (intervalStep && intervalStep.repeatSteps?.[0]) {
            const rep = intervalStep.repeatSteps[0];
            const dur = rep.durationType === 'distance' ? `${rep.durationValue}m` :
              rep.durationType === 'time' && rep.durationValue ? `${Math.round(rep.durationValue / 60)}min` : '';
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
