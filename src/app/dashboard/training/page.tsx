'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Calendar, Dumbbell } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrainingPlan {
  id: string;
  week_label: string;
  content: string;
  created_at: string;
}

interface DayPlan {
  dayName: string;
  content: string;
  notes: string[];
}

const DAY_COLORS = [
  'border-primary-500',
  'border-green-500',
  'border-yellow-500',
  'border-purple-500',
  'border-pink-500',
  'border-orange-500',
  'border-cyan-500',
];

function parseTrainingPlan(content: string): DayPlan[] {
  const lines = content.split('\n');
  const days: DayPlan[] = [];
  let currentDay: DayPlan | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if this is a day header (e.g., "יום ראשון -", "יום שני -", etc.)
    if (
      trimmed.startsWith('יום ראשון') ||
      trimmed.startsWith('יום שני') ||
      trimmed.startsWith('יום שלישי') ||
      trimmed.startsWith('יום רביעי') ||
      trimmed.startsWith('יום חמישי') ||
      trimmed.startsWith('יום שישי') ||
      trimmed.startsWith('שבת')
    ) {
      // Save previous day
      if (currentDay) {
        days.push(currentDay);
      }
      // Start new day
      currentDay = {
        dayName: trimmed.replace(' -', '').replace('-', '').trim(),
        content: '',
        notes: [],
      };
    } else if (currentDay) {
      // Check if this is a note (starts with • or *)
      if (trimmed.startsWith('•') || trimmed.startsWith('*')) {
        currentDay.notes.push(trimmed.substring(1).trim());
      } else {
        // Regular content
        currentDay.content += (currentDay.content ? '\n' : '') + trimmed;
      }
    }
  }

  // Save last day
  if (currentDay) {
    days.push(currentDay);
  }

  return days;
}

function DayCard({ day, index }: { day: DayPlan; index: number }) {
  const colorClass = DAY_COLORS[index % DAY_COLORS.length];

  return (
    <div
      className={cn(
        'bg-slate-800 rounded-xl p-5 border-l-4 transition-all hover:shadow-lg',
        colorClass
      )}
      dir="rtl"
    >
      <h3 className="font-semibold text-lg mb-3 text-right">{day.dayName}</h3>
      <div className="text-slate-300 text-sm whitespace-pre-wrap text-right leading-relaxed">
        {day.content}
      </div>
      {day.notes.length > 0 && (
        <div className="mt-4 space-y-2">
          {day.notes.map((note, idx) => (
            <div
              key={idx}
              className="bg-primary-500/10 border border-primary-500/30 rounded-lg p-3 text-sm text-blue-300 text-right"
            >
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormattedPlanView({
  plan,
  onDelete,
}: {
  plan: TrainingPlan;
  onDelete: (id: string) => void;
}) {
  const days = parseTrainingPlan(plan.content);

  return (
    <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary-500/20 p-2 rounded-lg">
            <Calendar className="h-5 w-5 text-primary-400" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">{plan.week_label}</h3>
            <p className="text-xs text-slate-500">
              {new Date(plan.created_at).toLocaleDateString('he-IL')}
            </p>
          </div>
        </div>
        <button
          onClick={() => onDelete(plan.id)}
          className="bg-red-600/20 hover:bg-red-600/30 text-red-400 px-3 py-2 rounded-lg font-medium transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {days.map((day, index) => (
          <DayCard key={index} day={day} index={index} />
        ))}
      </div>
    </div>
  );
}

export default function TrainingPage() {
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [weekLabel, setWeekLabel] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const response = await fetch('/api/plans/training');
      const data = await response.json();
      setPlans(data.plans || []);
    } catch (error) {
      console.error('Failed to fetch training plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const createPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!weekLabel.trim() || !content.trim()) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/plans/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          week_label: weekLabel,
          content: content,
        }),
      });

      if (response.ok) {
        setWeekLabel('');
        setContent('');
        setShowCreateForm(false);
        fetchPlans();
      } else {
        const data = await response.json();
        alert('Failed to create plan: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to create plan:', error);
      alert('Failed to create plan');
    } finally {
      setSubmitting(false);
    }
  };

  const deletePlan = async (id: string) => {
    if (!confirm('Are you sure you want to delete this training plan?')) {
      return;
    }

    try {
      const response = await fetch(`/api/plans/training?id=${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchPlans();
      } else {
        const data = await response.json();
        alert('Failed to delete plan: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to delete plan:', error);
      alert('Failed to delete plan');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Training Plans</h1>
          <p className="text-slate-400 mt-1">
            Weekly training plans for the team
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Training Plan
        </button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="font-semibold text-lg mb-4">New Training Plan</h3>
          <form onSubmit={createPlan} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Week Label (e.g., &quot;31.5 - 6.6.2026&quot;)
              </label>
              <input
                type="text"
                value={weekLabel}
                onChange={(e) => setWeekLabel(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="31.5 - 6.6.2026"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Training Plan Content (Hebrew)
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                rows={15}
                dir="rtl"
                placeholder="יום ראשון -&#10;ריצה קלה עד 80 דקות.&#10;&#10;יום שני -&#10;..."
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                Paste the training plan. Use day headers like &quot;יום ראשון -&quot;, &quot;יום שני -&quot;, etc.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors font-medium disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create Plan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Plans List */}
      {plans.length > 0 ? (
        <div className="space-y-6">
          {plans.map((plan) => (
            <FormattedPlanView key={plan.id} plan={plan} onDelete={deletePlan} />
          ))}
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700 text-center py-16">
          <div className="bg-slate-700/50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Dumbbell className="h-10 w-10 text-slate-500" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No training plans yet</h3>
          <p className="text-slate-400 mb-6">
            Create your first weekly training plan for the team
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-lg font-medium transition-colors inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Training Plan
          </button>
        </div>
      )}
    </div>
  );
}
