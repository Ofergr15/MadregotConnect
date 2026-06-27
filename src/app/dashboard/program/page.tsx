'use client';

import { useState } from 'react';
import { Calendar, Dumbbell, Utensils, FileText, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WeekProgram {
  weekLabel: string;
  training: string;
  nutrition: string;
}

const WEEKS: WeekProgram[] = [
  {
    weekLabel: '28.06 - 04.07.2026',
    training: '/plans/training-program/week-28-06-04-07-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-28-06-04-07-2026.pdf',
  },
  {
    weekLabel: '21.06 - 27.06.2026',
    training: '/plans/training-program/week-21-27-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-21-27-06-2026.pdf',
  },
  {
    weekLabel: '14.06 - 20.06.2026',
    training: '/plans/training-program/week-14-20-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-14-20-06-2026.pdf',
  },
  {
    weekLabel: '07.06 - 13.06.2026',
    training: '/plans/training-program/week-07-13-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-07-13-06-2026.pdf',
  },
  {
    weekLabel: '31.05 - 06.06.2026',
    training: '/plans/training-program/week-31-05-06-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-31-05-06-06-2026.pdf',
  },
];

export default function ProgramPage() {
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [activeView, setActiveView] = useState<'training' | 'nutrition'>('training');

  const currentWeek = WEEKS[selectedWeek];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Weekly Program</h1>
          <p className="text-slate-400 mt-1">
            Training & Nutrition plans for Madregot After 2KM
          </p>
        </div>
      </div>

      {/* Week Selector */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedWeek(Math.min(selectedWeek + 1, WEEKS.length - 1))}
            disabled={selectedWeek >= WEEKS.length - 1}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="bg-primary-500/20 p-2 rounded-lg">
              <Calendar className="h-5 w-5 text-primary-400" />
            </div>
            <div className="text-center">
              <h2 className="font-semibold text-lg">Week {currentWeek.weekLabel}</h2>
              <p className="text-xs text-slate-400">
                {selectedWeek === 0 ? 'Current week' : `${selectedWeek} week${selectedWeek > 1 ? 's' : ''} ago`}
              </p>
            </div>
          </div>

          <button
            onClick={() => setSelectedWeek(Math.max(selectedWeek - 1, 0))}
            disabled={selectedWeek <= 0}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Week dots */}
        <div className="flex justify-center gap-2 mt-3">
          {WEEKS.map((_, i) => (
            <button
              key={i}
              onClick={() => setSelectedWeek(i)}
              className={cn(
                'w-2.5 h-2.5 rounded-full transition-all',
                i === selectedWeek ? 'bg-primary-500 scale-125' : 'bg-slate-600 hover:bg-slate-500'
              )}
            />
          ))}
        </div>
      </div>

      {/* Toggle Training / Nutrition */}
      <div className="flex gap-2 bg-slate-800 rounded-lg p-1 border border-slate-700 w-fit">
        <button
          onClick={() => setActiveView('training')}
          className={cn(
            'px-5 py-2.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
            activeView === 'training'
              ? 'bg-primary-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-700'
          )}
        >
          <Dumbbell className="h-4 w-4" />
          Training Plan
        </button>
        <button
          onClick={() => setActiveView('nutrition')}
          className={cn(
            'px-5 py-2.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
            activeView === 'nutrition'
              ? 'bg-green-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-700'
          )}
        >
          <Utensils className="h-4 w-4" />
          Nutrition Plan
        </button>
      </div>

      {/* PDF Viewer */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-medium">
              {activeView === 'training' ? 'Training Program' : 'Nutrition Program'} — {currentWeek.weekLabel}
            </span>
          </div>
          <a
            href={activeView === 'training' ? currentWeek.training : currentWeek.nutrition}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in new tab
          </a>
        </div>

        <div className="w-full" style={{ height: '80vh' }}>
          <iframe
            src={activeView === 'training' ? currentWeek.training : currentWeek.nutrition}
            className="w-full h-full border-0"
            title={`${activeView} plan for week ${currentWeek.weekLabel}`}
          />
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-r from-primary-500/10 to-purple-500/10 border border-primary-500/30 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Dumbbell className="h-5 w-5 text-primary-400" />
            <h3 className="font-semibold text-primary-400">Training Plans</h3>
          </div>
          <p className="text-sm text-slate-300">
            3-group pace tables (SUB 2:30 / SUB 2:35 / SUB 2:45) with day-by-day breakdown including warmup, intervals, tempo, and recovery.
          </p>
        </div>
        <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Utensils className="h-5 w-5 text-green-400" />
            <h3 className="font-semibold text-green-400">Nutrition Plans</h3>
          </div>
          <p className="text-sm text-slate-300">
            By Roni Fishman, R.D — Day-specific fueling strategies with gel, gummy, and hydration timing for each workout type.
          </p>
        </div>
      </div>
    </div>
  );
}
