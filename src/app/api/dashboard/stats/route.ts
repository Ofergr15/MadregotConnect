import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServerClient();
    const DEMO_COACH_ID = COACH_ID;

    // Get athlete count (active athletes only)
    const { count: athleteCount } = await supabase
      .from('athletes')
      .select('*', { count: 'exact', head: true })
      .eq('coach_id', DEMO_COACH_ID)
      .eq('status', 'active');

    // Get total athlete count including invited
    const { count: totalAthletes } = await supabase
      .from('athletes')
      .select('*', { count: 'exact', head: true })
      .eq('coach_id', DEMO_COACH_ID);

    // Get group count
    const { count: groupCount } = await supabase
      .from('groups')
      .select('*', { count: 'exact', head: true })
      .eq('coach_id', DEMO_COACH_ID);

    // Get plan count (this month)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: planCount } = await supabase
      .from('weekly_plans')
      .select('*', { count: 'exact', head: true })
      .eq('coach_id', DEMO_COACH_ID)
      .gte('created_at', startOfMonth.toISOString());

    // Get delivery success rate
    const { data: athleteIds } = await supabase
      .from('athletes')
      .select('id')
      .eq('coach_id', DEMO_COACH_ID);

    let deliveries: any[] = [];
    if (athleteIds && athleteIds.length > 0) {
      const athleteIdList = athleteIds.map(a => a.id);
      const { data: deliveryData } = await supabase
        .from('workout_deliveries')
        .select('status')
        .in('athlete_id', athleteIdList);
      deliveries = deliveryData || [];
    }

    let deliverySuccessRate = 0;
    if (deliveries && deliveries.length > 0) {
      const successCount = deliveries.filter(d => d.status === 'success').length;
      deliverySuccessRate = Math.round((successCount / deliveries.length) * 100);
    }

    // Get recent plans (last 3)
    const { data: recentPlans } = await supabase
      .from('weekly_plans')
      .select('id, week_start_date, status, created_at')
      .eq('coach_id', DEMO_COACH_ID)
      .order('created_at', { ascending: false })
      .limit(3);

    // Get recent activity (last 5 events)
    const recentActivity: Array<{ type: string; description: string; timestamp: string }> = [];

    // Get recent athletes joined
    const { data: recentAthletes } = await supabase
      .from('athletes')
      .select('name, created_at, status')
      .eq('coach_id', DEMO_COACH_ID)
      .order('created_at', { ascending: false })
      .limit(2);

    if (recentAthletes) {
      recentAthletes.forEach(athlete => {
        recentActivity.push({
          type: athlete.status === 'invited' ? 'athlete_invited' : 'athlete_joined',
          description: athlete.status === 'invited'
            ? `${athlete.name} was invited`
            : `${athlete.name} connected their Garmin`,
          timestamp: athlete.created_at,
        });
      });
    }

    // Get recent plans pushed
    if (recentPlans) {
      recentPlans.forEach(plan => {
        if (plan.status === 'pushed') {
          recentActivity.push({
            type: 'plan_pushed',
            description: `Weekly plan pushed for ${new Date(plan.week_start_date).toLocaleDateString()}`,
            timestamp: plan.created_at,
          });
        }
      });
    }

    // Sort by timestamp and take last 5
    recentActivity.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const topActivity = recentActivity.slice(0, 5);

    return NextResponse.json({
      athleteCount: athleteCount || 0,
      totalAthletes: totalAthletes || 0,
      groupCount: groupCount || 0,
      planCount: planCount || 0,
      deliverySuccessRate,
      recentPlans: recentPlans || [],
      recentActivity: topActivity,
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard stats' },
      { status: 500 }
    );
  }
}
