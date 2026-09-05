'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Calendar, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlanDetail } from '@/components/PlanDetail';
import { Card, Button, EmptyState, SkeletonList } from '@/components/ui';
import { bearerHeaders } from '@/lib/auth/bearer-headers';

// No `original_input` / `parsed_workouts`: the list response deliberately no
// longer carries them (see /api/plans/history). PlanDetail loads both from the
// `?planId=` branch when a card is actually opened.
interface PlanHistory {
  id: string;
  week_start_date: string;
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
  draft: { icon: Clock, color: 'text-band-3', bg: 'bg-band-3/10', labelKey: 'draft' as const },
  pushed: { icon: CheckCircle2, color: 'text-accent-600', bg: 'bg-accent-600/10', labelKey: 'pushed' as const },
  partial: { icon: AlertCircle, color: 'text-band-3', bg: 'bg-band-3/10', labelKey: 'partial' as const },
};

export default function HistoryPage() {
  const t = useTranslations('history');
  const locale = useLocale();
  const [plans, setPlans] = useState<PlanHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repushError, setRepushError] = useState<string | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/plans/history', { headers: await bearerHeaders(false) });

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

  // `parsedWorkouts` arrives from PlanDetail rather than from the list row: the
  // list response no longer carries the workout JSON, and a repush is only
  // reachable from an expanded card, which has already loaded it.
  const handleRepush = async (
    planId: string,
    athleteIds: string[],
    parsedWorkouts: Record<string, any>,
  ) => {
    setRepushError(null);
    try {
      // Extract workouts from parsed_workouts. Current plans are grouped by
      // pace group ({group1: {workouts: [...]}, ...}), each workout already
      // carrying its own dayOfWeek — group1 is used here, same simplification
      // executePush's own retryFailed already makes. Legacy flat day-keyed
      // plans (pre-grouping) are supported as a fallback.
      const group1 = (parsedWorkouts as any)?.group1;
      const workouts = Array.isArray(group1?.workouts)
        ? group1.workouts
        : Object.entries(parsedWorkouts || {})
            .filter(([_, workout]) => workout && typeof workout === 'object')
            .map(([day, workout]) => ({
              ...(workout as object),
              dayOfWeek: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(day.toLowerCase()),
            }))
            .filter((w: any) => w.dayOfWeek >= 0);

      const response = await fetch('/api/garmin/push-workouts', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({
          planId,
          workouts,
          athleteIds,
          // Still a list-row field — only the two heavy JSON/text columns moved
          // to the detail fetch.
          weekStartDate: plans.find((p) => p.id === planId)?.week_start_date,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to re-push workouts');
      }

      // Reload plans to refresh delivery status
      await loadPlans();
    } catch (err: any) {
      console.error('Error re-pushing workouts:', err);
      setRepushError(t('repushFailed', { error: err.message }));
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-ink-400 mt-1">{t('subtitle')}</p>
        </div>
        <SkeletonList count={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-ink-400 mt-1">{t('subtitle')}</p>
        </div>
        <EmptyState
          icon={AlertCircle}
          title={t('errorLoading')}
          description={error}
          action={<Button onClick={loadPlans}>{t('tryAgain')}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-ink-400 mt-1">{t('subtitle')}</p>
      </div>

      {repushError && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-4 text-accent-red text-sm">
          {repushError}
        </div>
      )}

      {plans.length > 0 ? (
        <div className="space-y-3">
          {plans.map((plan) => {
            const config = statusConfig[plan.status];
            const StatusIcon = config.icon;
            const isExpanded = expandedPlanId === plan.id;

            return (
              <Card key={plan.id} className="hover:border-ink-300 transition-colors">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => handleTogglePlan(plan.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-page p-2 rounded-lg">
                      <Calendar className="h-5 w-5 text-brand-600" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {t('weekOf')} {new Date(plan.week_start_date).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </p>
                      <p className="text-sm text-ink-400">
                        {plan.workout_count} {t('workouts')} · {plan.delivery_stats.total > 0
                          ? `${plan.delivery_stats.total} ${t('deliveries')}`
                          : t('notDelivered')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {plan.delivery_stats.total > 0 && (
                      <span className="text-sm text-ink-400">
                        {plan.delivery_stats.success}/{plan.delivery_stats.total} {t('delivered')}
                        {plan.delivery_stats.failed > 0 && (
                          <span className="text-accent-red"> · {plan.delivery_stats.failed} {t('failed')}</span>
                        )}
                      </span>
                    )}
                    <div className={cn('flex items-center gap-1 px-2 py-1 rounded-full text-xs', config.bg, config.color)}>
                      <StatusIcon className="h-3 w-3" />
                      {t(config.labelKey)}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <PlanDetail
                    planId={plan.id}
                    weekStartDate={plan.week_start_date}
                    onRepush={(athleteIds, parsedWorkouts) => handleRepush(plan.id, athleteIds, parsedWorkouts)}
                  />
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Clock} title={t('emptyState')} />
      )}
    </div>
  );
}
