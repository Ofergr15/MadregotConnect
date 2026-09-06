'use client';

import { useState } from 'react';
import { Calendar, CheckCircle2, XCircle, Clock, AlertCircle, ChevronDown, ChevronUp, RefreshCw, Watch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';
import { useLocale, useTranslations } from 'next-intl';

interface DeliveryDetail {
  id: string;
  athlete_id: string;
  athlete_name: string;
  workout_date: string;
  status: 'pending' | 'success' | 'failed';
  garmin_workout_id: string | null;
  /**
   * The device's own answer: set once an activity carrying this workout's Garmin
   * id synced back, which is the only thing that proves the watch really had it.
   * `status` above is about the push reaching Garmin's servers. Null while the
   * workout is still ahead of the athlete — and for anything pushed before
   * migration 092, which is why its absence is silent rather than a warning.
   */
  device_confirmed_at?: string | null;
  error_message: string | null;
  created_at: string;
}

interface PlanDetailProps {
  planId: string;
  weekStartDate: string;
  /**
   * Hands the plan's workout JSON back along with the athletes to retry. The
   * caller used to read it off its own list row, but the list no longer carries
   * it — and this component can only reach a repush from an expanded state where
   * the detail fetch has already resolved, so it is the one place that reliably
   * has it without asking the server twice.
   */
  onRepush?: (athleteIds: string[], parsedWorkouts: Record<string, any>) => void;
}

const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Current plans are grouped by pace group ({group1: {workouts: [...]}, ...}),
// not the old flat day-keyed shape ({monday: {...}, ...}). Group 1 is used as
// the representative summary here — same simplification the planner's own
// retryFailed already makes for repushes, not a new one introduced here.
function workoutsByDay(parsedWorkouts: Record<string, any>): Record<string, any> {
  const group1 = parsedWorkouts?.group1;
  if (group1 && Array.isArray(group1.workouts)) {
    const byDay: Record<string, any> = {};
    for (const w of group1.workouts) {
      if (typeof w.dayOfWeek === 'number' && DAYS_OF_WEEK[w.dayOfWeek]) {
        byDay[DAYS_OF_WEEK[w.dayOfWeek]] = w;
      }
    }
    return byDay;
  }
  return parsedWorkouts || {}; // legacy flat day-keyed plans
}

// `labelKey` rather than `label`: this table is a coach's view of whether the
// week reached each athlete's watch, and it was rendering its three outcomes as
// English words ("Pending"/"Success"/"Failed") in the middle of a Hebrew screen.
// The config is module-level so it cannot hold a hook — it holds the key and the
// component translates it.
const statusConfig = {
  pending: { icon: Clock, color: 'text-band-3-ink', bg: 'bg-band-3/10', labelKey: 'statusPending' },
  success: { icon: CheckCircle2, color: 'text-accent-900', bg: 'bg-accent-600/10', labelKey: 'statusSuccess' },
  failed: { icon: XCircle, color: 'text-accent-red-ink', bg: 'bg-accent-red/10', labelKey: 'statusFailed' },
} as const;

export function PlanDetail({ planId, weekStartDate, onRepush }: PlanDetailProps) {
  const t = useTranslations('planDetail');
  const locale = useLocale();
  const [deliveries, setDeliveries] = useState<DeliveryDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [selectedFailedAthletes, setSelectedFailedAthletes] = useState<Set<string>>(new Set());
  // `original_input` and `parsed_workouts` used to arrive as props, which meant
  // /api/plans/history had to put EVERY plan's raw coach prompt and full workout
  // JSON in the list response — 439 KB on a page that shows a handful of
  // one-line summaries, of which at most one card is ever open. They come off
  // the detail fetch below instead. That fetch already existed, already selects
  // `*`, and already fires at exactly the moment this content becomes visible,
  // so nothing new is requested and nothing renders later than it used to.
  const [originalInput, setOriginalInput] = useState('');
  const [parsedWorkouts, setParsedWorkouts] = useState<Record<string, any>>({});
  const [loaded, setLoaded] = useState(false);

  // Fetch the plan body and its delivery details when expanded.
  const loadDeliveries = async () => {
    // Not `deliveries.length > 0`: a plan with no deliveries yet would retry on
    // every toggle, and now that the plan body rides along on this response,
    // a re-fetch would also re-render content that is already on screen.
    if (loaded) return;

    try {
      const response = await fetch(`/api/plans/history?planId=${planId}`, {
        headers: await apiHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch deliveries');

      const data = await response.json();
      setDeliveries(data.deliveries || []);
      setOriginalInput(data.plan?.original_input || '');
      setParsedWorkouts(data.plan?.parsed_workouts || {});
      setLoaded(true);
    } catch (error) {
      console.error('Error fetching deliveries:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    if (!expanded) {
      loadDeliveries();
    }
    setExpanded(!expanded);
  };

  const handleSelectFailed = (athleteId: string) => {
    const newSelection = new Set(selectedFailedAthletes);
    if (newSelection.has(athleteId)) {
      newSelection.delete(athleteId);
    } else {
      newSelection.add(athleteId);
    }
    setSelectedFailedAthletes(newSelection);
  };

  const handleRepush = () => {
    if (onRepush && selectedFailedAthletes.size > 0) {
      onRepush(Array.from(selectedFailedAthletes), parsedWorkouts);
      setSelectedFailedAthletes(new Set());
    }
  };

  const failedDeliveries = deliveries.filter((d) => d.status === 'failed');
  const hasFailures = failedDeliveries.length > 0;

  // Format workout summary for each day
  const byDay = workoutsByDay(parsedWorkouts);
  const workoutSummary = DAYS_OF_WEEK.map((day) => {
    const workout = byDay[day];
    if (!workout || typeof workout !== 'object') {
      return { day, isEmpty: true };
    }

    return {
      day: day.charAt(0).toUpperCase() + day.slice(1),
      isEmpty: false,
      summary: (workout.name || workout.description || t('workoutFallback')).toString().substring(0, 30),
    };
  });

  // Group deliveries by athlete
  const deliveriesByAthlete = deliveries.reduce((acc, delivery) => {
    if (!acc[delivery.athlete_id]) {
      acc[delivery.athlete_id] = {
        athlete_name: delivery.athlete_name,
        deliveries: [],
      };
    }
    acc[delivery.athlete_id].deliveries.push(delivery);
    return acc;
  }, {} as Record<string, { athlete_name: string; deliveries: DeliveryDetail[] }>);

  return (
    <div className="border-t border-page mt-4 pt-4">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between text-start hover:text-brand-700 transition-colors"
      >
        <span className="text-sm font-medium">{t('viewDetails')}</span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-6">
          {/* Original Input */}
          <div>
            <h3 className="text-sm font-medium text-ink-500 mb-2">{t('originalInput')}</h3>
            <div className="bg-card rounded-lg p-4 text-sm text-ink-500 whitespace-pre-wrap font-mono">
              {originalInput || t('noInput')}
            </div>
          </div>

          {/* Workout Summary - 7 Day Cards */}
          <div>
            <h3 className="text-sm font-medium text-ink-500 mb-2">{t('workoutSummary')}</h3>
            <div className="grid grid-cols-7 gap-2">
              {workoutSummary.map((item, index) => (
                <div
                  key={index}
                  className={cn(
                    'rounded-lg p-3 text-center',
                    item.isEmpty ? 'bg-card/50 text-ink-400' : 'bg-card text-ink-500'
                  )}
                >
                  <div className="text-xs font-medium mb-1">{item.day.slice(0, 3)}</div>
                  <div className="text-xs">{item.isEmpty ? '-' : item.summary}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Delivery Status */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-ink-500">{t('deliveryStatus')}</h3>
              {hasFailures && (
                <button
                  onClick={handleRepush}
                  disabled={selectedFailedAthletes.size === 0}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium transition-colors',
                    selectedFailedAthletes.size > 0
                      ? 'bg-brand-600 hover:bg-brand-700 text-white'
                      : 'bg-page text-ink-400 cursor-not-allowed'
                  )}
                >
                  <RefreshCw className="h-3 w-3" />
                  {t('repushSelected', { count: selectedFailedAthletes.size })}
                </button>
              )}
            </div>

            {loading ? (
              <div className="bg-card rounded-lg p-8 text-center">
                <Clock className="h-8 w-8 text-ink-400 mx-auto mb-2 animate-pulse" />
                <p className="text-sm text-ink-400">{t('loadingDeliveries')}</p>
              </div>
            ) : deliveries.length === 0 ? (
              <div className="bg-card rounded-lg p-8 text-center">
                <AlertCircle className="h-8 w-8 text-ink-400 mx-auto mb-2" />
                <p className="text-sm text-ink-400">{t('noDeliveries')}</p>
              </div>
            ) : (
              <div className="bg-card rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-page/50">
                    <tr>
                      {hasFailures && <th className="px-4 py-2 text-start text-xs font-medium text-ink-400">{t('colSelect')}</th>}
                      <th className="px-4 py-2 text-start text-xs font-medium text-ink-400">{t('colAthlete')}</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-ink-400">{t('colDate')}</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-ink-400">{t('colStatus')}</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-ink-400">{t('colGarminId')}</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-ink-400">{t('colError')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-page">
                    {Object.entries(deliveriesByAthlete).map(([athleteId, { athlete_name, deliveries: athleteDeliveries }]) => (
                      athleteDeliveries.map((delivery, index) => {
                        const config = statusConfig[delivery.status];
                        const StatusIcon = config.icon;
                        const isFailed = delivery.status === 'failed';

                        return (
                          <tr key={delivery.id} className="hover:bg-page/30">
                            {hasFailures && (
                              <td className="px-4 py-3">
                                {isFailed && (
                                  <input
                                    type="checkbox"
                                    checked={selectedFailedAthletes.has(delivery.athlete_id)}
                                    onChange={() => handleSelectFailed(delivery.athlete_id)}
                                    className="rounded border-ink-300 bg-page text-brand-600 focus:ring-brand-600 focus:ring-offset-card"
                                  />
                                )}
                              </td>
                            )}
                            <td className="px-4 py-3 text-sm">{athlete_name}</td>
                            <td className="px-4 py-3 text-sm text-ink-400">
                              {new Date(delivery.workout_date).toLocaleDateString(locale, {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </td>
                            <td className="px-4 py-3">
                              <div className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs', config.bg, config.color)}>
                                <StatusIcon className="h-3 w-3" />
                                {t(config.labelKey)}
                              </div>
                              {/* The question a coach actually has after a push —
                                  did it get to the watch — and the only evidence
                                  that answers it: an activity came back carrying
                                  this workout's Garmin id. */}
                              {delivery.device_confirmed_at && (
                                <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent-600/10 px-2 py-1 text-[10px] text-accent-900">
                                  <Watch className="h-3 w-3" />
                                  {t('ranOnWatchOn', {
                                    date: new Date(delivery.device_confirmed_at).toLocaleDateString(locale, {
                                      month: 'short',
                                      day: 'numeric',
                                    }),
                                  })}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-ink-400 font-mono">
                              {delivery.garmin_workout_id || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-accent-red">
                              {delivery.error_message || '-'}
                            </td>
                          </tr>
                        );
                      })
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
