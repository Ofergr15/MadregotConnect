'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Dumbbell, Utensils, FileText, ExternalLink, ChevronDown, Play, ChevronLeft, ChevronRight, Plus, Upload, Loader2, ClipboardList, Hash, Calendar, CalendarRange } from 'lucide-react';
import { cn, isRecentlyPublished, toISODate } from '@/lib/utils';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { useApi } from '@/lib/api';
import { getDisplayWeekStart } from '@/lib/plans/workout-parsing';
import { WORKOUT_TYPE_COLORS, WORKOUT_TYPE_LABELS } from '@/lib/plans/workout-parsing';
import { Card, Button, EmptyState, SegmentedControl, Sheet, InsetSection, InsetRow, BigStat } from '@/components/ui';
import { WorkoutDetailModal } from '@/components/WorkoutDetailModal';
import { AttendanceConfirmCard } from '@/components/AttendanceConfirmCard';

interface WeekPlanDay {
  day: string;
  dayOfWeek: number;
  min: number;
  max: number;
  type: string;
  sessions: Array<{ min: number; max: number; type: string; name: string }>;
}

interface WeekPlanSession {
  day: string;
  dayOfWeek: number;
  name: string;
  type: string;
  totalKm: number;
  highlight: string;
  steps: any[];
}

interface WeekPlanResponse {
  hasPlan: boolean;
  weekStart: string;
  publishedAt?: string | null;
  dailyDistances: WeekPlanDay[];
  keySessions: WeekPlanSession[];
}


interface ProgramWeek {
  id: string;
  week_number: number;
  date_range: string;
  week_start_date: string;
  training_pdf_url: string | null;
  nutrition_pdf_url: string | null;
}

type ExerciseCategory = 'legs' | 'core' | 'upper' | 'prehab';

