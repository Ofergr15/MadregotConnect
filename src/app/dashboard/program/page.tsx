'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dumbbell, Utensils, FileText, ExternalLink, ChevronDown, Play, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
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

type ExerciseCategory = 'legs' | 'core' | 'upper' | 'prehab';

interface WorkoutVideo {
  id: string;
  name: string;
  category: ExerciseCategory;
  tags: string[];
}

const WORKOUT_VIDEOS: WorkoutVideo[] = [
  { id: '1p9Shn1UBipPtTbsuC21MskgKBhah8fxx', name: 'Back Squat', category: 'legs', tags: ['Legs', 'Compound', 'Strength'] },
  { id: '1O_dNYkt86r7ZrEjL9qmWi1HPNMAPCR_a', name: 'Front Squat (no box)', category: 'legs', tags: ['Legs', 'Compound', 'Strength'] },
  { id: '16oYlgqVxAh_LvejOQZf4Pc69aHM8XNFQ', name: 'Front Squat (with box)', category: 'legs', tags: ['Legs', 'Compound', 'Strength'] },
  { id: '1d-6cNIuLvJ83cE9cNasN2Z_7kWGFIVoA', name: 'Hip Thrust', category: 'legs', tags: ['Glutes', 'Strength', 'Compound'] },
  { id: '1RTRPVJNviLCnfBTmYDlwCYuWnrDj2_kI', name: 'Lunges', category: 'legs', tags: ['Legs', 'Unilateral', 'Compound'] },
  { id: '10GWulniGD9EfbaJep6o5Cp1W_uBQmmtJ', name: 'Romanian Deadlift', category: 'legs', tags: ['Hamstrings', 'Compound', 'Strength'] },
  { id: '1KPnhOu8yegX8Tj2KUqzb0PMA0PaXOfEf', name: 'Step Up', category: 'legs', tags: ['Legs', 'Unilateral', 'Compound'] },
  { id: '1mYmpxjSjzRiEdaPzuPDQwm1qzJO3SNOC', name: 'Single-Leg Deadlift', category: 'legs', tags: ['Hamstrings', 'Unilateral', 'Balance'] },
  { id: '1d29Y6KsBzcGOERF1hvtBQ75Cnaz4hjJa', name: 'Single-Leg Sit to Stand', category: 'legs', tags: ['Legs', 'Unilateral', 'Bodyweight'] },
  { id: '1DyxyrjAaTX2gbsCY7d33Iz3hRWs4mESH', name: 'Seated Calf Raises', category: 'legs', tags: ['Calves', 'Isolation', 'Strength'] },
  { id: '1M_AkiLylOcbybvBg2X-ALBGuPbF8A5MT', name: 'Bird Dog', category: 'core', tags: ['Core', 'Stability', 'Bodyweight'] },
  { id: '133UK4QjplTNIsUBHrRp4OwYBnnPApCZk', name: 'Side Plank', category: 'core', tags: ['Core', 'Stability', 'Bodyweight'] },
  { id: '1tIoIaxDizlgRsNL0H5VK5HdJ2Cw4YBlc', name: 'Toes to Bar', category: 'core', tags: ['Core', 'Strength', 'Advanced'] },
  { id: '1PT4JyGjDwQEDjCzV8lGDP_AGZfJR1Hix', name: 'Shoulder Press', category: 'upper', tags: ['Upper', 'Shoulders', 'Strength'] },
  { id: '1c581iETVjs9GytI95T6iwN_bW_7k4_N6', name: "Farmer's Carry", category: 'upper', tags: ['Upper', 'Grip', 'Functional'] },
  { id: '1egI6kI8qAfuWgu67Te9twkWZRD1MKJYU', name: 'Banded Tibialis Raise', category: 'prehab', tags: ['Prehab', 'Mobility', 'Lower Leg'] },
  { id: '1lggSCQcqpfMrpFoZv6QSzmW2CX_7ttGq', name: 'Banded Tibialis Raise (2)', category: 'prehab', tags: ['Prehab', 'Mobility', 'Lower Leg'] },
];

