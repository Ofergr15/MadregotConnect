import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { isMissingColumn } from '@/lib/supabase/schema-drift';

export const dynamic = 'force-dynamic';

const COACH_ID = '30f056a7-c651-490e-8356-615ea9eff097';

interface DeliveryStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
}

/**
 * A row of the history list. Deliberately WITHOUT `original_input` and
 * `parsed_workouts`: they used to be here, which made this response 439 KB —
 * every plan's raw coach prompt plus its full workout JSON — for a page that
 * renders a date, a status pill and a delivery count per row. `workout_count`
 * below is the only thing the list ever derived from the workout JSON, and it's
 * computed server-side, so the shipped payload is now a few hundred bytes a row.
 * The expanded card reads both fields from the `?planId=` branch instead.
 */
interface PlanSummary {
  id: string;
  week_start_date: string;
  status: 'draft' | 'pushed' | 'partial';
  created_at: string;
  delivery_stats: DeliveryStats;
  workout_count: number;
}

interface DeliveryDetail {
  id: string;
  athlete_id: string;
  athlete_name: string;
  workout_date: string;
  status: 'pending' | 'success' | 'failed';
  garmin_workout_id: string | null;
  /**
   * When an activity carrying this workout's Garmin id first showed up — i.e. the
   * watch demonstrably had it and the athlete ran it. `status` only ever meant
   * "the push landed on the Garmin account"; this is the device answering. Null
   * for a workout that hasn't been run, and for every delivery made before
   * migration 092.
   */
  device_confirmed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  try {
    // Coach-only tool: this returns every plan's `original_input` (the coach's
    // raw prompt) plus per-athlete delivery rows with garmin workout ids and
    // error messages. Athletes read their plan through /api/plans/week instead.
    const denied = await requireStaff(req);
    if (denied) return denied;

    const supabase = createServerClient();
    const { searchParams } = new URL(req.url);
    const planId = searchParams.get('planId');

    // If planId is provided, return detailed info for that plan
    if (planId) {
      const { data: plan, error: planError } = await supabase
        .from('weekly_plans')
        .select('*')
        .eq('id', planId)
        .eq('coach_id', COACH_ID)
        .single();

      if (planError || !plan) {
        return NextResponse.json(
          { error: 'Plan not found' },
          { status: 404 }
        );
      }

      // Fetch delivery details with athlete names
      const deliveryColumns = `
          id,
          athlete_id,
          workout_date,
          status,
          garmin_workout_id,
          error_message,
          created_at,
          athletes (
            name
          )
        `;
      const fetchDeliveries = (columns: string) =>
        supabase
          .from('workout_deliveries')
          .select(columns)
          .eq('plan_id', planId)
          .order('workout_date', { ascending: true })
          .order('created_at', { ascending: true });

      let { data: deliveries, error: deliveriesError } = await fetchDeliveries(
        `${deliveryColumns}, device_confirmed_at`,
      );
      // Selecting a column the database doesn't have fails the WHOLE select, so
      // an unapplied migration 092 would take this coach-facing table down with
      // it. Retry without the confirmation stamp instead.
      if (isMissingColumn(deliveriesError, 'device_confirmed_at')) {
        ({ data: deliveries, error: deliveriesError } = await fetchDeliveries(deliveryColumns));
      }

      if (deliveriesError) {
        return NextResponse.json(
          { error: 'Failed to fetch deliveries' },
          { status: 500 }
        );
      }

      const formattedDeliveries: DeliveryDetail[] = (deliveries || []).map((d: any) => ({
        id: d.id,
        athlete_id: d.athlete_id,
        athlete_name: d.athletes?.name || 'Unknown',
        workout_date: d.workout_date,
        status: d.status,
        garmin_workout_id: d.garmin_workout_id,
        device_confirmed_at: d.device_confirmed_at ?? null,
        error_message: d.error_message,
        created_at: d.created_at,
      }));

      return NextResponse.json({
        plan,
        deliveries: formattedDeliveries,
      });
    }

    // Otherwise, return all plans with summary stats.
    //
    // Not `select('*')`: `original_input` is the coach's raw pasted prompt and
    // is no longer in the response at all, so fetching it from Postgres too was
    // pure waste. `parsed_workouts` IS still selected — `workout_count` below is
    // derived from it — but it stays server-side.
    const { data: plans, error: plansError } = await supabase
      .from('weekly_plans')
      .select('id, week_start_date, status, created_at, parsed_workouts')
      .eq('coach_id', COACH_ID)
      .order('week_start_date', { ascending: false });

    if (plansError) {
      return NextResponse.json(
        { error: 'Failed to fetch plans' },
        { status: 500 }
      );
    }

    if (!plans || plans.length === 0) {
      return NextResponse.json({ plans: [] });
    }

    // Fetch delivery stats for all plans
    const planIds = plans.map((p) => p.id);
    const { data: deliveries, error: deliveriesError } = await supabase
      .from('workout_deliveries')
      .select('plan_id, status')
      .in('plan_id', planIds);

    if (deliveriesError) {
      return NextResponse.json(
        { error: 'Failed to fetch delivery stats' },
        { status: 500 }
      );
    }

    // Group deliveries by plan_id and calculate stats
    const statsByPlan = new Map<string, DeliveryStats>();

    for (const delivery of deliveries || []) {
      const planId = delivery.plan_id;
      if (!statsByPlan.has(planId)) {
        statsByPlan.set(planId, {
          total: 0,
          success: 0,
          failed: 0,
          pending: 0,
        });
      }
      const stats = statsByPlan.get(planId)!;
      stats.total++;
      if (delivery.status === 'success') stats.success++;
      else if (delivery.status === 'failed') stats.failed++;
      else if (delivery.status === 'pending') stats.pending++;
    }

    // Combine plans with stats
    const plansWithStats: PlanSummary[] = plans.map((plan) => {
      const stats = statsByPlan.get(plan.id) || {
        total: 0,
        success: 0,
        failed: 0,
        pending: 0,
      };

      // Count training days in the plan. Current plans are grouped by pace
      // group ({group1: {workouts: [...]}, ...}) — group1 is representative
      // since all 3 groups train the same days. Object.keys(parsedWorkouts)
      // on a grouped plan would just count to 3 (group1/2/3), not the real
      // number of training days, so detect the shape first.
      const parsedWorkouts: any = plan.parsed_workouts || {};
      const group1Workouts = parsedWorkouts?.group1?.workouts;
      const workoutCount = Array.isArray(group1Workouts)
        ? new Set(group1Workouts.map((w: any) => w.dayOfWeek)).size
        : Object.keys(parsedWorkouts).filter(
            (key) => parsedWorkouts[key] && typeof parsedWorkouts[key] === 'object'
          ).length;

      return {
        id: plan.id,
        week_start_date: plan.week_start_date,
        status: plan.status as 'draft' | 'pushed' | 'partial',
        created_at: plan.created_at,
        delivery_stats: stats,
        workout_count: workoutCount,
      };
    });

    return NextResponse.json({ plans: plansWithStats });
  } catch (error: any) {
    console.error('History API error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch history' },
      { status: 500 }
    );
  }
}
