'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dumbbell, Utensils, FileText, ExternalLink, ChevronDown, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WeekProgram {
  weekLabel: string;
  dateRange: string;
  training: string;
  nutrition: string;
}

const WEEKS: WeekProgram[] = [
  {
    weekLabel: 'Week 5',
    dateRange: '28.06 – 04.07',
    training: '/plans/training-program/week-28-06-04-07-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-28-06-04-07-2026.pdf',
  },
  {
    weekLabel: 'Week 4',
    dateRange: '21.06 – 27.06',
    training: '/plans/training-program/week-21-27-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-21-27-06-2026.pdf',
  },
  {
    weekLabel: 'Week 3',
    dateRange: '14.06 – 20.06',
    training: '/plans/training-program/week-14-20-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-14-20-06-2026.pdf',
  },
  {
    weekLabel: 'Week 2',
    dateRange: '07.06 – 13.06',
    training: '/plans/training-program/week-07-13-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-07-13-06-2026.pdf',
  },
  {
    weekLabel: 'Week 1',
    dateRange: '31.05 – 06.06',
    training: '/plans/training-program/week-31-05-06-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-31-05-06-06-2026.pdf',
  },
];

const WORKOUT_VIDEOS = [
  '4c4a6f41-9d8a-43b1-822a-8cb6290800fc',
  '4f960cb4-abe2-4468-966a-4e2942a2599f',
  '6c6ee794-3d71-44d0-93bb-7d1bd0a8b710',
  '8daaa47b-6854-486f-a264-db580d45fe3c',
  '53a2e96e-e299-412d-90bb-b5f68026020b',
  '395e172f-bee6-45e0-ae3e-4dd5dfa3192c',
  '8883bb41-1c28-4cde-94ea-15b01fe48bd9',
  '99734d04-30a6-4adc-84cc-88764bbca100',
  '998915c3-fcee-4b2b-ba97-0b7dacaa4200',
  'a7f7d040-c3f0-4a6a-89a0-b7849b2f8ceb',
  'a8e5e504-d4de-49c0-90a8-f7a095868bee',
  'add39bbf-5d69-40cc-b5df-1285ae4bfea8',
  'b72f0c85-84ac-48ad-831c-5c9e42693e13',
  'c2a40b6e-343f-432b-aa63-ed06b56874b2',
  '1tIoIaxDizlgRsNL0H5VK5HdJ2Cw4YBlc',
];

export default function ProgramPage() {
  const t = useTranslations('program');
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [activeView, setActiveView] = useState<'training' | 'nutrition' | 'workout'>('training');
  const [weekDropdownOpen, setWeekDropdownOpen] = useState(false);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState(0);

  const currentWeek = WEEKS[selectedWeek];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{t('weeklyProgram')}</h1>
        <p className="text-slate-400 mt-1 text-sm">
          {t('subtitle')}
        </p>
      </div>

      {/* Week Selector + View Toggle — compact row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Week Dropdown */}
        <div className="relative">
          <button
            onClick={() => setWeekDropdownOpen(!weekDropdownOpen)}
            className="flex items-center gap-3 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 hover:border-slate-600 transition-colors min-w-[240px]"
          >
            <div className="flex-1 text-start">
              <div className="font-semibold text-white">{currentWeek.weekLabel}</div>
              <div className="text-xs text-slate-400">{currentWeek.dateRange}</div>
            </div>
            {selectedWeek === 0 && (
              <span className="bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full font-medium">
                {t('current')}
              </span>
            )}
            <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", weekDropdownOpen && "rotate-180")} />
          </button>

          {weekDropdownOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setWeekDropdownOpen(false)} />
              <div className="absolute top-full start-0 mt-2 z-50 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden min-w-[240px]">
                {WEEKS.map((week, i) => (
                  <button
                    key={i}
                    onClick={() => { setSelectedWeek(i); setWeekDropdownOpen(false); }}
                    className={cn(
                      "w-full text-start px-4 py-3 flex items-center justify-between hover:bg-slate-700/50 transition-colors",
                      i === selectedWeek && "bg-primary-600/20 border-s-2 border-primary-500"
                    )}
                  >
                    <div>
                      <div className="font-medium text-white text-sm">{week.weekLabel}</div>
                      <div className="text-xs text-slate-400">{week.dateRange}</div>
                    </div>
                    {i === 0 && (
                      <span className="bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full font-medium">
                        Current
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Toggle Training / Nutrition / Workout */}
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
          <button
            onClick={() => setActiveView('training')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
              activeView === 'training'
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            )}
          >
            <Dumbbell className="h-4 w-4" />
            {t('training')}
          </button>
          <button
            onClick={() => setActiveView('nutrition')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
              activeView === 'nutrition'
                ? 'bg-green-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            )}
          >
            <Utensils className="h-4 w-4" />
            {t('nutrition')}
          </button>
          <button
            onClick={() => setActiveView('workout')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
              activeView === 'workout'
                ? 'bg-orange-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            )}
          >
            <Play className="h-4 w-4" />
            {t('workout')}
          </button>
        </div>
      </div>

      {/* PDF Viewer or Workout Videos */}
      {activeView === 'workout' ? (
        <div className="space-y-4">
          {/* Video Player */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4 text-orange-400" />
                <span className="text-sm font-medium">
                  {t('nowPlaying')}: {t('exercise')} {selectedVideoIndex + 1}
                </span>
              </div>
            </div>

            <div className="w-full aspect-video bg-slate-900">
              <iframe
                key={selectedVideoIndex}
                src={`https://drive.google.com/file/d/${WORKOUT_VIDEOS[selectedVideoIndex]}/preview`}
                className="w-full h-full border-0"
                title={`${t('exercise')} ${selectedVideoIndex + 1}`}
                allow="autoplay"
              />
            </div>
          </div>

          {/* Exercise List */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3 px-2">{t('selectExercise')}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {WORKOUT_VIDEOS.map((videoId, index) => (
                <button
                  key={videoId}
                  onClick={() => setSelectedVideoIndex(index)}
                  className={cn(
                    'p-4 rounded-lg border-2 transition-all text-center hover:scale-105',
                    index === selectedVideoIndex
                      ? 'border-orange-500 bg-orange-500/20 text-orange-400'
                      : 'border-slate-700 bg-slate-700/50 text-slate-300 hover:border-slate-600 hover:bg-slate-700'
                  )}
                >
                  <Play className={cn(
                    "h-6 w-6 mx-auto mb-2",
                    index === selectedVideoIndex ? "text-orange-400" : "text-slate-400"
                  )} />
                  <div className="text-lg font-bold">
                    {index + 1}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {t('exercise')}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-medium">
                {activeView === 'training' ? t('trainingProgram') : t('nutritionPlan')} — {currentWeek.dateRange}
              </span>
            </div>
            <a
              href={activeView === 'training' ? currentWeek.training : currentWeek.nutrition}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('openInNewTab')}
            </a>
          </div>

          <div className="w-full" style={{ height: '80vh' }}>
            <iframe
              src={activeView === 'training' ? currentWeek.training : currentWeek.nutrition}
              className="w-full h-full border-0"
              title={`${activeView} plan for ${currentWeek.weekLabel}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
