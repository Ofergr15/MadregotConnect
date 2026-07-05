'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Dumbbell, Utensils, FileText, ExternalLink, ChevronDown, Play, ChevronLeft, ChevronRight, Plus, Upload, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProgramWeek {
  id: string;
  week_number: number;
  date_range: string;
  week_start_date: string;
  training_pdf_url: string | null;
  nutrition_pdf_url: string | null;
}

type ExerciseCategory = 'legs' | 'core' | 'upper' | 'prehab';

interface WorkoutVideo {
  id: string;
  youtube?: string;
  name: string;
  category: ExerciseCategory;
  tags: string[];
  desc: string;
  sets: string;
}

const WORKOUT_VIDEOS: WorkoutVideo[] = [
  { id: '1p9Shn1UBipPtTbsuC21MskgKBhah8fxx', youtube: 'bbxNEEHiRZI', name: 'Back Squat', category: 'legs', tags: ['Legs', 'Compound'], desc: 'Barbell on upper back, squat to parallel. Builds quad & glute strength for uphill power.', sets: '3×8-10' },
  { id: '1O_dNYkt86r7ZrEjL9qmWi1HPNMAPCR_a', youtube: 'FtlJLOySoJs', name: 'Front Squat (no box)', category: 'legs', tags: ['Legs', 'Compound'], desc: 'Barbell on front delts, upright torso. Targets quads and core stability for running posture.', sets: '3×8' },
  { id: '16oYlgqVxAh_LvejOQZf4Pc69aHM8XNFQ', youtube: 'Zweqr7BlXKo', name: 'Front Squat (with box)', category: 'legs', tags: ['Legs', 'Compound'], desc: 'Squat to box for consistent depth. Teaches proper mechanics and reduces knee stress.', sets: '3×8' },
  { id: '1d-6cNIuLvJ83cE9cNasN2Z_7kWGFIVoA', youtube: 'IudMWezXQ8I', name: 'Hip Thrust', category: 'legs', tags: ['Glutes', 'Strength'], desc: 'Back on bench, drive hips up with barbell. Isolates glutes for explosive push-off power.', sets: '3×10-12' },
  { id: '1RTRPVJNviLCnfBTmYDlwCYuWnrDj2_kI', youtube: 'fBk19xvf5Oo', name: 'Lunges', category: 'legs', tags: ['Legs', 'Unilateral'], desc: 'Step forward, lower back knee to ground. Builds single-leg strength and running-specific balance.', sets: '3×10/leg' },
  { id: '10GWulniGD9EfbaJep6o5Cp1W_uBQmmtJ', youtube: 'T0XXEmefwCQ', name: 'Romanian Deadlift', category: 'legs', tags: ['Hamstrings', 'Compound'], desc: 'Hinge at hips with slight knee bend, lower bar along legs. Strengthens hamstrings and posterior chain.', sets: '3×10' },
  { id: '1KPnhOu8yegX8Tj2KUqzb0PMA0PaXOfEf', youtube: 'Q0f60RP4kD0', name: 'Step Up', category: 'legs', tags: ['Legs', 'Unilateral'], desc: 'Step onto elevated box, drive through front foot. Mimics hill running and builds single-leg power.', sets: '3×8/leg' },
  { id: 'side-step-up', youtube: 'GiFFJv8qswk', name: 'Side Step Up', category: 'legs', tags: ['Legs', 'Unilateral'], desc: 'Step up laterally onto box. Strengthens hip abductors and lateral stability for trail running.', sets: '3×8/leg' },
  { id: '1mYmpxjSjzRiEdaPzuPDQwm1qzJO3SNOC', youtube: 'aZ8bpWzsc5M', name: 'Single-Leg Deadlift', category: 'legs', tags: ['Hamstrings', 'Balance'], desc: 'Hinge on one leg, opposite leg extends back. Improves balance and hamstring strength for stride stability.', sets: '3×8/leg' },
  { id: '1d29Y6KsBzcGOERF1hvtBQ75Cnaz4hjJa', youtube: 'tK7uSBiSVYQ', name: 'Single-Leg Sit to Stand', category: 'legs', tags: ['Legs', 'Bodyweight'], desc: 'Sit on bench, stand up on one leg. Tests and builds single-leg quad strength without loading the spine.', sets: '3×8/leg' },
  { id: '1DyxyrjAaTX2gbsCY7d33Iz3hRWs4mESH', youtube: 'ZeNfT5MD1A0', name: 'Seated Calf Raises', category: 'legs', tags: ['Calves', 'Isolation'], desc: 'Seated with weight on knees, raise heels. Targets the soleus — the key muscle for long-distance running.', sets: '3×15' },
  { id: '1M_AkiLylOcbybvBg2X-ALBGuPbF8A5MT', youtube: 'A8mPrumly1c', name: 'Bird Dog', category: 'core', tags: ['Core', 'Stability'], desc: 'On all fours, extend opposite arm and leg. Builds anti-rotation core stability for better running form.', sets: '3×10/side' },
  { id: '133UK4QjplTNIsUBHrRp4OwYBnnPApCZk', youtube: '5DOywcXP6qU', name: 'Side Plank', category: 'core', tags: ['Core', 'Stability'], desc: 'Hold body in straight line on forearm sideways. Strengthens obliques to prevent hip drop while running.', sets: '3×30s/side' },
  { id: '1tIoIaxDizlgRsNL0H5VK5HdJ2Cw4YBlc', youtube: 'zUMI4pyfFz8', name: 'Toes to Bar', category: 'core', tags: ['Core', 'Advanced'], desc: 'Hang from bar, lift toes to touch it. Advanced core exercise that builds hip flexor and ab strength.', sets: '3×8-12' },
  { id: '1PT4JyGjDwQEDjCzV8lGDP_AGZfJR1Hix', youtube: 'z2liB6tljNA', name: 'Shoulder Press', category: 'upper', tags: ['Shoulders', 'Strength'], desc: 'Press dumbbells or barbell overhead. Maintains upper body balance and arm drive strength for running.', sets: '3×10' },
  { id: '1c581iETVjs9GytI95T6iwN_bW_7k4_N6', youtube: 'Yi5kPtF0K78k', name: "Farmer's Carry", category: 'upper', tags: ['Grip', 'Functional'], desc: 'Walk with heavy weights in each hand, upright posture. Builds grip, core, and running posture endurance.', sets: '3×40m' },
  { id: '1egI6kI8qAfuWgu67Te9twkWZRD1MKJYU', youtube: 'OL9YgIsJpkk', name: 'Banded Tibialis Raise', category: 'prehab', tags: ['Prehab', 'Mobility'], desc: 'Pull toes up against band resistance. Strengthens shin muscles to prevent shin splints.', sets: '3×15' },
];