// Static class strings for the category-filter chips' active state — Tailwind's
// class scanner can't see runtime-interpolated names like `bg-${color}-500`, so
// that pattern risks the color being purged from the production build. A
// literal lookup keeps every class visible to the scanner.
const CATEGORY_ACTIVE_CLASS: Record<string, string> = {
  orange: 'bg-band-3 text-white',
  blue: 'bg-band-2 text-white',
  purple: 'bg-purple-500 text-white',
  green: 'bg-accent-600 text-white',
};

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
  // The week on screen, held as its Sunday rather than an index into `weeks`:
  // the list arrives from the network and revalidates in the background, so an
  // index means "whatever is in slot 3 now". It also makes the current week
  // known before any request comes back, which is what lets the three loads
  // below all start in the same tick — see `weekStart` on the plan fetch.
  const thisWeekStart = getDisplayWeekStart(new Date());
  const [selectedStart, setSelectedStart] = useState(thisWeekStart);
  const [activeView, setActiveView] = useState<'training' | 'nutrition' | 'workout'>('training');
  // Controls the native week-picker Sheet (replaces an anchored web-style
  // dropdown menu — see the Sheet render below).
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExerciseCategory>('all');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedSession, setSelectedSession] = useState<WeekPlanSession | null>(null);
  // Which group's pace is highlighted in the workout-detail sheet — mirrors the
  // dashboard's own remembered pick (localStorage `view_group`) rather than
  // re-deriving it from the athlete's group assignment on this page too.
  const [viewGroup, setViewGroup] = useState(0);

  useEffect(() => {
    const adminSession = localStorage.getItem('admin_session') === 'true';
    const coachEmail = localStorage.getItem('coach_email');
    setIsAdmin(adminSession || !!coachEmail);
    const storedGroup = parseInt(localStorage.getItem('view_group') || '', 10);
    if (storedGroup >= 0 && storedGroup <= 2) setViewGroup(storedGroup);
  }, []);

  const pickViewGroup = (idx: number) => {
    setViewGroup(idx);
    try { localStorage.setItem('view_group', String(idx)); } catch { /* ignore */ }
  };

  // The three loads this page needs, all started together.
  //
  // They used to be a hand-rolled useEffect + fetch + useState triad that ran
  // the week lists in parallel and then waited for them before asking for the
  // selected week's plan — two round trips before anything rendered, on every
  // single visit, because nothing was cached. The plan request only needed the
  // *week* though, and the week the page opens on is today's, which is a local
  // date calculation. So all three go out at once now, and SWR keeps the answers
  // for the next visit: coming back to the tab paints the last-known program
  // immediately and refreshes behind it.
  const { data: pwData, isLoading: pwLoading, mutate: mutateWeeks } = useApi<ProgramWeek[]>('/api/program-weeks');
  const { data: wpData, isLoading: wpLoading, mutate: mutatePlanWeeks } = useApi<{ weekStarts?: string[] }>('/api/plans/weeks');
  // Selected week only — SWR caches per key, so stepping back to a week already
  // viewed is instant and re-picking today's costs nothing.
  const { data: weekPlanData, isLoading: weekPlanLoading } = useApi<WeekPlanResponse>(
    `/api/plans/week?weekStart=${selectedStart}`,
  );
  const weekPlan = weekPlanData ?? null;
  const loading = pwLoading || wpLoading;

  // Weeks that have AI-parsed structured data in `weekly_plans` (regardless of
  // whether a `program_weeks` PDF row also exists) — used both to add
  // PDF-less weeks to the picker and to make the "training plan uploaded"
  // status row honest when a native plan exists but no PDF was ever attached.
  const structuredWeekStarts = useMemo(() => new Set(wpData?.weekStarts || []), [wpData]);

  const weeks = useMemo<ProgramWeek[]>(() => {
    const rows = pwData || [];
    const wpWeekStarts = wpData?.weekStarts || [];

    // A week with a parsed plan but no PDF upload has no `program_weeks` row
    // at all — synthesize one so it still shows up in the week picker.
    const existingStarts = new Set(rows.map(w => w.week_start_date));
    const synthetic: ProgramWeek[] = wpWeekStarts
      .filter(ws => !existingStarts.has(ws))
      .map(ws => ({
        id: `wp-${ws}`,
        week_number: 0, // unknown for synthetic entries — label falls back to the date range
        date_range: deriveDateRange(ws),
        week_start_date: ws,
        training_pdf_url: null,
        nutrition_pdf_url: null,
      }));

    const data = [...rows, ...synthetic];

    // Guarantee an entry for the actual current week even when nothing has
    // been uploaded/parsed for it yet. Without this, if the coach hasn't
    // posted this week's plan, the picker silently defaults to whichever
    // week happens to sort first (the most recent PAST upload) — which
    // reads as "here's your plan" when it's really an unrelated old week.
    if (!data.some(w => w.week_start_date === thisWeekStart)) {
      data.push({
        id: `current-${thisWeekStart}`,
        week_number: 0,
        date_range: deriveDateRange(thisWeekStart),
        week_start_date: thisWeekStart,
        training_pdf_url: null,
        nutrition_pdf_url: null,
      });
    }

    // Newest-first, matching /api/program-weeks' own ordering.
    return data.sort((a, b) => b.week_start_date.localeCompare(a.week_start_date));
  }, [pwData, wpData, thisWeekStart]);

  // The week the picker is on. Defaults to the one that CONTAINS today rather
  // than the most-recently-uploaded one — otherwise last week shows as
  // "Current" and its plans mask that this week's are missing.
  const currentWeek = weeks.find(w => w.week_start_date === selectedStart);
  // Is the selected week the real calendar-current week (contains today)?
  // `thisWeekStart` uses the same Saturday-20:00 rollover as the dashboard's own
  // "current week" (getDisplayWeekStart) — plain getPlanWeekStart has no such
  // rollover, which used to make this page disagree with the dashboard about
  // which week is "current" for a few hours every Saturday evening.
  const isCurrentWeek = selectedStart === thisWeekStart;
  // Does a program row for the actual current week exist at all?
  const currentWeekExists = weeks.some(w => w.week_start_date === thisWeekStart);

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
      'Legs': 'bg-band-2/20 text-band-2 border-band-2/30',
      'Glutes': 'bg-pink-500/20 text-pink-600 border-pink-500/30',
      'Core': 'bg-band-3/20 text-band-3 border-band-3/30',
      'Upper': 'bg-purple-500/20 text-purple-600 border-purple-500/30',
      'Prehab': 'bg-accent-600/20 text-accent-600 border-accent-600/30',
      'Compound': 'bg-accent-red/20 text-accent-red border-accent-red/30',
      'Unilateral': 'bg-band-3/20 text-band-3 border-band-3/30',
      'Strength': 'bg-ink-300/20 text-ink-500 border-ink-300/30',
      'Bodyweight': 'bg-teal-500/20 text-teal-600 border-teal-500/30',
      'Isolation': 'bg-indigo-500/20 text-indigo-600 border-indigo-500/30',
      'Balance': 'bg-band-2/20 text-band-2 border-band-2/30',
      'Stability': 'bg-accent-600/20 text-accent-600 border-accent-600/30',
      'Mobility': 'bg-lime-500/20 text-lime-600 border-lime-500/30',
      'Functional': 'bg-band-3/20 text-band-3 border-band-3/30',
      'Advanced': 'bg-accent-red/20 text-accent-red border-accent-red/30',
      'Calves': 'bg-band-2/20 text-band-2 border-band-2/30',
      'Hamstrings': 'bg-violet-500/20 text-violet-600 border-violet-500/30',
      'Shoulders': 'bg-fuchsia-500/20 text-fuchsia-600 border-fuchsia-500/30',
      'Grip': 'bg-ink-300/20 text-ink-500 border-ink-300/30',
      'Lower Leg': 'bg-ink-300/20 text-ink-500 border-ink-300/30',
    };
    return tagColors[tag] || 'bg-ink-300/20 text-ink-500 border-ink-300/30';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4 sm:space-y-5', activeView === 'workout' && 'space-y-3')}>
      {/* Header — hide on mobile when in workout mode */}
      <div className={cn(activeView === 'workout' ? 'hidden sm:block' : '', 'flex items-center justify-between')}>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">{t('weeklyProgram')}</h1>
          <p className="text-ink-400 mt-1 text-sm">{t('subtitle')}</p>
        </div>
        {isAdmin && activeView !== 'workout' && (
          <Button onClick={() => setShowUploadForm(true)}>
            <Plus className="h-4 w-4" />
            {/* Was a bare English literal — the only Latin text on an otherwise
                fully Hebrew page, sitting right beside the translated heading. */}
            {t('newWeek')}
          </Button>
        )}
      </div>

      {/* Confirm attendance for the next team workout. This used to be its own
          אישור slot in the bottom bar, pointing at /dashboard — the page the
          Dashboard tab already opens. It lives here now, at the top of the
          training view, next to the week it's asking about.
          Renders nothing outside the day-before/day-of window, and nothing for a
          coach; deliberately not shown in the nutrition or gym views, which have
          nothing to do with turning up on Tuesday. */}
      {activeView === 'training' && <AttendanceConfirmCard />}

      {/* View Toggle — full width, sticky on mobile */}
      <div className={cn('flex flex-col gap-3', activeView === 'workout' && 'sticky top-0 z-30 bg-page -mx-4 px-4 pt-2 pb-3 sm:static sm:mx-0 sm:px-0 sm:pt-0 sm:pb-0 sm:bg-transparent')}>
        <SegmentedControl
          value={activeView}
          onChange={setActiveView}
          options={[
            { value: 'training', label: t('training'), icon: Dumbbell },
            { value: 'nutrition', label: t('nutrition'), icon: Utensils },
            { value: 'workout', label: t('gym'), icon: Play },
          ]}
        />

        {/* Week Picker trigger — only show for training/nutrition. Opens a
            native bottom sheet to choose a week, instead of an anchored
            web-style dropdown menu — the same "pick one from a list"
            pattern already used app-wide (impersonation chooser, role
            picker, etc). */}
        {activeView !== 'workout' && currentWeek && (
          <button
            onClick={() => setWeekPickerOpen(true)}
            className="flex items-center gap-3 bg-card/60 border border-page/60 rounded-card px-4 py-3.5 min-h-[44px] hover:border-ink-300 active:scale-[0.98] transition-all w-full sm:w-auto sm:min-w-[240px]"
          >
            <div className="flex-1 text-start">
              <div className="font-semibold text-ink-700">{currentWeek.week_number > 0 ? t('weekLabel', { n: currentWeek.week_number }) : t('trainingWeek')}</div>
              <div dir="ltr" className="text-xs text-ink-400 text-end">{currentWeek.date_range}</div>
            </div>
            {isCurrentWeek && (
              <span className="bg-accent-600/20 text-accent-600 text-xs px-2 py-0.5 rounded-full font-medium shrink-0">
                {t('current')}
              </span>
            )}
            {isRecentlyPublished(weekPlan?.publishedAt) && (
              <span className="bg-brand-600/20 text-brand-600 text-xs px-2 py-0.5 rounded-full font-bold shrink-0 animate-pulse">
                {t('newPlan')}
              </span>
            )}
            <ChevronDown className="h-4 w-4 text-ink-400 shrink-0" />
          </button>
        )}
      </div>

      {/* Week Picker Sheet — native list picker (grabber handle, swipe-to-
          dismiss, focus trap) replacing the old anchored dropdown menu. */}
      <Sheet open={weekPickerOpen} onOpenChange={setWeekPickerOpen} title={t('selectWeek')}>
        <div className="space-y-1.5">
          {weeks.map((week) => (
            <button
              key={week.id}
              onClick={() => { setSelectedStart(week.week_start_date); setWeekPickerOpen(false); }}
              className={cn(
                'w-full text-start px-4 py-3.5 min-h-[44px] rounded-xl flex items-center justify-between gap-3 transition-colors active:scale-[0.98]',
                week.week_start_date === selectedStart
                  ? 'bg-brand-600/20 border border-brand-600/40'
                  : 'border border-transparent hover:bg-page/50'
              )}
            >
              <div>
                <div className="font-semibold text-ink-700 text-sm">{week.week_number > 0 ? t('weekLabel', { n: week.week_number }) : t('trainingWeek')}</div>
                <div dir="ltr" className="text-xs text-ink-400 text-end">{week.date_range}</div>
              </div>
              {week.week_start_date === thisWeekStart && (
                <span className="bg-accent-600/20 text-accent-600 text-xs px-2 py-0.5 rounded-full font-medium shrink-0">
                  {t('current')}
                </span>
              )}
            </button>
          ))}
        </div>
      </Sheet>

      {/* THIS calendar week's plan status — mirrors the Saturday 20:00 "new week"
          push (training ✅/❌ · nutrition ✅/❌). Driven by the week that actually
          contains today, NOT the selected/most-recent week — so if no plan exists
          for the current week yet, both correctly read "missing". */}
      {activeView !== 'workout' && (() => {
        const cw = weeks.find(w => w.week_start_date === thisWeekStart);
        return (
          <InsetSection>
            <PlanStatusRow
              icon={Dumbbell}
              label={t('trainingProgram')}
              present={!!cw?.training_pdf_url || structuredWeekStarts.has(thisWeekStart)}
              isAdmin={isAdmin}
              onUpload={() => setShowUploadForm(true)}
              t={t}
            />
            <PlanStatusRow
              icon={Utensils}
              label={t('nutritionPlan')}
              present={!!cw?.nutrition_pdf_url}
              isAdmin={isAdmin}
              onUpload={() => setShowUploadForm(true)}
              t={t}
            />
          </InsetSection>
        );
      })()}

      {/* PDF Viewer or Workout Videos */}
      {activeView === 'workout' ? (
        <div className="space-y-3 sm:space-y-5">
          {/* Video Player — only show after selecting an exercise */}
          {currentExercise && (
          <div className="bg-card rounded-xl sm:rounded-xl border border-page overflow-hidden -mx-4 sm:mx-0 rounded-none sm:rounded-xl border-x-0 sm:border-x">
            <div className="w-full aspect-video bg-page relative">
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
                  <h3 className="text-base sm:text-lg font-bold text-ink-700 truncate">{currentExercise.name}</h3>
                </div>
                <div className="flex items-center gap-1 shrink-0 ms-2">
                  <button
                    onClick={handlePrevious}
                    disabled={currentFilteredIndex === 0}
                    className={cn(
                      'p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-all',
                      currentFilteredIndex === 0
                        ? 'text-ink-400 cursor-not-allowed'
                        : 'bg-page text-ink-700 active:scale-90'
                    )}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <span className="text-xs text-ink-400 font-bold min-w-[36px] text-center">
                    {currentFilteredIndex + 1}/{filteredExercises.length}
                  </span>
                  <button
                    onClick={handleNext}
                    disabled={currentFilteredIndex === filteredExercises.length - 1}
                    className={cn(
                      'p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-all',
                      currentFilteredIndex === filteredExercises.length - 1
                        ? 'text-ink-400 cursor-not-allowed'
                        : 'bg-page text-ink-700 active:scale-90'
                    )}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-ink-400 mt-1 line-clamp-2">{currentExercise.desc}</p>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-band-3/20 text-band-3 border border-band-3/30 font-bold">
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
                  'px-3 min-h-[44px] inline-flex items-center justify-center rounded-full text-xs font-semibold whitespace-nowrap transition-all shrink-0',
                  categoryFilter === key
                    ? CATEGORY_ACTIVE_CLASS[color]
                    : 'bg-card text-ink-400 border border-page'
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
                      ? 'border-band-3 bg-band-3/10'
                      : 'border-page bg-card/50'
                  )}
                >
                  <div className="relative w-28 sm:w-full aspect-square sm:aspect-[16/9] bg-page overflow-hidden shrink-0">
                    <img
                      src={`https://drive.google.com/thumbnail?id=${video.id}&sz=w400`}
                      alt={video.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                    {isSelected && (
                      <div className="absolute top-1.5 end-1.5 bg-band-3 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        Live
                      </div>
                    )}
                    {!isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-black/40 flex items-center justify-center">
                          <Play className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-ink-700 ms-0.5" />
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
                      isSelected ? 'text-band-3' : 'text-ink-700'
                    )}>
                      {video.name}
                    </h4>
                    <p className="text-[11px] text-ink-400 mt-1 line-clamp-2 leading-snug">
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
      ) : activeView === 'training' && weekPlanLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        </div>
      ) : activeView === 'training' && weekPlan?.hasPlan ? (
        <WeekClimb weekPlan={weekPlan} onSelectSession={setSelectedSession} t={t} />
      ) : currentWeek && getPdfUrl(currentWeek, activeView) ? (
        <div className="bg-card/60 rounded-card border border-page/60 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-page/60">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-ink-400" />
              <span className="text-sm font-medium">
                {activeView === 'training' ? t('trainingProgram') : t('nutritionPlan')} — <span dir="ltr">{currentWeek.date_range}</span>
              </span>
            </div>
            <a
              href={getPdfUrl(currentWeek, activeView)!}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('openInNewTab')}
            </a>
          </div>

          <div className="w-full" style={{ height: '80vh' }}>
            <iframe
              src={getPdfUrl(currentWeek, activeView)!}
              className="w-full h-full border-0"
              title={`${activeView} plan for Week ${currentWeek.week_number}`}
            />
          </div>
        </div>
      ) : currentWeek ? (
        <Card variant="muted">
          <EmptyState
            icon={activeView === 'training' ? Dumbbell : Utensils}
            title={activeView === 'training' ? t('noStructuredPlan') : t('noNutritionPlanYet')}
            description={t('planUploadSoon', { range: `‪${currentWeek.date_range}‬` })}
          />
        </Card>
      ) : (
        <Card variant="muted">
          <EmptyState
            icon={ClipboardList}
            title={t('noWeeks')}
            action={isAdmin ? (
              <Button onClick={() => setShowUploadForm(true)}>
                <Plus className="h-4 w-4" /> {t('addFirstWeek')}
              </Button>
            ) : undefined}
          />
        </Card>
      )}

      {/* Workout Detail Sheet — same rich step breakdown as the dashboard's
          weekly chart, for whichever day card was tapped. */}
      {selectedSession && (
        <WorkoutDetailModal
          session={selectedSession}
          viewGroup={viewGroup}
          onPickGroup={pickViewGroup}
          onClose={() => setSelectedSession(null)}
        />
      )}

      {/* Upload Modal */}
      {showUploadForm && (
        <UploadForm
          nextWeekNumber={weeks.length > 0 ? Math.max(0, ...weeks.map(w => w.week_number)) + 1 : 1}
          onClose={() => setShowUploadForm(false)}
          onSuccess={() => { setShowUploadForm(false); mutateWeeks(); mutatePlanWeeks(); }}
        />
      )}
    </div>
  );
}

