'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Dumbbell, Utensils, FileText, ExternalLink, ChevronDown, Play, ChevronLeft, ChevronRight, Plus, Upload, Loader2, ClipboardList, Hash, Calendar, CalendarRange } from 'lucide-react';
import { cn, isRecentlyPublished, toISODate } from '@/lib/utils';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { useApi } from '@/lib/api';
import { getDisplayWeekStart, formatPlanWeekRange, planDayKey } from '@/lib/plans/workout-parsing';
import { WORKOUT_TYPE_COLORS, WORKOUT_TYPE_TEXT_COLORS, type WeekSession } from '@/lib/plans/workout-parsing';
import { sessionFrame, sessionHeadline, type FrameLabels } from '@/lib/plans/session-summary';
import { nameQualifier, roundKm, weekChart, weekStats } from '@/lib/plans/week-summary';
import type { StepUnits } from '@/lib/plans/step-display';
import { formatDurationClock } from '@/lib/workout-duration';
import { ltr, textDir } from '@/lib/bidi';
import { isEstimate } from '@/lib/plans/step-estimate';
import { Card, Button, EmptyState, SegmentedControl, Sheet, InsetSection, InsetRow, BigStat } from '@/components/ui';
import { WorkoutDetailModal, type WorkoutDetailSession } from '@/components/WorkoutDetailModal';
import { AttendanceConfirmCard } from '@/components/AttendanceConfirmCard';
import { scrollAppToTop } from '@/lib/app-scroll';

// pdf.js is ~350 KB gzipped on top of a 1.2 MB worker. Loaded on demand so it is
// fetched by someone who opened a plan, not by everyone who opens the app.
const PlanPdfViewer = dynamic(
  () => import('@/components/PlanPdfViewer').then(m => m.PlanPdfViewer),
  { ssr: false },
);

interface WeekPlanDay {
  day: string;
  dayOfWeek: number;
  min: number;
  max: number;
  type: string;
  sessions: Array<{ min: number; max: number; type: string; name: string }>;
}

