import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const COACH_ID = 'a34a0d10-1a1c-4b80-a1ca-e0044aa06232';

interface DeliveryStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
}

interface PlanSummary {
  id: string;
  week_start_date: string;
  original_input: string;
  parsed_workouts: Record<string, unknown>;
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
  error_message: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  try {
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
      const { data: deliveries, error: deliveriesError } = await supabase
        .from('workout_deliveries')
        .select(`
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
        `)
        .eq('plan_id', planId)
        .order('workout_date', { ascending: true })
        .order('created_at', { ascending: true });

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
        error_message: d.error_message,
        created_at: d.created_at,
      }));

      return NextResponse.json({
        plan,
        deliveries: formattedDeliveries,
      });
    }

    // Otherwise, return all plans with summary stats
    const { data: plans, error: plansError } = await supabase
      .from('weekly_plans')
      .select('*')
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

      // Count unique workouts in parsed_workouts
      const parsedWorkouts = plan.parsed_workouts || {};
      const workoutCount = Object.keys(parsedWorkouts).filter(
        (key) => parsedWorkouts[key] && typeof parsedWorkouts[key] === 'object'
      ).length;

      return {
        id: plan.id,
        week_start_date: plan.week_start_date,
        original_input: plan.original_input || '',
        parsed_workouts: plan.parsed_workouts,
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
