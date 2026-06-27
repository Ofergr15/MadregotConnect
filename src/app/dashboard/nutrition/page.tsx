'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Calendar, Apple } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NutritionPlan {
  id: string;
  week_label: string;
  content: string;
  created_at: string;
}

interface DayPlan {
  dayName: string;
  options: string[];
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

function parseNutritionPlan(content: string): DayPlan[] {
  const lines = content.split('\n');
  const days: DayPlan[] = [];
  let currentDay: DayPlan | null = null;
  let currentOption: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if this is a day header (e.g., "יום ראשון-", "יום שני-", etc.)
    if (
      trimmed.startsWith('יום ראשון') ||
      trimmed.startsWith('יום שני') ||
      trimmed.startsWith('יום שלישי') ||
      trimmed.startsWith('יום רביעי') ||
      trimmed.startsWith('יום חמישי') ||
      trimmed.startsWith('יום שישי') ||
      trimmed.startsWith('יום שבת')
    ) {
      // Save previous day
      if (currentDay && currentOption) {
        currentDay.options.push(currentOption);
      }
      if (currentDay) {
        days.push(currentDay);
      }
      // Start new day
      currentDay = {
        dayName: trimmed.replace('-', '').trim(),
        options: [],
        notes: [],
      };
      currentOption = null;
    } else if (currentDay) {
      // Check if this is an option header (e.g., "אופציה 1-", "אופציה 2-")
      if (trimmed.startsWith('אופציה') || trimmed.startsWith('מתקדמים')) {
        // Save previous option
        if (currentOption) {
          currentDay.options.push(currentOption);
        }
        // Start new option
        currentOption = trimmed + '\n';
      } else if (trimmed.startsWith('*') && !trimmed.includes('ג\'ל') && !trimmed.includes('גומי')) {
        // This is a note
        currentDay.notes.push(trimmed.substring(1).trim());
      } else if (currentOption !== null) {
        // Add to current option
        currentOption += trimmed + '\n';
      }
    }
  }

  // Save last option and day
  if (currentDay && currentOption) {
    currentDay.options.push(currentOption);
  }
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
      <h3 className="font-semibold text-lg mb-4 text-right">{day.dayName}</h3>

      {/* Options */}
      <div className="space-y-3">
        {day.options.map((option, idx) => (
          <div
            key={idx}
            className="bg-slate-900/70 rounded-lg p-4 border border-slate-700"
          >
            <div className="text-slate-300 text-sm whitespace-pre-wrap text-right leading-relaxed">
              {option}
            </div>
          </div>
        ))}
      </div>

      {/* Notes */}
      {day.notes.length > 0 && (
        <div className="mt-4 space-y-2">
          {day.notes.map((note, idx) => (
            <div
              key={idx}
              className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm text-green-300 text-right"
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
  plan: NutritionPlan;
  onDelete: (id: string) => void;
}) {
  const days = parseNutritionPlan(plan.content);

  return (
    <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-green-500/20 p-2 rounded-lg">
            <Calendar className="h-5 w-5 text-green-400" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {days.map((day, index) => (
          <DayCard key={index} day={day} index={index} />
        ))}
      </div>

      {/* Nutritionist Credit */}
      <div className="bg-gradient-to-r from-green-500/10 to-primary-500/10 border border-green-500/30 rounded-lg p-4 text-center">
        <p className="text-sm text-green-300">
          Nutritionist: <span className="font-semibold">Roni Fishman, R.D</span>
        </p>
      </div>
    </div>
  );
}

export default function NutritionPage() {
  const [plans, setPlans] = useState<NutritionPlan[]>([]);
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
      const response = await fetch('/api/plans/nutrition');
      const data = await response.json();
      setPlans(data.plans || []);
    } catch (error) {
      console.error('Failed to fetch nutrition plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const createPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!weekLabel.trim() || !content.trim()) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/plans/nutrition', {
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
    if (!confirm('Are you sure you want to delete this nutrition plan?')) {
      return;
    }

    try {
      const response = await fetch(`/api/plans/nutrition?id=${id}`, {
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Nutrition Plans</h1>
          <p className="text-slate-400 mt-1">
            Weekly nutrition plans from Roni Fishman, R.D
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Nutrition Plan
        </button>
      </div>

      {/* Info Card */}
      <div className="bg-gradient-to-r from-green-500/10 to-primary-500/10 border border-green-500/30 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="bg-green-500/20 p-2 rounded-lg">
            <Apple className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <h3 className="font-semibold text-green-400 mb-1">
              Nutrition Guidance from Roni Fishman
            </h3>
            <p className="text-sm text-slate-300">
              Professional nutrition plans tailored for endurance training and marathon preparation
            </p>
          </div>
        </div>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="font-semibold text-lg mb-4">New Nutrition Plan</h3>
          <form onSubmit={createPlan} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Week Label (e.g., &quot;28.6 - 4.7&quot;)
              </label>
              <input
                type="text"
                value={weekLabel}
                onChange={(e) => setWeekLabel(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="28.6 - 4.7"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Nutrition Plan Content (Hebrew)
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 font-mono text-sm"
                rows={20}
                dir="rtl"
                placeholder="תכנית תזונה שבוע 28.6-4.7&#10;&#10;יום ראשון-&#10;אופציה 1- ...&#10;אופציה 2- ...&#10;&#10;יום שני-&#10;..."
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                Paste the nutrition plan. Use day headers like &quot;יום ראשון-&quot;, &quot;יום שני-&quot;, etc.
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
                className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors font-medium disabled:opacity-50"
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
            <Apple className="h-10 w-10 text-slate-500" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No nutrition plans yet</h3>
          <p className="text-slate-400 mb-6">
            Create your first weekly nutrition plan from Roni Fishman
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-medium transition-colors inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Nutrition Plan
          </button>
        </div>
      )}
    </div>
  );
}