interface WeekPlanResponse {
  hasPlan: boolean;
  weekStart: string;
  publishedAt?: string | null;
  dailyDistances: WeekPlanDay[];
  /** Every session of the week, in the order they are run — see `buildWeekSessions`. */
  sessions: WeekSession[];
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
  const [selectedSession, setSelectedSession] = useState<WorkoutDetailSession | null>(null);
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
        date_range: formatPlanWeekRange(ws),
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
        date_range: formatPlanWeekRange(thisWeekStart),
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
      'Legs': 'bg-band-2/20 text-band-2-ink border-band-2/30',
      'Glutes': 'bg-pink-500/20 text-pink-600 border-pink-500/30',
      'Core': 'bg-band-3/20 text-band-3-ink border-band-3/30',
      'Upper': 'bg-purple-500/20 text-purple-800 border-purple-500/30',
      'Prehab': 'bg-accent-600/20 text-accent-900 border-accent-600/30',
      'Compound': 'bg-accent-red/20 text-accent-red border-accent-red/30',
      'Unilateral': 'bg-band-3/20 text-band-3-ink border-band-3/30',
      'Strength': 'bg-ink-300/20 text-ink-500 border-ink-300/30',
      'Bodyweight': 'bg-teal-500/20 text-teal-600 border-teal-500/30',
      'Isolation': 'bg-indigo-500/20 text-indigo-600 border-indigo-500/30',
      'Balance': 'bg-band-2/20 text-band-2-ink border-band-2/30',
      'Stability': 'bg-accent-600/20 text-accent-900 border-accent-600/30',
      'Mobility': 'bg-lime-500/20 text-lime-600 border-lime-500/30',
      'Functional': 'bg-band-3/20 text-band-3-ink border-band-3/30',
      'Advanced': 'bg-accent-red/20 text-accent-red border-accent-red/30',
      'Calves': 'bg-band-2/20 text-band-2-ink border-band-2/30',
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
              <span className="bg-accent-600/20 text-accent-900 text-xs px-2 py-0.5 rounded-full font-medium shrink-0">
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
                <span className="bg-accent-600/20 text-accent-900 text-xs px-2 py-0.5 rounded-full font-medium shrink-0">
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
                  {/* Icon-only, so it needs a real name: the "3/12" counter beside
                      it is a separate span, and a screen reader announcing two
                      unnamed buttons around a bare fraction has nothing to work
                      with. `program.previous`/`program.next` already existed. */}
                  <button
                    onClick={handlePrevious}
                    aria-label={t('previous')}
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
                    aria-label={t('next')}
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
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-band-3/20 text-band-3-ink border border-band-3/30 font-bold">
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
                    scrollAppToTop();
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
        <WeekClimb weekPlan={weekPlan} onSelectSession={setSelectedSession} />
      ) : currentWeek && getPdfUrl(currentWeek, activeView) ? (
        /* Was a bare <iframe src={pdf}> — the browser's own viewer, which offers no
           zoom, and which on iOS shows a single static first page. The plan is five
           sheets of A4 landscape, so fit-to-width on a phone is 275px of table.
           PlanPdfViewer draws the pages itself and owns the zoom; it falls back to
           the iframe if pdf.js can't load. */
        <PlanPdfViewer
          url={getPdfUrl(currentWeek, activeView)!}
          title={`${activeView === 'training' ? t('trainingProgram') : t('nutritionPlan')} — ${currentWeek.date_range}`}
        />
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

function getPdfUrl(week: ProgramWeek, view: 'training' | 'nutrition' | 'workout'): string | null {
  if (view === 'workout') return null;
  return view === 'training' ? week.training_pdf_url : week.nutrition_pdf_url;
}

/** Pixels the tallest column in the week chart is allowed to reach. */
const CHART_HEIGHT = 80;

/**
 * The week rendered as an ascending/descending "climb" — Madregot means stairs,
 * so the chart's columns are sized by real distance (a genuine hard/easy/hard
 * week reads as an uneven climb; we never reorder days to force a smooth ramp).
 *
 * EVERY session is on this screen, each on its own row under the day it is run.
 * The version this replaces had one row per DAY, which on a double day summed
 * the two runs into a single number and a single tap target: Tuesday showed
 * "41.1 km" — a distance no one in the club runs, on a day no one runs it — and
 * the 20 × 500 m evening session behind that number could not be opened at all.
 * Monday's optional evening was invisible for the same reason, having no km of
 * its own to add.
 */
function WeekClimb({
  weekPlan,
  onSelectSession,
}: {
  weekPlan: WeekPlanResponse;
  onSelectSession: (s: WorkoutDetailSession) => void;
}) {
  const t = useTranslations('program');
  const tp = useTranslations('planner');
  const tc = useTranslations('common');
  const ta = useTranslations('activities');
  // Hebrew day names, from the same array the rest of the app reads. The
  // `dailyDistances[].day` this used to print is an English "Tue" baked in by
  // the parser, which is why the one Hebrew screen in the app had English
  // weekdays down its side.
  const dayNames = tc.raw('dayNames') as string[];
  const dayNamesShort = tc.raw('dayNamesShort') as string[];
  const units: StepUnits = {
    km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes'),
  };
  const frameLabels: FrameLabels = {
    ...units, warmup: tp('sectionWarmup'), cooldown: tp('sectionCooldown'),
  };

  const sessions = weekPlan.sessions;
  const stats = useMemo(() => weekStats(sessions), [sessions]);
  const columns = useMemo(() => weekChart(sessions, { heightPx: CHART_HEIGHT }), [sessions]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, dow) => ({
      dayOfWeek: dow,
      dateKey: planDayKey(weekPlan.weekStart, dow),
      sessions: sessions.filter((s) => s.dayOfWeek === dow),
    })),
    [sessions, weekPlan.weekStart],
  );
  // Compare DATES, not weekdays: the week on screen is whichever one the picker
  // is standing on, and "Tuesday" is a Tuesday in every one of them. -1 on every
  // week that isn't the current one, which is the point.
  const todayKey = toISODate(new Date());
  const todayIndex = days.findIndex((d) => d.dateKey === todayKey);

  const typeLabel = (type: string) => ta(`runType_${type}` as any);
  // Rounded HERE, at the edge where a number becomes text — the sessions
  // themselves keep their raw kilometres so the week total still adds up.
  const kmRange = (rawMin: number, rawMax: number) => {
    const min = roundKm(rawMin);
    const max = roundKm(rawMax);
    return min !== max ? `${min}–${max}` : `${max}`;
  };
  const kindLabel = (s: WeekSession) =>
    s.kind === 'morning' ? tp('sessionMorning')
    : s.kind === 'evening' ? tp('sessionEvening')
    : s.kind === 'part' ? tp('partLabel', { index: s.partIndex, count: s.partCount })
    : '';

  /** The row's own title: the main set, plus whatever the coach named it. */
  const sessionTitle = (s: WeekSession) => {
    const parts = [sessionHeadline(s.steps, units), nameQualifier(s.name, dayNames)].filter(Boolean);
    return parts.length ? parts.join(' · ') : s.name;
  };

  return (
    <div>
      <Card>
        <p className="text-2xs font-bold uppercase tracking-[0.08em] text-brand-600/85 mb-3">
          {t('weekClimbTitle')}
        </p>

        {/* Three numbers, hairline-separated. `longestSession` is the longest
            single session and names its day — it used to be a day's SUM. */}
        <div className="flex [&>*+*]:border-s [&>*+*]:border-page">
          <BigStat
            className="flex-1 px-1"
            valueClassName="text-2xl font-bold"
            value={<span dir="ltr">{kmRange(Math.round(stats.kmMin), Math.round(stats.kmMax))}</span>}
            label={t('weekKm')}
          />
          <BigStat
            className="flex-1 px-1"
            valueClassName="text-2xl font-bold"
            value={stats.sessionCount}
            label={t('sessionsAndDays', { days: stats.dayCount })}
          />
          <BigStat
            className="flex-1 px-1"
            valueClassName="text-2xl font-bold"
            value={<><bdi dir="ltr">{stats.longestKm}</bdi><span className="text-xs"> {units.km}</span></>}
            label={t('longestSessionOn', {
              day: stats.longestDayOfWeek >= 0 ? dayNames[stats.longestDayOfWeek] : '—',
            })}
          />
        </div>

        {/* One segment per SESSION, stacked. A single bar per day is what hid
            the evening runs. */}
        <div className="mt-3.5 mx-0.5 flex h-[116px] items-end gap-[5px]" aria-hidden="true">
          {columns.map((col) => (
            <div
              key={col.dayOfWeek}
              className="flex h-full flex-1 flex-col items-center justify-end"
            >
              <span
                dir="ltr"
                className={cn(
                  'mb-1 text-4xs tabular-nums',
                  col.dayOfWeek === todayIndex ? 'font-bold text-ink-900' : 'text-ink-400',
                )}
              >
                {col.hasWorkout ? `${col.leadKm || ''}${col.multi ? '+' : ''}` || '—' : '—'}
              </span>
              <span className="flex w-full flex-col justify-end gap-0.5">
                {col.segments.map((seg) => (
                  <i
                    key={seg.key}
                    className="block rounded-tile"
                    style={{
                      height: seg.heightPx,
                      background: WORKOUT_TYPE_COLORS[seg.type] || WORKOUT_TYPE_COLORS.easy,
                      opacity: seg.optional ? 0.5 : 1,
                    }}
                  />
                ))}
              </span>
              <span
                className={cn(
                  'mt-1.5 text-2xs',
                  col.dayOfWeek === todayIndex ? 'font-bold text-brand-600' : 'text-ink-400',
                )}
              >
                {dayNamesShort[col.dayOfWeek]}
              </span>
            </div>
          ))}
        </div>
        <div className="mx-0.5 h-px bg-page" />

        <div className="mx-0.5 mt-3 flex flex-wrap gap-x-2.5 gap-y-1.5">
          {stats.types.map((type) => (
            <span key={type} className="inline-flex items-center gap-1 text-4xs text-ink-400">
              <i
                className="block h-[7px] w-[7px] rounded-pill"
                style={{ background: WORKOUT_TYPE_COLORS[type] || WORKOUT_TYPE_COLORS.easy }}
              />
              {typeLabel(type)}
            </span>
          ))}
          {(stats.optionalDays.length > 0 || stats.hasKmlessSession) && (
            <span className="inline-flex items-center gap-1 text-4xs text-ink-400">
              <i className="block h-[7px] w-[7px] rounded-pill bg-ink-300" />
              {t('legendNoKm')}
            </span>
          )}
        </div>

        {/* What is not compulsory, said out loud — otherwise the week total is
            read as an obligation and this one is 16 km heavier than it is. */}
        {stats.optionalKmMax > 0 && (
          <p className="mt-2.5 text-center text-4xs text-ink-400">
            {t('optionalNote', {
              // Isolated: a bare "15–17" inside a Hebrew sentence renders "17–15".
              km: ltr(kmRange(Math.round(stats.optionalKmMin), Math.round(stats.optionalKmMax))),
              days: stats.optionalDays.map((d) => dayNames[d]).join(', '),
            })}
          </p>
        )}
      </Card>

      <p className="mx-1.5 mt-4 mb-1.5 text-2xs font-bold tracking-[0.06em] text-ink-400">
        {tp('sessionCount', { count: stats.sessionCount })}
      </p>

      {days.map((day) => {
        const isToday = day.dateKey === todayKey;
        const [, month, date] = day.dateKey.split('-');

        return (
          <div key={day.dayOfWeek} className="mb-2.5 overflow-hidden rounded-card bg-card">
            <div
              className={cn(
                'flex items-center justify-between px-3.5 pt-2.5 pb-2',
                isToday && 'bg-brand-600/[0.07]',
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
                {dayNames[day.dayOfWeek]}
                <span dir="ltr" className="text-4xs font-light text-ink-400 tabular-nums">
                  {Number(date)}.{Number(month)}
                </span>
                {isToday && (
                  <span className="rounded-pill bg-brand-600/[0.14] px-1.5 py-[3px] text-4xs font-bold leading-none text-brand-600">
                    {t('todayBadge')}
                  </span>
                )}
              </span>
              <span className="text-2xs text-ink-400">
                {day.sessions.length > 1
                  ? tp('sessionCount', { count: day.sessions.length })
                  : day.sessions.length === 0
                    ? t('restDay')
                    : ''}
              </span>
            </div>

            {day.sessions.map((s) => {
              const title = sessionTitle(s);
              const kind = kindLabel(s);
              const sub = sessionFrame(s.steps, frameLabels);
              const km = s.kmMax > 0 ? kmRange(s.kmMin, s.kmMax) : '';
              // A "~" when nobody wrote this distance down — it was multiplied
              // out of a stated time and a pace ("אופציה ל30-40 דק׳ קל" is 5–8 km
              // at this club's easy pace). Worth the one character: without it an
              // inferred 5–8 looks exactly like the 11–13 the coach typed on the
              // row above, and the athlete can't tell which is the plan.
              const kmApprox = Boolean(km) && isEstimate(s.kmFrom);
              const clock = formatDurationClock(s.durationSec);
              const color = WORKOUT_TYPE_COLORS[s.type] || WORKOUT_TYPE_COLORS.easy;

              return (
                <button
                  key={s.key}
                  onClick={() => onSelectSession({
                    name: title,
                    day: [dayNames[s.dayOfWeek], kind].filter(Boolean).join(' · '),
                    distance: km ? `${kmApprox ? '~' : ''}${km} ${units.km}` : '',
                    duration: clock,
                    steps: s.steps,
                  })}
                  className="flex w-full items-center gap-[11px] border-t border-page px-3.5 py-2.5 text-start transition-colors active:bg-page/40"
                >
                  <span
                    className="min-h-[34px] w-1 shrink-0 self-stretch rounded-pill"
                    style={{ background: color, opacity: s.optional ? 0.5 : 1 }}
                  />

                  <span className="min-w-0 flex-1">
                    <span
                      className="block text-4xs font-bold"
                      style={{ color: WORKOUT_TYPE_TEXT_COLORS[s.type] || WORKOUT_TYPE_TEXT_COLORS.easy }}
                    >
                      {[typeLabel(s.type), kind, s.optional ? tp('sessionOptional') : ''].filter(Boolean).join(' · ')}
                    </span>
                    {/* "20 × 500 מ׳" is an LTR expression with a Hebrew unit on
                        the end. Unmarked, bidi rule N1 flips it to "מ׳ 500 × 20"
                        — still a plausible workout, which is what makes it worth
                        marking. A prose note stays RTL, hence `textDir`. */}
                    <span className="mt-0.5 block text-sm font-bold text-ink-900">
                      <bdi dir={textDir(title)}>{title}</bdi>
                    </span>
                    {sub && (
                      <span className="mt-0.5 block truncate text-2xs text-ink-400">
                        <bdi dir={textDir(sub)}>{sub}</bdi>
                      </span>
                    )}
                  </span>

                  <span className="shrink-0 text-end">
                    {km ? (
                      <>
                        {/* The number is isolated and the unit is not, so an RTL
                            row lays them out as "23.5 ק״מ" and not "ק״מ 23.5". */}
                        <span className="block text-base font-bold text-ink-900 tabular-nums">
                          <bdi dir="ltr">{kmApprox ? `~${km}` : km}</bdi>
                          <span className="text-4xs font-light text-ink-400"> {units.km}</span>
                        </span>
                        {clock && (
                          <span dir="ltr" className="mt-px block text-4xs text-ink-400 tabular-nums">{clock}</span>
                        )}
                      </>
                    ) : (
                      // No distance at all — "30-40 min easy or strength". Its
                      // time is the only size it has, so the time takes the
                      // number's place instead of leaving the row blank.
                      <span className="block text-13 text-ink-400 tabular-nums">
                        <bdi dir="ltr">{Math.round(s.durationSec / 60)}</bdi> {units.min}
                      </span>
                    )}
                  </span>

                  <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// A single plan-status row (training / nutrition) — green when uploaded, red +
// upload action (admin only) when missing. Mirrors the Saturday 20:00 push.
// Rendered inside an InsetSection so the two rows read as one grouped list
// instead of two independently-styled cards.
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
  const dateRange = weekStartDate ? formatPlanWeekRange(weekStartDate) : '';

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
            <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-3 text-accent-red-ink text-sm">
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
