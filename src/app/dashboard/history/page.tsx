'use client';

import { useState, useEffect } from 'react';
import { Calendar, CheckCircle2, AlertCircle, Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlanDetail } from '@/components/PlanDetail';

interface PlanHistory {
  id: string;
  week_start_date: string;
  original_input: string;
  parsed_workouts: Record<string, any>;
  status: 'draft' | 'pushed' | 'partial';
  created_at: string;
  delivery_stats: {
    total: number;
    success: number;
    failed: number;
    pending: number;
  };
  workout_count: number;
}

const statusConfig = {
  draft: { icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Draft' },
  pushed: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-400/10', label: 'Pushed' },
  partial: { icon: AlertCircle, color: 'text-orange-400', bg: 'bg-orange-400/10', label: 'Partial' },
};

export default function HistoryPage() {
  const [plans, setPlans] = useState<PlanHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/plans/history');

      if (!response.ok) {
        throw new Error('Failed to fetch plans');
      }

      const data = await response.json();
      setPlans(data.plans || []);
    } catch (err: any) {
      console.error('Error loading plans:', err);
      setError(err.message || 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePlan = (planId: string) => {
    setExpandedPlanId(expandedPlanId === planId ? null : planId);
  };

  const handleRepush = async (planId: string, athleteIds: string[]) => {
    try {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) return;

      // Extract workouts from parsed_workouts
      const workouts = Object.entries(plan.parsed_workouts)
        .filter(([_, workout]) => workout && typeof workout === 'object')
        .map(([day, workout], index) => ({
          ...workout,
          dayOfWeek: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(day.toLowerCase()),
        }))
        .filter((w) => w.dayOfWeek >= 0);

      const response = await fetch('/api/garmin/push-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          workouts,
          athleteIds,
          weekStartDate: plan.week_start_date,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to re-push workouts');
      }

      // Reload plans to refresh delivery status
      await loadPlans();
    } catch (err: any) {
      console.error('Error re-pushing workouts:', err);
      alert(`Failed to re-push: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Plan History</h1>
          <p className="text-slate-400 mt-1">View past weekly training plans and delivery status</p>
        </div>
        <div className="card text-center py-12">
          <RefreshCw className="h-12 w-12 text-slate-600 mx-auto mb-3 animate-spin" />
          <p className="text-slate-400">Loading plans...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Plan History</h1>
          <p className="text-slate-400 mt-1">View past weekly training plans and delivery status</p>
        </div>
        <div className="card text-center py-12">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 mb-2">Error loading plans</p>
          <p className="text-slate-400 text-sm mb-4">{error}</p>
          <button
            onClick={loadPlans}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg text-sm font-medium transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Plan History</h1>
        <p className="text-slate-400 mt-1">View past weekly training plans and delivery status</p>
      </div>

      {plans.length > 0 ? (
        <div className="space-y-3">
          {plans.map((plan) => {
            const config = statusConfig[plan.status];
            const StatusIcon = config.icon;
            const isExpanded = expandedPlanId === plan.id;

            return (
              <div key={plan.id} className="card hover:border-slate-600 transition-colors">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => handleTogglePlan(plan.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-slate-700 p-2 rounded-lg">
                      <Calendar className="h-5 w-5 text-primary-400" />
                    </div>
                    <div>
                      <p className="font-medium">
                        Week of {new Date(plan.week_start_date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </p>
                      <p className="text-sm text-slate-400">
                        {plan.workout_count} workouts · {plan.delivery_stats.total > 0
                          ? `${plan.delivery_stats.total} deliveries`
                          : 'Not delivered'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {plan.delivery_stats.total > 0 && (
                      <span className="text-sm text-slate-400">
                        {plan.delivery_stats.success}/{plan.delivery_stats.total} delivered
                        {plan.delivery_stats.failed > 0 && (
                          <span className="text-red-400"> · {plan.delivery_stats.failed} failed</span>
                        )}
                      </span>
                    )}
                    <div className={cn('flex items-center gap-1 px-2 py-1 rounded-full text-xs', config.bg, config.color)}>
                      <StatusIcon className="h-3 w-3" />
                      {config.label}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <PlanDetail
                    planId={plan.id}
                    originalInput={plan.original_input}
                    parsedWorkouts={plan.parsed_workouts}
                    weekStartDate={plan.week_start_date}
                    onRepush={(athleteIds) => handleRepush(plan.id, athleteIds)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card text-center py-12">
          <Clock className="h-12 w-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">
            No plans in history yet. Your pushed plans will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