export default function ProgramPage() {
  const t = useTranslations('program');
  const [weeks, setWeeks] = useState<ProgramWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [activeView, setActiveView] = useState<'training' | 'nutrition' | 'workout'>('training');
  const [weekDropdownOpen, setWeekDropdownOpen] = useState(false);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExerciseCategory>('all');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const adminSession = localStorage.getItem('admin_session') === 'true';
    const coachEmail = localStorage.getItem('coach_email');
    setIsAdmin(adminSession || !!coachEmail);
    fetchWeeks();
  }, []);

  async function fetchWeeks() {
    try {
      const res = await fetch('/api/program-weeks');
      if (res.ok) {
        const data = await res.json();
        setWeeks(data);
      }
    } finally {
      setLoading(false);
    }
  }

  const currentWeek = weeks[selectedWeek];

  // Filter exercises based on category
  const filteredExercises = categoryFilter === 'all'
    ? WORKOUT_VIDEOS
    : WORKOUT_VIDEOS.filter(ex => ex.category === categoryFilter);

  const categoryData = {
    all: WORKOUT_VIDEOS.length,
    legs: WORKOUT_VIDEOS.filter(ex => ex.category === 'legs').length,
    core: WORKOUT_VIDEOS.filter(ex => ex.category === 'core').length,
    upper: WORKOUT_VIDEOS.filter(ex => ex.category === 'upper').length,
    prehab: WORKOUT_VIDEOS.filter(ex => ex.category === 'prehab').length,
  };

  const handlePrevious = () => {
    if (selectedVideoIndex === null) return;
    const currentFilteredIndex = filteredExercises.findIndex((_, i) => WORKOUT_VIDEOS.indexOf(filteredExercises[i]) === selectedVideoIndex);
    if (currentFilteredIndex > 0) {
      setSelectedVideoIndex(WORKOUT_VIDEOS.indexOf(filteredExercises[currentFilteredIndex - 1]));
    }
  };

  const handleNext = () => {
    if (selectedVideoIndex === null) return;
    const currentFilteredIndex = filteredExercises.findIndex((_, i) => WORKOUT_VIDEOS.indexOf(filteredExercises[i]) === selectedVideoIndex);
    if (currentFilteredIndex < filteredExercises.length - 1) {
      setSelectedVideoIndex(WORKOUT_VIDEOS.indexOf(filteredExercises[currentFilteredIndex + 1]));
    }
  };

  const currentExercise = selectedVideoIndex !== null ? WORKOUT_VIDEOS[selectedVideoIndex] : null;
  const currentFilteredIndex = selectedVideoIndex !== null
    ? filteredExercises.findIndex((_, i) => WORKOUT_VIDEOS.indexOf(filteredExercises[i]) === selectedVideoIndex)
    : -1;

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4 sm:space-y-5', activeView === 'workout' && 'space-y-3')}>
      {/* Header — hide on mobile when in workout mode */}
      <div className={cn(activeView === 'workout' ? 'hidden sm:block' : '', 'flex items-center justify-between')}>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">{t('weeklyProgram')}</h1>
          <p className="text-slate-400 mt-1 text-sm">{t('subtitle')}</p>
        </div>
        {isAdmin && activeView !== 'workout' && (
          <button
            onClick={() => setShowUploadForm(true)}
            className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            New Week
          </button>
        )}
      </div>

      {/* View Toggle — full width, sticky on mobile */}
      <div className={cn('flex flex-col gap-3', activeView === 'workout' && 'sticky top-0 z-30 bg-slate-900 -mx-4 px-4 pt-2 pb-3 sm:static sm:mx-0 sm:px-0 sm:pt-0 sm:pb-0 sm:bg-transparent')}>
        <div className="flex gap-0.5 bg-slate-800 rounded-xl p-1 border border-slate-700 w-full">
          <button
            onClick={() => setActiveView('training')}
            className={cn(
              'flex-1 px-2 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-1.5',
              activeView === 'training'
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            )}
          >
            <Dumbbell className="h-4 w-4" />
            {t('training')}
          </button>
          <button
            onClick={() => setActiveView('nutrition')}
            className={cn(
              'flex-1 px-2 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-1.5',
              activeView === 'nutrition'
                ? 'bg-green-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            )}
          >
            <Utensils className="h-4 w-4" />
            {t('nutrition')}
          </button>
          <button
            onClick={() => setActiveView('workout')}
            className={cn(
              'flex-1 px-2 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center gap-1.5',
              activeView === 'workout'
                ? 'bg-orange-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            )}
          >
            <Play className="h-4 w-4" />
            Gym
          </button>
        </div>

        {/* Week Dropdown — only show for training/nutrition */}
        {activeView !== 'workout' && currentWeek && (
        <div className="relative">
          <button
            onClick={() => setWeekDropdownOpen(!weekDropdownOpen)}
            className="flex items-center gap-3 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 hover:border-slate-600 transition-colors w-full sm:w-auto sm:min-w-[240px]"
          >
            <div className="flex-1 text-start">
              <div className="font-semibold text-white">Week {currentWeek.week_number}</div>
              <div className="text-xs text-slate-400">{currentWeek.date_range}</div>
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
              <div className="absolute top-full start-0 mt-2 z-50 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden min-w-[240px] max-h-[300px] overflow-y-auto">
                {weeks.map((week, i) => (
                  <button
                    key={week.id}
                    onClick={() => { setSelectedWeek(i); setWeekDropdownOpen(false); }}
                    className={cn(
                      "w-full text-start px-4 py-3 flex items-center justify-between hover:bg-slate-700/50 transition-colors",
                      i === selectedWeek && "bg-primary-600/20 border-s-2 border-primary-500"
                    )}
                  >
                    <div>
                      <div className="font-medium text-white text-sm">Week {week.week_number}</div>
                      <div className="text-xs text-slate-400">{week.date_range}</div>
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
        )}
      </div>

      {/* PDF Viewer or Workout Videos */}
      {activeView === 'workout' ? (
        <div className="space-y-3 sm:space-y-5">
          {/* Video Player — only show after selecting an exercise */}
          {currentExercise && (
          <div className="bg-slate-800 rounded-xl sm:rounded-xl border border-slate-700 overflow-hidden -mx-4 sm:mx-0 rounded-none sm:rounded-xl border-x-0 sm:border-x">
            <div className="w-full aspect-video bg-slate-900 relative">
              {currentExercise.youtube ? (
                <iframe
                  key={selectedVideoIndex}
                  src={`https://www.youtube.com/embed/${currentExercise.youtube}?playsinline=1&rel=0`}
                  className="w-full h-full border-0"
                  title={currentExercise.name}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <>
                  <iframe
                    key={selectedVideoIndex}
                    src={`https://drive.google.com/file/d/${currentExercise.id}/preview`}
                    className="w-full h-full border-0"
                    title={currentExercise.name}
                    allow="autoplay; fullscreen"
                    allowFullScreen
                  />
                  <a
                    href={`https://drive.google.com/file/d/${currentExercise.id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute top-2 end-2 bg-black/70 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 z-10 sm:hidden"
                  >
                    <Play className="h-3 w-3" />
                    Open
                  </a>
                </>
              )}
            </div>

            <div className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-white truncate">{currentExercise.name}</h3>
                </div>
                <div className="flex items-center gap-1 shrink-0 ms-2">
                  <button
                    onClick={handlePrevious}
                    disabled={currentFilteredIndex === 0}
                    className={cn(
                      'p-2.5 rounded-lg transition-all',
                      currentFilteredIndex === 0
                        ? 'text-slate-600 cursor-not-allowed'
                        : 'bg-slate-700 text-white active:scale-90'
                    )}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <span className="text-xs text-slate-400 font-bold min-w-[36px] text-center">
                    {currentFilteredIndex + 1}/{filteredExercises.length}
                  </span>
                  <button
                    onClick={handleNext}
                    disabled={currentFilteredIndex === filteredExercises.length - 1}
                    className={cn(
                      'p-2.5 rounded-lg transition-all',
                      currentFilteredIndex === filteredExercises.length - 1
                        ? 'text-slate-600 cursor-not-allowed'
                        : 'bg-slate-700 text-white active:scale-90'
                    )}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">{currentExercise.desc}</p>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-bold">
                  {currentExercise.sets}
                </span>
                {currentExercise.tags.map((tag) => (
                  <span
                    key={tag}
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full border font-medium',
                      getTagColor(tag)
                    )}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          )}

          {/* Category Filters */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
            {[
              { key: 'all' as const, label: t('all'), count: categoryData.all, color: 'orange' },
              { key: 'legs' as const, label: 'Legs', count: categoryData.legs, color: 'blue' },
              { key: 'core' as const, label: 'Core', count: categoryData.core, color: 'orange' },
              { key: 'upper' as const, label: 'Upper', count: categoryData.upper, color: 'purple' },
              { key: 'prehab' as const, label: 'Prehab', count: categoryData.prehab, color: 'green' },
            ].map(({ key, label, count, color }) => (
              <button
                key={key}
                onClick={() => setCategoryFilter(key)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all shrink-0',
                  categoryFilter === key
                    ? `bg-${color}-500 text-white`
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                )}
              >
                {label} ({count})
              </button>
            ))}
          </div>

          {/* Exercise Cards */}
          <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-3">
            {filteredExercises.map((video) => {
              const globalIndex = WORKOUT_VIDEOS.indexOf(video);
              const isSelected = globalIndex === selectedVideoIndex;

              return (
                <button
                  key={video.id}
                  onClick={() => {
                    setSelectedVideoIndex(globalIndex);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className={cn(
                    'w-full rounded-xl border transition-all text-start overflow-hidden flex sm:flex-col active:scale-[0.98]',
                    isSelected
                      ? 'border-orange-500 bg-orange-500/10'
                      : 'border-slate-700 bg-slate-800/50'
                  )}
                >
                  <div className="relative w-28 sm:w-full aspect-square sm:aspect-[16/9] bg-slate-900 overflow-hidden shrink-0">
                    <img
                      src={`https://drive.google.com/thumbnail?id=${video.id}&sz=w400`}
                      alt={video.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                    {isSelected && (
                      <div className="absolute top-1.5 end-1.5 bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        Live
                      </div>
                    )}
                    {!isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-black/40 flex items-center justify-center">
                          <Play className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white ms-0.5" />
                        </div>
                      </div>
                    )}
                    <div className="absolute bottom-1 start-1 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                      {video.sets}
                    </div>
                  </div>

                  <div className="p-3 flex-1 min-w-0 flex flex-col justify-center">
                    <h4 className={cn(
                      'font-bold text-sm leading-tight',
                      isSelected ? 'text-orange-400' : 'text-white'
                    )}>
                      {video.name}
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-snug">
                      {video.desc}
                    </p>
                    <div className="flex gap-1 mt-1.5">
                      {video.tags.map((tag) => (
                        <span
                          key={tag}
                          className={cn(
                            'text-[9px] px-1.5 py-0.5 rounded border font-medium',
                            getTagColor(tag)
                          )}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : currentWeek ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-medium">
                {activeView === 'training' ? t('trainingProgram') : t('nutritionPlan')} — {currentWeek.date_range}
              </span>
            </div>
            {getPdfUrl(currentWeek, activeView) && (
              <a
                href={getPdfUrl(currentWeek, activeView)!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('openInNewTab')}
              </a>
            )}
          </div>

          <div className="w-full" style={{ height: '80vh' }}>
            {getPdfUrl(currentWeek, activeView) ? (
              <iframe
                src={getPdfUrl(currentWeek, activeView)!}
                className="w-full h-full border-0"
                title={`${activeView} plan for Week ${currentWeek.week_number}`}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400">
                No {activeView} plan uploaded for this week yet.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-12 text-center">
          <p className="text-slate-400">No program weeks available yet.</p>
          {isAdmin && (
            <button
              onClick={() => setShowUploadForm(true)}
              className="mt-4 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add First Week
            </button>
          )}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadForm && (
        <UploadForm
          nextWeekNumber={weeks.length > 0 ? weeks[0].week_number + 1 : 1}
          onClose={() => setShowUploadForm(false)}
          onSuccess={() => { setShowUploadForm(false); fetchWeeks(); }}
        />
      )}
    </div>
  );
}

function getPdfUrl(week: ProgramWeek, view: 'training' | 'nutrition' | 'workout'): string | null {
  if (view === 'workout') return null;
  return view === 'training' ? week.training_pdf_url : week.nutrition_pdf_url;
}

function UploadForm({
  nextWeekNumber,
  onClose,
  onSuccess,
}: {
  nextWeekNumber: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [weekNumber, setWeekNumber] = useState(nextWeekNumber);
  const [dateRange, setDateRange] = useState('');
  const [weekStartDate, setWeekStartDate] = useState('');
  const [trainingFile, setTrainingFile] = useState<File | null>(null);
  const [nutritionFile, setNutritionFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const now = new Date();
    const day = now.getDay();
    const sundayOffset = day === 0 ? 0 : 7 - day;
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + sundayOffset);
    const nextSaturday = new Date(nextSunday);
    nextSaturday.setDate(nextSunday.getDate() + 6);

    const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    setDateRange(`${fmt(nextSunday)} – ${fmt(nextSaturday)}`);
    setWeekStartDate(nextSunday.toISOString().slice(0, 10));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trainingFile && !nutritionFile) {
      setError('Please upload at least one PDF');
      return;
    }

    setUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('week_number', String(weekNumber));
    formData.append('date_range', dateRange);
    formData.append('week_start_date', weekStartDate);
    if (trainingFile) formData.append('training_pdf', trainingFile);
    if (nutritionFile) formData.append('nutrition_pdf', nutritionFile);

    try {
      const res = await fetch('/api/program-weeks', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Upload className="h-5 w-5 text-primary-400" />
          Add New Week
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Week #</label>
              <input
                type="number"
                value={weekNumber}
                onChange={e => setWeekNumber(Number(e.target.value))}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                min={1}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Date Range</label>
              <input
                type="text"
                value={dateRange}
                onChange={e => setDateRange(e.target.value)}
                placeholder="05.07 – 11.07"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Week Start Date (Sunday)</label>
            <input
              type="date"
              value={weekStartDate}
              onChange={e => setWeekStartDate(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Training Program PDF</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={e => setTrainingFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary-600 file:text-white file:font-medium file:cursor-pointer hover:file:bg-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Nutrition Plan PDF</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={e => setNutritionFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-green-600 file:text-white file:font-medium file:cursor-pointer hover:file:bg-green-500"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="flex-1 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
