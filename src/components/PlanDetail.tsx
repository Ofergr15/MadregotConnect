'use client';

import { useState } from 'react';
import { Calendar, CheckCircle2, XCircle, Clock, AlertCircle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface PlanDetailProps {
  planId: string;
  originalInput: string;
  parsedWorkouts: Record<string, any>;
  weekStartDate: string;
  onRepush?: (athleteIds: string[]) => void;
}

const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const statusConfig = {
  pending: { icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Pending' },
  success: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-400/10', label: 'Success' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10', label: 'Failed' },
};

export function PlanDetail({ planId, originalInput, parsedWorkouts, weekStartDate, onRepush }: PlanDetailProps) {
  const [deliveries, setDeliveries] = useState<DeliveryDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [selectedFailedAthletes, setSelectedFailedAthletes] = useState<Set<string>>(new Set());

  // Fetch delivery details when expanded
  const loadDeliveries = async () => {
    if (deliveries.length > 0) return; // Already loaded

    try {
      const response = await fetch(`/api/plans/history?planId=${planId}`);
      if (!response.ok) throw new Error('Failed to fetch deliveries');

      const data = await response.json();
      setDeliveries(data.deliveries || []);
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
      onRepush(Array.from(selectedFailedAthletes));
      setSelectedFailedAthletes(new Set());
    }
  };

  const failedDeliveries = deliveries.filter((d) => d.status === 'failed');
  const hasFailures = failedDeliveries.length > 0;

  // Format workout summary for each day
  const workoutSummary = DAYS_OF_WEEK.map((day, index) => {
    const workout = parsedWorkouts[day];
    if (!workout || typeof workout !== 'object') {
      return { day, isEmpty: true };
    }

    const workoutObj = workout as any;
    let summary = '';

    if (workoutObj.type === 'rest' || workoutObj.description?.toLowerCase().includes('rest')) {
      summary = 'Rest';
    } else if (workoutObj.type === 'easy_run' || workoutObj.type === 'easy') {
      const duration = workoutObj.duration || workoutObj.distance;
      summary = duration ? `Easy ${duration}` : 'Easy Run';
    } else if (workoutObj.type === 'long_run') {
      const duration = workoutObj.duration || workoutObj.distance;
      summary = duration ? `Long ${duration}` : 'Long Run';
    } else if (workoutObj.type === 'intervals' || workoutObj.type === 'workout') {
      summary = 'Intervals';
    } else if (workoutObj.type === 'tempo') {
      summary = 'Tempo';
    } else if (workoutObj.description) {
      summary = workoutObj.description.substring(0, 30);
    } else {
      summary = 'Workout';
    }

    return {
      day: day.charAt(0).toUpperCase() + day.slice(1),
      isEmpty: false,
      summary,
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
    <div className="border-t border-slate-700 mt-4 pt-4">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between text-start hover:text-primary-400 transition-colors"
      >
        <span className="text-sm font-medium">View Details</span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-6">
          {/* Original Input */}
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-2">Original Input</h3>
            <div className="bg-slate-800 rounded-lg p-4 text-sm text-slate-300 whitespace-pre-wrap font-mono">
              {originalInput || 'No input recorded'}
            </div>
          </div>

          {/* Workout Summary - 7 Day Cards */}
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-2">Workout Summary</h3>
            <div className="grid grid-cols-7 gap-2">
              {workoutSummary.map((item, index) => (
                <div
                  key={index}
                  className={cn(
                    'rounded-lg p-3 text-center',
                    item.isEmpty ? 'bg-slate-800/50 text-slate-600' : 'bg-slate-800 text-slate-300'
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
              <h3 className="text-sm font-medium text-slate-300">Delivery Status</h3>
              {hasFailures && (
                <button
                  onClick={handleRepush}
                  disabled={selectedFailedAthletes.size === 0}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium transition-colors',
                    selectedFailedAthletes.size > 0
                      ? 'bg-primary-600 hover:bg-primary-700 text-white'
                      : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  )}
                >
                  <RefreshCw className="h-3 w-3" />
                  Re-push Selected ({selectedFailedAthletes.size})
                </button>
              )}
            </div>

            {loading ? (
              <div className="bg-slate-800 rounded-lg p-8 text-center">
                <Clock className="h-8 w-8 text-slate-600 mx-auto mb-2 animate-pulse" />
                <p className="text-sm text-slate-400">Loading delivery details...</p>
              </div>
            ) : deliveries.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-8 text-center">
                <AlertCircle className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No deliveries recorded for this plan</p>
              </div>
            ) : (
              <div className="bg-slate-800 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-700/50">
                    <tr>
                      {hasFailures && <th className="px-4 py-2 text-start text-xs font-medium text-slate-400">Select</th>}
                      <th className="px-4 py-2 text-start text-xs font-medium text-slate-400">Athlete</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-slate-400">Date</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-slate-400">Status</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-slate-400">Garmin ID</th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-slate-400">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {Object.entries(deliveriesByAthlete).map(([athleteId, { athlete_name, deliveries: athleteDeliveries }]) => (
                      athleteDeliveries.map((delivery, index) => {
                        const config = statusConfig[delivery.status];
                        const StatusIcon = config.icon;
                        const isFailed = delivery.status === 'failed';

                        return (
                          <tr key={delivery.id} className="hover:bg-slate-700/30">
                            {hasFailures && (
                              <td className="px-4 py-3">
                                {isFailed && (
                                  <input
                                    type="checkbox"
                                    checked={selectedFailedAthletes.has(delivery.athlete_id)}
                                    onChange={() => handleSelectFailed(delivery.athlete_id)}
                                    className="rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500 focus:ring-offset-slate-900"
                                  />
                                )}
                              </td>
                            )}
                            <td className="px-4 py-3 text-sm">{athlete_name}</td>
                            <td className="px-4 py-3 text-sm text-slate-400">
                              {new Date(delivery.workout_date).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </td>
                            <td className="px-4 py-3">
                              <div className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs', config.bg, config.color)}>
                                <StatusIcon className="h-3 w-3" />
                                {config.label}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-400 font-mono">
                              {delivery.garmin_workout_id || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-red-400">
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