// Given a Sunday ISO date, return the "DD.MM – DD.MM" Sunday→Saturday range.
function deriveDateRange(sundayISO: string): string {
  const sunday = new Date(sundayISO + 'T00:00:00');
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(sunday)} – ${fmt(saturday)}`;
}

function getPdfUrl(week: ProgramWeek, view: 'training' | 'nutrition' | 'workout'): string | null {
  if (view === 'workout') return null;
  return view === 'training' ? week.training_pdf_url : week.nutrition_pdf_url;
}

// The week rendered as an ascending/descending "climb" — Madregot means
// stairs, so each day is a step whose height reflects that day's real
// distance (a genuine hard/easy/hard week reads as an uneven climb, not a
// fake smooth ramp — we never reorder days to force a monotonic staircase).
// Replaces the old flat, uniform-row day list with real visual hierarchy:
// a hero stat row up top, then steps sized by intensity, today highlighted.
function WeekClimb({
  weekPlan,
  onSelectSession,
  t,
}: {
  weekPlan: WeekPlanResponse;
  onSelectSession: (s: WeekPlanSession) => void;
  t: (k: any, values?: any) => string;
}) {
  const todayDow = new Date().getDay();
  const totalKm = weekPlan.dailyDistances.reduce((sum, d) => sum + d.max, 0);
  const trainingDaysCount = weekPlan.dailyDistances.filter((d) => d.max > 0).length;
  const longest = Math.max(0, ...weekPlan.dailyDistances.map((d) => d.max));
  const weekMax = Math.max(longest, 1);
  const STEP_MIN = 8;
  const STEP_MAX = 48;

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-2xs font-bold uppercase tracking-wider text-brand-600/80 mb-3">
          {t('weekClimbTitle')}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <BigStat value={totalKm} label={t('weekKm')} />
          <BigStat value={trainingDaysCount} label={t('trainingDays')} />
          <BigStat value={longest} label={t('longestSession')} />
        </div>
      </Card>

      <InsetSection>
        {weekPlan.dailyDistances.map((d) => {
          const session = weekPlan.keySessions.find((s) => s.dayOfWeek === d.dayOfWeek);
          const hasWorkout = d.max > 0;
          const isToday = d.dayOfWeek === todayDow;
          const stepColor = WORKOUT_TYPE_COLORS[d.type] || '#159AFF';
          const stepHeight = hasWorkout
            ? Math.round(STEP_MIN + (d.max / weekMax) * (STEP_MAX - STEP_MIN))
            : STEP_MIN;

          return (
            <button
              key={d.dayOfWeek}
              onClick={() => session && onSelectSession(session)}
              disabled={!session}
              className={cn(
                'w-full flex items-center gap-3.5 px-4 py-3.5 min-h-[56px] text-start transition-colors',
                session && 'active:bg-page/40',
                isToday && 'bg-brand-600/[0.07]'
              )}
            >
              {/* Step indicator: a rail with a bar rising from the bottom,
                  height proportional to that day's real distance. */}
              <span className="relative w-6 shrink-0 self-stretch flex items-end justify-center py-1">
                <span className="absolute top-0 bottom-0 start-1/2 w-px -translate-x-1/2 bg-page/50" />
                <span
                  className="relative w-2 rounded-full"
                  style={{ height: stepHeight, background: hasWorkout ? stepColor : '#DFDFDF' }}
                />
              </span>

              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className={cn('text-[15px] font-semibold', isToday ? 'text-brand-600' : 'text-ink-700')}>
                    {d.day}
                  </span>
                  {isToday && (
                    <span className="text-2xs font-bold px-1.5 py-0.5 rounded-full bg-brand-600/20 text-brand-600 shrink-0">
                      {t('todayBadge')}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-ink-400 truncate mt-0.5">
                  {hasWorkout
                    ? `${WORKOUT_TYPE_LABELS[d.type] || d.type}${session?.highlight ? ' · ' + session.highlight : ''}`
                    : t('restDay')}
                </span>
              </span>

              {hasWorkout && (
                <span dir="ltr" className="text-[15px] font-bold text-ink-700 tabular-nums shrink-0">
                  {d.min !== d.max ? `${d.min}–${d.max}` : d.max}
                  <span className="text-xs text-ink-400 font-normal"> km</span>
                </span>
              )}
              {session && <ChevronLeft className="h-4 w-4 text-ink-400 shrink-0" />}
            </button>
          );
        })}
      </InsetSection>
    </div>
  );
}

// A single plan-status row (training / nutrition) — green when uploaded, red +
// upload action (admin only) when missing. Mirrors the Saturday 20:00 push.
// Rendered inside an InsetSection so it matches WeekClimb's inset-grouped list
// directly below it, instead of its own independently-styled card.
function PlanStatusRow({
  icon, label, present, isAdmin, onUpload, t,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  present: boolean;
  isAdmin: boolean;
  onUpload: () => void;
  t: (k: any) => string;
}) {
  return (
    <InsetRow
      icon={icon}
      iconBg={present ? 'bg-accent-600' : 'bg-accent-red'}
      label={label}
      sublabel={present ? t('planUploaded') : t('planMissing')}
      trailing={!present && isAdmin ? (
        <button
          onClick={onUpload}
          className="min-h-[44px] px-2 text-xs font-bold text-brand-600 hover:text-brand-700 transition-colors shrink-0"
        >
          {t('uploadArrow')}
        </button>
      ) : undefined}
    />
  );
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
  const t = useTranslations('program');
  const tc = useTranslations('common');
  const [weekNumber, setWeekNumber] = useState(nextWeekNumber);
  const [weekStartDate, setWeekStartDate] = useState('');
  const [trainingFile, setTrainingFile] = useState<File | null>(null);
  const [nutritionFile, setNutritionFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // The program runs Sunday → Saturday. The user only picks the Sunday; the
  // date range is always derived from it (Sun→Sat) so it can never be reversed
  // or mismatched — which is what created a bad, duplicate week row before.
  const dateRange = weekStartDate ? deriveDateRange(weekStartDate) : '';

  useEffect(() => {
    // Default to the upcoming Sunday.
    const now = new Date();
    const day = now.getDay();
    const sundayOffset = day === 0 ? 0 : 7 - day;
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + sundayOffset);
    setWeekStartDate(toISODate(nextSunday));
  }, []);

  // Snap any picked date back to the Sunday that starts its week, so the stored
  // week_start_date is always a Sunday regardless of what the user clicks.
  function handleStartDateChange(value: string) {
    if (!value) {
      setWeekStartDate('');
      return;
    }
    const picked = new Date(value + 'T00:00:00');
    const sunday = new Date(picked);
    sunday.setDate(picked.getDate() - picked.getDay()); // getDay() 0=Sun
    setWeekStartDate(toISODate(sunday));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trainingFile && !nutritionFile) {
      setError(t('uploadAtLeastOnePdf'));
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
      // bearerHeaders(false): no Content-Type, so fetch sets the multipart
      // boundary itself. POST is staff-gated by requireSession.
      const res = await fetch('/api/program-weeks', {
        method: 'POST',
        headers: await bearerHeaders(false),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} title={t('addNewWeek')}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <InsetSection>
            <InsetRow
              icon={Hash}
              label={t('weekNumberLabel')}
              trailing={
                <input
                  type="number"
                  value={weekNumber}
                  onChange={e => setWeekNumber(Number(e.target.value))}
                  min={1}
                  required
                  className="w-16 min-h-[44px] bg-transparent text-end text-[15px] font-medium text-ink-700 focus:outline-none"
                />
              }
            />
            <InsetRow
              icon={CalendarRange}
              label={t('dateRangeLabel')}
              value={dateRange || t('pickStartDatePlaceholder')}
            />
            <InsetRow
              icon={Calendar}
              label={t('weekStartDateLabel')}
              sublabel={t('weekStartDateHint')}
              trailing={
                <input
                  type="date"
                  value={weekStartDate}
                  onChange={e => handleStartDateChange(e.target.value)}
                  required
                  className="min-h-[44px] bg-transparent text-[15px] font-medium text-ink-700 focus:outline-none [color-scheme:dark]"
                />
              }
            />
            <InsetRow
              icon={Dumbbell}
              label={t('trainingProgram')}
              sublabel={trainingFile ? trainingFile.name : t('noFileSelected')}
              trailing={
                <label className="shrink-0 min-h-[44px] px-2 flex items-center text-xs font-bold text-brand-600 hover:text-brand-700 transition-colors cursor-pointer">
                  {t('choosePdf')}
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={e => setTrainingFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              }
            />
            <InsetRow
              icon={Utensils}
              label={t('nutritionPlan')}
              sublabel={nutritionFile ? nutritionFile.name : t('noFileSelected')}
              trailing={
                <label className="shrink-0 min-h-[44px] px-2 flex items-center text-xs font-bold text-brand-600 hover:text-brand-700 transition-colors cursor-pointer">
                  {t('choosePdf')}
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={e => setNutritionFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              }
            />
          </InsetSection>

          {error && (
            <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-accent-red text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={uploading} className="flex-1">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? t('uploading') : t('upload')}
            </Button>
          </div>
        </form>
    </Sheet>
  );
}
