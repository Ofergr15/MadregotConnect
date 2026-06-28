import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { ParsedWeeklyPlan, ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().split('T')[0];
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
    const timeMin = step.durationValue;
    const distMax = (timeMin / paceMin) * 1000;
    const distMin = (timeMin / paceMax) * 1000;
    return { min: Math.round(distMin), max: Math.round(distMax) };
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
  if (/interval|אינטרוול/.test(name)) return 'intervals';
  if (/long|ארוכה/.test(name)) return 'long_run';
  if (/tempo|טמפו/.test(name)) return 'tempo';
  if (/easy|שחרור|recovery/.test(name)) return 'easy';
  if (/fartlek|פרטלק/.test(name)) return 'fartlek';
  if (/progressive|מתגברת/.test(name)) return 'progressive';

  const hasIntervals = workout.steps.some(s => s.repeatCount || s.type === 'interval');
  if (hasIntervals) return 'intervals';
  return 'easy';
}

export async function GET() {
  try {
    const supabase = createServerClient();
    const now = new Date();
    const currentWeekStart = getWeekStart(now);

    // Get current week and last 12 weeks of plans
    const twelveWeeksAgo = new Date(now);
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);
    const startDate = twelveWeeksAgo.toISOString().split('T')[0];

    const { data: plans } = await supabase
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, status, created_at')
      .eq('coach_id', COACH_ID)
      .gte('week_start_date', startDate)
      .order('week_start_date', { ascending: true });

    // Use current week's plan, or fall back to the most recent plan
    let currentPlan = plans?.find(p => p.week_start_date === currentWeekStart);
    if (!currentPlan && plans && plans.length > 0) {
      currentPlan = plans[plans.length - 1];
    }
    const previousWeekStart = new Date(now);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    let prevPlan = plans?.find(p => p.week_start_date === getWeekStart(previousWeekStart));
    if (!prevPlan && plans && plans.length >= 2) {
      prevPlan = plans[plans.length - 2];
    }

    // Compute daily distances for current week
    const dailyDistances: Array<{ day: string; dayOfWeek: number; min: number; max: number; type: string }> = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    if (currentPlan?.parsed_workouts) {
      const workouts: ParsedWorkout[] = (currentPlan.parsed_workouts as any).workouts || [];
      for (let d = 0; d < 7; d++) {
        const workout = workouts.find(w => w.dayOfWeek === d);
        if (workout) {
          const dist = computeWorkoutDistance(workout);
          dailyDistances.push({
            day: dayNames[d],
            dayOfWeek: d,
            min: Math.round(dist.min / 1000 * 10) / 10,
            max: Math.round(dist.max / 1000 * 10) / 10,
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

    // Total weekly volume
    const weekTotalMin = dailyDistances.reduce((sum, d) => sum + d.min, 0);
    const weekTotalMax = dailyDistances.reduce((sum, d) => sum + d.max, 0);

    // Previous week volume for delta
    let prevWeekTotal = 0;
    if (prevPlan?.parsed_workouts) {
      const prevWorkouts: ParsedWorkout[] = (prevPlan.parsed_workouts as any).workouts || [];
      for (const w of prevWorkouts) {
        const dist = computeWorkoutDistance(w);
        prevWeekTotal += (dist.min + dist.max) / 2;
      }
      prevWeekTotal = Math.round(prevWeekTotal / 1000 * 10) / 10;
    }

    // Weekly volume history (training load curve)
    const weeklyVolumes: Array<{ week: string; volume: number; weekNum: number }> = [];
    if (plans) {
      for (const plan of plans) {
        if (!plan.parsed_workouts) continue;
        const workouts: ParsedWorkout[] = (plan.parsed_workouts as any).workouts || [];
        let vol = 0;
        for (const w of workouts) {
          const dist = computeWorkoutDistance(w);
          vol += (dist.min + dist.max) / 2;
        }
        weeklyVolumes.push({
          week: plan.week_start_date,
          volume: Math.round(vol / 1000 * 10) / 10,
          weekNum: weeklyVolumes.length + 1,
        });
      }
    }

    // Long run progression
    const longRunProgression: Array<{ week: string; distance: number }> = [];
    if (plans) {
      for (const plan of plans) {
        if (!plan.parsed_workouts) continue;
        const workouts: ParsedWorkout[] = (plan.parsed_workouts as any).workouts || [];
        let maxDist = 0;
        for (const w of workouts) {
          const dist = computeWorkoutDistance(w);
          const avg = (dist.min + dist.max) / 2;
          if (avg > maxDist) maxDist = avg;
        }
        longRunProgression.push({
          week: plan.week_start_date,
          distance: Math.round(maxDist / 1000 * 10) / 10,
        });
      }
    }

    // Key sessions this week
    const keySessions: Array<{ day: string; dayOfWeek: number; name: string; type: string; totalKm: number; highlight: string }> = [];
    if (currentPlan?.parsed_workouts) {
      const workouts: ParsedWorkout[] = (currentPlan.parsed_workouts as any).workouts || [];
      for (const w of workouts) {
        const wType = getWorkoutType(w);
        if (wType !== 'easy' && wType !== 'rest') {
          const dist = computeWorkoutDistance(w);
          const avgKm = Math.round(((dist.min + dist.max) / 2) / 1000 * 10) / 10;
          let highlight = '';
          const intervalStep = w.steps.find(s => s.repeatCount);
          if (intervalStep && intervalStep.repeatSteps?.[0]) {
            const rep = intervalStep.repeatSteps[0];
            const repDist = rep.durationType === 'distance' ? `${rep.durationValue}m` :
              rep.durationType === 'time' ? `${Math.round((rep.durationValue || 0) / 60)}min` : '';
            highlight = `${intervalStep.repeatCount}x${repDist}`;
          } else {
            const activeStep = w.steps.find(s => s.type === 'active' && s.durationValue);
            if (activeStep) {
              const km = activeStep.durationType === 'distance' ? `${(activeStep.durationValue || 0) / 1000}km` :
                activeStep.durationType === 'time' ? `${Math.round((activeStep.durationValue || 0) / 60)}min` : '';
              highlight = km;
            }
          }
          keySessions.push({
            day: dayNames[w.dayOfWeek],
            dayOfWeek: w.dayOfWeek,
            name: w.name,
            type: wType,
            totalKm: avgKm,
            highlight,
          });
        }
      }
    }

    // Workout type distribution
    const typeDistribution: Record<string, number> = {};
    if (currentPlan?.parsed_workouts) {
      const workouts: ParsedWorkout[] = (currentPlan.parsed_workouts as any).workouts || [];
      for (const w of workouts) {
        const t = getWorkoutType(w);
        const dist = computeWorkoutDistance(w);
        typeDistribution[t] = (typeDistribution[t] || 0) + Math.round(((dist.min + dist.max) / 2) / 1000);
      }
    }

    // Week-over-week delta
    const currentAvg = (weekTotalMin + weekTotalMax) / 2;
    const weekDelta = prevWeekTotal > 0 ? Math.round(((currentAvg - prevWeekTotal) / prevWeekTotal) * 100) : 0;

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
    });
  } catch (error) {
    console.error('Weekly dashboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch weekly data' }, { status: 500 });
  }
}