export default function ProgramPage() {
  const t = useTranslations('program');
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [activeView, setActiveView] = useState<'training' | 'nutrition' | 'workout'>('training');
  const [weekDropdownOpen, setWeekDropdownOpen] = useState(false);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExerciseCategory>('all');

  const currentWeek = WEEKS[selectedWeek];

  // Filter exercises based on category
  const filteredExercises = categoryFilter === 'all'
    ? WORKOUT_VIDEOS
    : WORKOUT_VIDEOS.filter(ex => ex.category === categoryFilter);

  // Get exercise categories with counts
  const categoryData = {
    all: WORKOUT_VIDEOS.length,
    legs: WORKOUT_VIDEOS.filter(ex => ex.category === 'legs').length,
    core: WORKOUT_VIDEOS.filter(ex => ex.category === 'core').length,
    upper: WORKOUT_VIDEOS.filter(ex => ex.category === 'upper').length,
    prehab: WORKOUT_VIDEOS.filter(ex => ex.category === 'prehab').length,
  };

  // Navigation between exercises
  const handlePrevious = () => {
    const currentFilteredIndex = filteredExercises.findIndex((_, i) => WORKOUT_VIDEOS.indexOf(filteredExercises[i]) === selectedVideoIndex);
    if (currentFilteredIndex > 0) {
      setSelectedVideoIndex(WORKOUT_VIDEOS.indexOf(filteredExercises[currentFilteredIndex - 1]));
    }
  };

  const handleNext = () => {
    const currentFilteredIndex = filteredExercises.findIndex((_, i) => WORKOUT_VIDEOS.indexOf(filteredExercises[i]) === selectedVideoIndex);
    if (currentFilteredIndex < filteredExercises.length - 1) {
      setSelectedVideoIndex(WORKOUT_VIDEOS.indexOf(filteredExercises[currentFilteredIndex + 1]));
    }
  };

  const currentExercise = WORKOUT_VIDEOS[selectedVideoIndex];
  const currentFilteredIndex = filteredExercises.findIndex((_, i) => WORKOUT_VIDEOS.indexOf(filteredExercises[i]) === selectedVideoIndex);

  // Tag colors
  const getTagColor = (tag: string): string => {
    const tagColors: Record<string, string> = {
      'Legs': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      'Glutes': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
      'Core': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      'Upper': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      'Prehab': 'bg-green-500/20 text-green-400 border-green-500/30',
      'Compound': 'bg-red-500/20 text-red-400 border-red-500/30',
      'Unilateral': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      'Strength': 'bg-slate-500/20 text-slate-300 border-slate-500/30',
      'Bodyweight': 'bg-teal-500/20 text-teal-400 border-teal-500/30',
      'Isolation': 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
      'Balance': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      'Stability': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      'Mobility': 'bg-lime-500/20 text-lime-400 border-lime-500/30',
      'Functional': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      'Advanced': 'bg-rose-500/20 text-rose-400 border-rose-500/30',
      'Calves': 'bg-sky-500/20 text-sky-400 border-sky-500/30',
      'Hamstrings': 'bg-violet-500/20 text-violet-400 border-violet-500/30',
      'Shoulders': 'bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30',
      'Grip': 'bg-stone-500/20 text-stone-300 border-stone-500/30',
      'Lower Leg': 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
    };
    return tagColors[tag] || 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  };

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
        <div className="space-y-5">
          {/* Video Player with Navigation */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            {/* Video Header with Controls */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-white truncate">{currentExercise.name}</h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {currentExercise.tags.map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full border font-medium',
                        getTagColor(tag)
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Navigation Controls */}
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={handlePrevious}
                  disabled={currentFilteredIndex === 0}
                  className={cn(
                    'p-2 rounded-lg transition-all',
                    currentFilteredIndex === 0
                      ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                      : 'bg-slate-700 text-white hover:bg-slate-600 active:scale-95'
                  )}
                  aria-label={t('previous')}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="text-sm text-slate-400 font-medium min-w-[60px] text-center">
                  {currentFilteredIndex + 1} / {filteredExercises.length}
                </span>
                <button
                  onClick={handleNext}
                  disabled={currentFilteredIndex === filteredExercises.length - 1}
                  className={cn(
                    'p-2 rounded-lg transition-all',
                    currentFilteredIndex === filteredExercises.length - 1
                      ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                      : 'bg-slate-700 text-white hover:bg-slate-600 active:scale-95'
                  )}
                  aria-label={t('next')}
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Video Player */}
            <div className="w-full aspect-video bg-slate-900">
              <iframe
                key={selectedVideoIndex}
                src={`https://drive.google.com/file/d/${currentExercise.id}/preview`}
                className="w-full h-full border-0"
                title={currentExercise.name}
                allow="autoplay"
              />
            </div>
          </div>

          {/* Exercise Library */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            {/* Library Header */}
            <div className="px-5 py-4 border-b border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Dumbbell className="h-5 w-5 text-orange-400" />
                  <h3 className="text-lg font-bold text-white">{t('exerciseLibrary')}</h3>
                </div>
                <span className="text-sm text-slate-400 font-medium">
                  {filteredExercises.length} {t('exercises')}
                </span>
              </div>

              {/* Category Filters */}
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide">
                <button
                  onClick={() => setCategoryFilter('all')}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex items-center gap-2 shrink-0',
                    categoryFilter === 'all'
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  )}
                >
                  <Filter className="h-4 w-4" />
                  {t('all')} ({categoryData.all})
                </button>
                <button
                  onClick={() => setCategoryFilter('legs')}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all shrink-0',
                    categoryFilter === 'legs'
                      ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  )}
                >
                  {t('legsGlutes')} ({categoryData.legs})
                </button>
                <button
                  onClick={() => setCategoryFilter('core')}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all shrink-0',
                    categoryFilter === 'core'
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  )}
                >
                  {t('coreStability')} ({categoryData.core})
                </button>
                <button
                  onClick={() => setCategoryFilter('upper')}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all shrink-0',
                    categoryFilter === 'upper'
                      ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  )}
                >
                  {t('upperBody')} ({categoryData.upper})
                </button>
                <button
                  onClick={() => setCategoryFilter('prehab')}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all shrink-0',
                    categoryFilter === 'prehab'
                      ? 'bg-green-500 text-white shadow-lg shadow-green-500/20'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  )}
                >
                  {t('prehabMobility')} ({categoryData.prehab})
                </button>
              </div>
            </div>

            {/* Exercise Grid */}
            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredExercises.map((video) => {
                  const globalIndex = WORKOUT_VIDEOS.indexOf(video);
                  const isSelected = globalIndex === selectedVideoIndex;

                  return (
                    <button
                      key={video.id}
                      onClick={() => setSelectedVideoIndex(globalIndex)}
                      className={cn(
                        'p-4 rounded-xl border-2 transition-all text-start group hover:scale-[1.02] active:scale-[0.98]',
                        isSelected
                          ? 'border-orange-500 bg-orange-500/10 shadow-lg shadow-orange-500/20'
                          : 'border-slate-700 bg-slate-700/30 hover:border-slate-600 hover:bg-slate-700/50'
                      )}
                    >
                      {/* Exercise Name */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <h4 className={cn(
                          'font-bold text-base leading-tight',
                          isSelected ? 'text-orange-400' : 'text-white group-hover:text-orange-400 transition-colors'
                        )}>
                          {video.name}
                        </h4>
                        {isSelected && (
                          <div className="shrink-0 w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                        )}
                      </div>

                      {/* Tags */}
                      <div className="flex flex-wrap gap-1.5">
                        {video.tags.map((tag) => (
                          <span
                            key={tag}
                            className={cn(
                              'text-xs px-2 py-1 rounded-md border font-medium transition-all',
                              getTagColor(tag)
                            )}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      {/* Play Indicator */}
                      {isSelected && (
                        <div className="flex items-center gap-1.5 mt-3 text-orange-400">
                          <Play className="h-3.5 w-3.5" />
                          <span className="text-xs font-medium">{t('nowPlaying')}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
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
