import { NextRequest, NextResponse } from 'next/server';
import { GarminClient } from '@/lib/garmin/client';
import { convertToGarminWorkout } from '@/lib/garmin/converter';
import { createServerClient } from '@/lib/supabase/server';
import { ParsedWorkout } from '@/lib/ai/types';
import { PaceProfile } from '@/lib/garmin/types';
import { loadAcademySettings } from '@/lib/academy/settings-server';

interface PushResult {
  athleteId: string;
  athleteName: string;
  status: 'success' | 'failed';
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { planId, workouts, athleteIds, weekStartDate } = await req.json();

    if (!workouts || !athleteIds || !weekStartDate) {
      return NextResponse.json(
        { error: 'workouts, athleteIds, and weekStartDate are required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch athletes with their auth tokens and group pace profiles. Academy
    // athletes (is_academy) get pace-zone TARGETS (alerting); everyone else gets
    // info-only pace text. The is_academy column may not exist yet on older DBs,
    // so fall back to a select without it rather than failing the whole push.
    let athletes: any[] | null = null;
    let athletesError: any = null;

    const primary = await supabase
      .from('athletes')
      .select('id, name, email, garmin_auth, is_academy, group_id, groups(pace_profile)')
      .in('id', athleteIds)
      .eq('status', 'active');

    if (primary.error) {
      const fallback = await supabase
        .from('athletes')
        .select('id, name, email, garmin_auth, group_id, groups(pace_profile)')
        .in('id', athleteIds)
        .eq('status', 'active');
      athletes = fallback.data;
      athletesError = fallback.error;
    } else {
      athletes = primary.data;
    }

    if (athletesError || !athletes) {
      return NextResponse.json(
        { error: 'Failed to fetch athletes' },
        { status: 500 }
      );
    }

    const results: PushResult[] = [];

    // Academy pace-zone alerts are on by default but coach-toggleable in settings.
    const { paceAlerts } = await loadAcademySettings();

    for (const athlete of athletes) {
      try {
        if (!athlete.garmin_auth) {
          results.push({
            athleteId: athlete.id,
            athleteName: athlete.name,
            status: 'failed',
            error: 'No Garmin auth token',
          });
          continue;
        }

        const garmin = new GarminClient(athlete.garmin_auth as any);
        const paceProfile = ((athlete as any).groups?.pace_profile || {}) as PaceProfile;
        const isAcademy = !!(athlete as any).is_academy;

        for (const workout of workouts as ParsedWorkout[]) {
          const garminWorkout = convertToGarminWorkout(workout, paceProfile, { paceTarget: isAcademy && paceAlerts });

          // Calculate the actual date for this workout
          const startDate = new Date(weekStartDate);
          startDate.setDate(startDate.getDate() + workout.dayOfWeek);
          const dateStr = startDate.toISOString().split('T')[0];

          const workoutId = await garmin.createWorkout(garminWorkout);
          await garmin.scheduleWorkout(workoutId, dateStr);

          // Record delivery
          if (planId) {
            await supabase.from('workout_deliveries').insert({
              plan_id: planId,
              athlete_id: athlete.id,
              workout_date: dateStr,
              workout_data: garminWorkout,
              garmin_workout_id: workoutId,
              status: 'success',
            });
          }
        }

        results.push({
          athleteId: athlete.id,
          athleteName: athlete.name,
          status: 'success',
        });
      } catch (error: any) {
        results.push({
          athleteId: athlete.id,
          athleteName: athlete.name,
          status: 'failed',
          error: error.message || 'Unknown error',
        });

        if (planId) {
          await supabase.from('workout_deliveries').insert({
            plan_id: planId,
            athlete_id: athlete.id,
            workout_date: weekStartDate,
            workout_data: {},
            status: 'failed',
            error_message: error.message,
          });
        }
      }
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('Push workouts error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to push workouts' },
      { status: 500 }
    );
  }
}
