'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import {
  Upload,
  FileText,
  Loader2,
  Send,
  Edit3,
  Calendar,
  X,
  Search,
  Users,
  UserCheck,
  Layers,
  CheckCircle,
  XCircle,
  RotateCcw,
  Save,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Plus,
  Watch,
  RefreshCw,
  ClipboardList,
  Sparkles,
  Image as ImageIcon,
  Check,
} from 'lucide-react';
import { WeekView } from '@/components/WeekView';
import { WorkoutEditorPanel } from '@/components/WorkoutEditor';
import { ParsedWorkout, ParsedWeeklyPlan, GroupedWeeklyPlans, WorkoutStep } from '@/lib/ai/types';
import { splitIntoGroups, mergeGroupsToUnified, applyUnifiedEditsToGroups } from '@/lib/ai/splitGroups';
import { cn, toISODate, activityLocalDay, formatActivityTime } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Sheet, ConfirmSheet, SegmentedControl, Button, InsetSection, InsetRow } from '@/components/ui';

const HARDCODED_COACH_ID = '30f056a7-c651-490e-8356-615ea9eff097';

type PushTab = 'all' | 'groups' | 'athletes';

interface SavedPlanSummary {
  id: string;
  week_start_date: string;
  status: 'draft' | 'pushed' | 'partial';
  created_at: string;
  parsed_workouts: GroupedWeeklyPlans | ParsedWeeklyPlan;
  // No `original_input`: /api/plans stopped sending it (nothing here ever read
  // it), so declaring it would describe a field that is never present.
}

interface Athlete {
  id: string;
  name: string;
  email?: string;
  group_id?: string;
  status: string;
  hasGarmin?: boolean;
  hasStrava?: boolean;
}

interface Group {
  id: string;
  name: string;
  level?: string;
  marathonGoal?: string;
  paceOffsetSeconds?: number;
  athlete_count?: number;
  athleteCount?: number;
}

interface PushResultItem {
  athleteId: string;
  athleteName: string;
  status: 'success' | 'failed';
  error?: string;
}

interface MatchReviewData {
  workouts: ParsedWorkout[];
  activities: Array<{
    id: string;
    athlete_id: string;
    start_time: string;
    activity_name: string | null;
    distance: number | null;
  }>;
  matches: Array<{
    activity_id: string;
    workout_key: string;
    match_method: 'auto' | 'manual';
    score: number | null;
  }>;
  athletes: Array<{ id: string; name: string }>;
  // False when activity_plan_matches (migration 054) isn't applied — the route
  // still returns the week's activities, but nothing can be matched or saved.
  matchesAvailable?: boolean;
}

/**
 * How far from its planned day a run may still be offered as a candidate for a
 * workout. Kept equal to MAX_DAY_DELTA in lib/plans/activity-matcher, so a coach
 * can hand-confirm exactly the pairings the automatic matcher considers — before,
 * a session moved by a day could be auto-matched but not manually re-pointed,
 * and its name rendered as a raw workout key.
 */
const MATCH_DAY_TOLERANCE = 1;

function matchCandidates(workouts: ParsedWorkout[], startTime: string): ParsedWorkout[] {
  const day = activityLocalDay(startTime);
  return workouts
    .filter((workout) => Math.abs(workout.dayOfWeek - day) <= MATCH_DAY_TOLERANCE)
    .sort((a, b) => Math.abs(a.dayOfWeek - day) - Math.abs(b.dayOfWeek - day));
}

function getCurrentWeekSunday(offset: number = 0): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dayOfWeek + offset * 7);
  return toISODate(sunday);
}

function isSaturday(): boolean {
  return new Date().getDay() === 6;
}

function getDefaultOffset(): number {
  return isSaturday() ? 1 : 0;
}

function getWeekLabel(dateStr: string, locale: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const endDate = new Date(date);
  endDate.setDate(date.getDate() + 6);
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
  const startLabel = date.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
  const endLabel = endDate.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

function ErrorBanner({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn('bg-accent-red/10 border border-accent-red/30 rounded-lg p-4 text-accent-red-ink text-sm', className)}>
      {message}
    </div>
  );
}

export default function WeeklyPlannerPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('planner');
  const tDays = useTranslations('activities');
  const locale = useLocale();
  const DAY_LABELS = [
    tDays('daySun'), tDays('dayMon'), tDays('dayTue'), tDays('dayWed'),
    tDays('dayThu'), tDays('dayFri'), tDays('daySat'),
  ];

  // --- Week navigation ---
  const [weekOffset, setWeekOffsetState] = useState(() => {
    const w = searchParams.get('week');
    return w ? parseInt(w, 10) : getDefaultOffset();
  });

  const setWeekOffset = (val: number | ((prev: number) => number)) => {
    setWeekOffsetState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      const params = new URLSearchParams(window.location.search);
      if (next === getDefaultOffset()) params.delete('week');
      else params.set('week', String(next));
      const qs = params.toString();
      router.replace(`/dashboard/plan/new${qs ? `?${qs}` : ''}`, { scroll: false });
      return next;
    });
  };

  const weekStartDate = getCurrentWeekSunday(weekOffset);
  const weekLabel = getWeekLabel(weekStartDate, locale);

  // --- Plans data ---
  // The displayed week only, not the season: `parsed_workouts` is ~22 KB a week,
  // and this list's sole reader is the `.find` below. Fetching every week cost
  // 245 KB on mount and grew with the season, to render one of them.
  const [weekPlans, setWeekPlans] = useState<SavedPlanSummary[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  // --- Current week plan ---
  const currentPlan = useMemo(
    () => weekPlans.find((p) => p.week_start_date === weekStartDate) || null,
    [weekPlans, weekStartDate]
  );

  // --- Create mode (only when no plan exists; auto-open on Saturday for next week) ---
  const [showCreate, setShowCreate] = useState(() => isSaturday());
  const [inputText, setInputText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  // --- Review/Edit mode ---
  const [editMode, setEditMode] = useState(false);
  const [groupedPlans, setGroupedPlans] = useState<GroupedWeeklyPlans | null>(null);
  const [activeGroup, setActiveGroup] = useState<1 | 2 | 3>(1);
  const [parsedPlan, setParsedPlan] = useState<ParsedWeeklyPlan | null>(null);
  const [showClipboardReview, setShowClipboardReview] = useState(false);
  const [clipboardWorkoutIndex, setClipboardWorkoutIndex] = useState(0);
  const [clipboardPreview, setClipboardPreview] = useState<string | null>(null);
  const [clipboardText, setClipboardText] = useState('');
  const [clipboardLoading, setClipboardLoading] = useState(false);
  const [clipboardInstruction, setClipboardInstruction] = useState('');
  const [clipboardRefineScope, setClipboardRefineScope] = useState<'current' | 'all'>('all');
  const [clipboardEditing, setClipboardEditing] = useState(false);
  const [showMatchReview, setShowMatchReview] = useState(false);
  const [matchReview, setMatchReview] = useState<MatchReviewData | null>(null);
  const [matchReviewLoading, setMatchReviewLoading] = useState(false);
  // Sheet-based picker for the activity → workout match — replaces the raw <select>.
  const [matchPickerActivityId, setMatchPickerActivityId] = useState<string | null>(null);

  // --- Save state ---
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);

  // --- Delete ---
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // --- Sync-from-program overwrite confirmation ---
  const [confirmSyncFromProgram, setConfirmSyncFromProgram] = useState(false);

  // --- Push ---
  const [showPush, setShowPush] = useState(false);
  const [pushTab, setPushTab] = useState<PushTab>('all');
  // Which days to send. null = whole week (default); an array = only those days.
  const [pushDays, setPushDays] = useState<number[] | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingAthletes, setLoadingAthletes] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [athleteSearch, setAthleteSearch] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushResults, setPushResults] = useState<PushResultItem[] | null>(null);
  // Which group is expanded in the "All Athletes" tab to reveal its members.
  const [expandedAllGroup, setExpandedAllGroup] = useState<string | null>(null);

  // --- This week's uploaded program PDF (source material shown while planning) ---
  const [programPdfUrl, setProgramPdfUrl] = useState<string | null>(null);
  const [showProgramViewer, setShowProgramViewer] = useState(false);

  // --- Error ---
  const [error, setError] = useState<string | null>(null);

  // --- Derived ---
  const hasInput = inputText.trim().length > 0 || imageFile !== null;

  const activeAthletes = useMemo(
    () => athletes.filter((a) => a.status === 'active'),
    [athletes]
  );

  const filteredAthletes = useMemo(() => {
    if (!athleteSearch.trim()) return activeAthletes;
    const q = athleteSearch.toLowerCase();
    return activeAthletes.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.email?.toLowerCase().includes(q)
    );
  }, [activeAthletes, athleteSearch]);

  const pushTargetCount = useMemo(() => {
    if (pushTab === 'all') return activeAthletes.length;
    if (pushTab === 'groups') {
      return activeAthletes.filter(
        (a) => a.group_id && selectedGroupIds.includes(a.group_id)
      ).length;
    }
    return selectedAthleteIds.length;
  }, [pushTab, activeAthletes, selectedGroupIds, selectedAthleteIds]);

  // --- Reset create mode when navigating weeks ---
  useEffect(() => {
    setShowCreate(isSaturday() && weekOffset === 1);
    setError(null);
  }, [weekOffset]);

  // --- Fetch the displayed week's plan ---
  // Re-runs on week navigation rather than fetching once, which is the trade the
  // `week_start_date` narrowing buys: one ~22 KB request per week actually looked
  // at, instead of one 245 KB request for weeks nobody opens. `cancelled` guards
  // the races that per-week fetching introduces — arrowing through weeks quickly
  // could otherwise land an older response on top of a newer one.
  useEffect(() => {
    let cancelled = false;
    const fetchPlans = async () => {
      setLoadingPlans(true);
      try {
        const res = await fetch(
          `/api/plans?coach_id=${HARDCODED_COACH_ID}&week_start_date=${weekStartDate}`,
          { headers: await bearerHeaders(false) },
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setWeekPlans(data.plans || []);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoadingPlans(false);
      }
    };
    fetchPlans();
    return () => { cancelled = true; };
  }, [weekStartDate]);

  // --- Find this week's uploaded training program PDF (Sunday-keyed) ---
  useEffect(() => {
    let cancelled = false;
    setProgramPdfUrl(null);
    setShowProgramViewer(false);
    const fetchProgram = async () => {
      try {
        const res = await fetch('/api/program-weeks');
        if (!res.ok) return;
        const weeks = await res.json();
        const match = Array.isArray(weeks)
          ? weeks.find((w: any) => w.week_start_date === weekStartDate)
          : null;
        if (!cancelled) setProgramPdfUrl(match?.training_pdf_url || null);
      } catch {
        // silent — the program preview is a convenience, not required
      }
    };
    fetchProgram();
    return () => {
      cancelled = true;
    };
  }, [weekStartDate]);

  // --- Load plan into editor when current plan changes ---
  useEffect(() => {
    if (currentPlan) {
      const workouts = currentPlan.parsed_workouts;
      if ('group1' in workouts && 'group2' in workouts && 'group3' in workouts) {
        const grouped = workouts as GroupedWeeklyPlans;
        // Self-heal plans saved before the repeat-block offset fix: back then
        // Group ❷/❸ came out identical to Group ❶. If the stored groups are all
        // identical, re-split from group1 (which holds the coach's ❶ paces,
        // so this is lossless). Plans with real per-group edits differ and are
        // left exactly as saved.
        const g1 = JSON.stringify(grouped.group1.workouts);
        const identical =
          JSON.stringify(grouped.group2.workouts) === g1 &&
          JSON.stringify(grouped.group3.workouts) === g1;
        const effective = identical ? splitIntoGroups(grouped.group1) : grouped;
        setGroupedPlans(effective);
        // The unified editor shows ONE view where a step's own value is
        // Group ❶ and (Group ❷)/((Group ❸)) only appear where they actually
        // differ — mergeGroupsToUnified reconstructs that from the three
        // already-split group plans (see splitGroups.ts for the round-trip
        // guarantee this depends on).
        setParsedPlan(mergeGroupsToUnified(effective));
      } else {
        const parsed = workouts as ParsedWeeklyPlan;
        setParsedPlan(parsed);
        setGroupedPlans(splitIntoGroups(parsed));
      }
      setSavedPlanId(currentPlan.id);
      setLastSavedAt(new Date(currentPlan.created_at));
      setShowCreate(false);
      setEditMode(false);
    } else {
      setGroupedPlans(null);
      setParsedPlan(null);
      setSavedPlanId(null);
      setLastSavedAt(null);
      setEditMode(false);
    }
  }, [currentPlan]);

  // --- Fetch athletes when push modal opens ---
  useEffect(() => {
    if (!showPush) return;
    const fetchData = async () => {
      setLoadingAthletes(true);
      try {
        const [athRes, grpRes] = await Promise.all([
          fetch(`/api/athletes?coach_id=${HARDCODED_COACH_ID}`),
          fetch(`/api/groups?coach_id=${HARDCODED_COACH_ID}`),
        ]);
        if (athRes.ok) {
          const data = await athRes.json();
          setAthletes(data.athletes || []);
        }
        if (grpRes.ok) {
          const data = await grpRes.json();
          setGroups(data.groups || []);
        }
      } catch {
        // silent
      } finally {
        setLoadingAthletes(false);
      }
    };
    fetchData();
  }, [showPush]);

  // --- Handlers ---

  // Shared by file-input, drag-drop, and clipboard paste — the three ways a
  // plan image/PDF can arrive.
  const acceptFile = useCallback((file: File) => {
    setImageFile(file);
    if (file.type === 'application/pdf') {
      setImagePreview('pdf');
    } else {
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      acceptFile(file);
    },
    [acceptFile]
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/') || file.type === 'application/pdf') {
      acceptFile(file);
    }
  }, [acceptFile]);

  // The textarea's own placeholder says "Paste your plan" — a screenshot
  // pasted from the clipboard (the single most common way a coach's plan
  // photo reaches this screen) has no text representation, so without this
  // handler it silently does nothing: no text appears, imageFile stays null,
  // hasInput stays false, and the parse button just never enables. Runs only
  // when the clipboard actually contains an image/PDF file — a normal text
  // paste still falls through to the textarea's default behavior.
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/') || item.type === 'application/pdf') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          acceptFile(file);
        }
        return;
      }
    }
  }, [acceptFile]);

  const removeFile = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    const input = document.getElementById('file-upload-input') as HTMLInputElement | null;
    if (input) input.value = '';
  }, []);

  // Guards against the parse request hanging forever client-side (observed in
  // production: the Claude call stalled past Vercel's own function timeout and
  // the fetch() promise never settled, leaving the "parsing" screen up with no
  // way out short of reloading). 150s comfortably exceeds normal parse time
  // but still gives up well before an athlete assumes the app is broken.
  const parseAbortRef = useRef<AbortController | null>(null);
  const manualCancelRef = useRef(false);
  // Distinguishes the two network calls behind the "Parsing your plan..."
  // screen: the AI parse itself, then saving the result. Without this the
  // screen shows the same static text through both — a slow save (confirmed
  // in production logs: 56s from parse-workout 200 to plans 201) looks
  // identical to a hung request.
  const [savingAfterParse, setSavingAfterParse] = useState(false);

  const cancelParsing = useCallback(() => {
    manualCancelRef.current = true;
    parseAbortRef.current?.abort();
    setParsing(false);
    setSavingAfterParse(false);
    setError(null);
  }, []);

  const parsePlan = async () => {
    setError(null);
    setParsing(true);
    setSavingAfterParse(false);

    const controller = new AbortController();
    parseAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 150_000);

    try {
      const body: Record<string, string> = {};

      if (imageFile) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.readAsDataURL(imageFile);
        });
        body.image = base64;
        body.imageMediaType = imageFile.type;
      }

      if (inputText.trim()) {
        body.text = inputText;
      }

      const res = await fetch('/api/parse-workout', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // On a serverless timeout/crash Vercel returns an HTML/text error page,
      // not JSON — so read the body as text and parse defensively. Blindly
      // calling res.json() there throws "Unexpected token 'A'..." and hides the
      // real problem (the AI parse taking too long).
      const raw = await res.text();
      let parsedBody: any = null;
      try {
        parsedBody = raw ? JSON.parse(raw) : null;
      } catch {
        // non-JSON body (platform error page)
      }

      if (!res.ok) {
        if (parsedBody?.error) throw new Error(parsedBody.error);
        if (res.status === 504) {
          throw new Error(t('errors.parsingTimedOut'));
        }
        throw new Error(t('errors.failedToParseServer', { status: res.status }));
      }

      if (!parsedBody) {
        throw new Error(t('errors.unexpectedResponse'));
      }

      const data: ParsedWeeklyPlan = parsedBody;
      setParsedPlan(data);
      const grouped = splitIntoGroups(data);
      setGroupedPlans(grouped);

      // Save immediately
      setSavingAfterParse(true);
      const saveRes = await fetch('/api/plans', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({
          coach_id: HARDCODED_COACH_ID,
          week_start_date: weekStartDate,
          original_input: inputText || (imageFile ? `[Image: ${imageFile.name}]` : ''),
          parsed_workouts: grouped,
          status: 'draft',
        }),
        signal: controller.signal,
      });

      if (saveRes.ok) {
        const saveData = await saveRes.json();
        setSavedPlanId(saveData.plan.id);
        setLastSavedAt(new Date());
        // Filter by id first, same as the import path below. POST /api/plans is
        // check-then-update, so re-saving a week returns the id already in `prev`
        // — and now that this list holds only the displayed week, a duplicate row
        // is one `currentPlan` could pick either way.
        setWeekPlans((prev) => [saveData.plan, ...prev.filter((p) => p.id !== saveData.plan.id)]);
      }

      setShowCreate(false);
      setInputText('');
      setImageFile(null);
      setImagePreview(null);
    } catch (err: unknown) {
      const wasManualCancel = manualCancelRef.current;
      manualCancelRef.current = false;
      if (!wasManualCancel) {
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        setError(isAbort ? t('errors.parsingTimedOut') : err instanceof Error ? err.message : t('errors.unexpectedError'));
      }
    } finally {
      clearTimeout(timeoutId);
      setParsing(false);
      setSavingAfterParse(false);
    }
  };

  // Pull this week's uploaded training PDF from the Program page, parse it, and
  // save it as the planner's plan for the week. Confirms before overwriting an
  // existing plan so manual edits/pushes aren't silently lost.
  const syncFromProgram = () => {
    if (currentPlan) {
      setConfirmSyncFromProgram(true);
      return;
    }
    void doSyncFromProgram();
  };

  const doSyncFromProgram = async () => {
    setError(null);
    setParsing(true);
    try {
      const res = await fetch('/api/plans/sync-from-program', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ week_start_date: weekStartDate }),
      });

      const raw = await res.text();
      let parsedBody: any = null;
      try {
        parsedBody = raw ? JSON.parse(raw) : null;
      } catch {
        // non-JSON (platform error page)
      }

      if (!res.ok) {
        if (parsedBody?.error) throw new Error(parsedBody.error);
        if (res.status === 504) {
          throw new Error(t('errors.parsingTimedOutProgram'));
        }
        throw new Error(t('errors.failedToSyncServer', { status: res.status }));
      }
      if (!parsedBody) {
        throw new Error(t('errors.unexpectedResponse'));
      }

      const data: ParsedWeeklyPlan = parsedBody;
      const grouped = splitIntoGroups(data);
      setParsedPlan(data);
      setGroupedPlans(grouped);

      // If a plan already exists, replace it in place; otherwise create a new one.
      if (currentPlan && savedPlanId) {
        const putRes = await fetch('/api/plans', {
          method: 'PUT',
          headers: await bearerHeaders(),
          body: JSON.stringify({ plan_id: savedPlanId, parsed_workouts: grouped, status: 'draft' }),
        });
        if (putRes.ok) {
          setLastSavedAt(new Date());
          setWeekPlans((prev) =>
            prev.map((p) => (p.id === savedPlanId ? { ...p, parsed_workouts: grouped, status: 'draft' } : p))
          );
        }
      } else {
        const saveRes = await fetch('/api/plans', {
          method: 'POST',
          headers: await bearerHeaders(),
          body: JSON.stringify({
            coach_id: HARDCODED_COACH_ID,
            week_start_date: weekStartDate,
            original_input: `Synced from program (${parsedBody.dateRange || weekLabel})`,
            parsed_workouts: grouped,
            status: 'draft',
          }),
        });
        if (saveRes.ok) {
          const saveData = await saveRes.json();
          setSavedPlanId(saveData.plan.id);
          setLastSavedAt(new Date());
          setWeekPlans((prev) => [saveData.plan, ...prev.filter((p) => p.id !== saveData.plan.id)]);
        }
      }

      setShowCreate(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.failedToSyncProgram'));
    } finally {
      setParsing(false);
    }
  };

  // Main unified editor — one workout list where a step's own pace is Group
  // ❶ and (Group ❷)/((Group ❸)) only appear where they actually differ.
  // groupedPlans is re-derived from this immediately after every edit so
  // saving/pushing/Clipboard Studio (all still genuinely per-group) keep
  // working against correct, current data.
  const handleWorkoutChange = (index: number, workout: ParsedWorkout) => {
    if (!parsedPlan || !groupedPlans) return;
    const newWorkouts = [...parsedPlan.workouts];
    newWorkouts[index] = workout;
    const updatedUnified = { ...parsedPlan, workouts: newWorkouts };
    setParsedPlan(updatedUnified);
    setGroupedPlans(applyUnifiedEditsToGroups(groupedPlans, updatedUnified));
  };

  // Clipboard Studio edits ONE group's already-split, publish-ready steps
  // directly (cosmetic tweaks for that group's own image/text) — deliberately
  // NOT routed through the unified editor above, since a single-group tweak
  // here isn't "this group's pace differs from the others," it's "this
  // group's clipboard rendering needs a fix."
  const handleClipboardWorkoutChange = (workoutIndex: number, workout: ParsedWorkout) => {
    if (!groupedPlans) return;
    const groupKey = `group${activeGroup}` as keyof GroupedWeeklyPlans;
    const newWorkouts = [...groupedPlans[groupKey].workouts];
    newWorkouts[workoutIndex] = workout;
    setGroupedPlans({ ...groupedPlans, [groupKey]: { workouts: newWorkouts } });
  };

  const loadClipboardPreview = useCallback(async (workout: ParsedWorkout) => {
    if (!savedPlanId) return;
    setClipboardLoading(true);
    try {
      const res = await fetch(`/api/plans/${savedPlanId}/clipboards`, {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ action: 'preview', workout }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || t('errors.failedToRenderClipboard'));
      setClipboardPreview(body.previewDataUrl || null);
      setClipboardText(body.clipboardText || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.failedToRenderClipboard'));
    } finally {
      setClipboardLoading(false);
    }
  }, [savedPlanId, t]);

  useEffect(() => {
    if (!showClipboardReview || !groupedPlans) return;
    const workouts = groupedPlans[`group${activeGroup}`].workouts;
    const safeIndex = Math.min(clipboardWorkoutIndex, Math.max(0, workouts.length - 1));
    if (safeIndex !== clipboardWorkoutIndex) {
      setClipboardWorkoutIndex(safeIndex);
      return;
    }
    const workout = workouts[safeIndex];
    if (workout) void loadClipboardPreview(workout);
  }, [
    activeGroup,
    clipboardWorkoutIndex,
    groupedPlans,
    loadClipboardPreview,
    showClipboardReview,
  ]);

  const refineClipboard = async () => {
    if (!groupedPlans || !savedPlanId || !clipboardInstruction.trim()) return;
    setClipboardLoading(true);
    setError(null);
    try {
      const groupsToRefine = clipboardRefineScope === 'all'
        ? ([1, 2, 3] as const)
        : ([activeGroup] as const);
      const next = structuredClone(groupedPlans);
      let activePreview: { previewDataUrl?: string; clipboardText?: string } | null = null;
      for (const group of groupsToRefine) {
        const workout = next[`group${group}`].workouts[clipboardWorkoutIndex];
        if (!workout) continue;
        const res = await fetch(`/api/plans/${savedPlanId}/clipboards`, {
          method: 'POST',
          headers: await bearerHeaders(),
          body: JSON.stringify({
            action: 'refine',
            workout,
            instruction: clipboardInstruction.trim(),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || t('errors.couldNotRefineGroup', { group }));
        next[`group${group}`].workouts[clipboardWorkoutIndex] = body.workout;
        if (group === activeGroup) activePreview = body;
      }
      setGroupedPlans(next);
      setParsedPlan(next.group1);
      setClipboardInstruction('');
      if (activePreview) {
        setClipboardPreview(activePreview.previewDataUrl || null);
        setClipboardText(activePreview.clipboardText || '');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.couldNotRefineClipboard'));
    } finally {
      setClipboardLoading(false);
    }
  };

  const publishClipboards = async () => {
    if (!groupedPlans || !savedPlanId) return;
    setClipboardLoading(true);
    setError(null);
    try {
      const saveRes = await fetch('/api/plans', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({
          plan_id: savedPlanId,
          parsed_workouts: groupedPlans,
          status: 'draft',
        }),
      });
      if (!saveRes.ok) throw new Error(t('errors.couldNotSaveReviewed'));

      const res = await fetch(`/api/plans/${savedPlanId}/clipboards`, {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ action: 'publish' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || t('errors.clipboardPublishingFailed'));
      const published = body.plan.parsed_workouts as GroupedWeeklyPlans;
      setGroupedPlans(published);
      setParsedPlan(published.group1);
      setWeekPlans((prev) =>
        prev.map((plan) =>
          plan.id === savedPlanId
            ? { ...plan, parsed_workouts: published, status: 'pushed' }
            : plan,
        ),
      );
      setLastSavedAt(new Date());
      setShowClipboardReview(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.clipboardPublishingFailed'));
    } finally {
      setClipboardLoading(false);
    }
  };

  const loadMatchReview = useCallback(async () => {
    if (!savedPlanId) return;
    setMatchReviewLoading(true);
    try {
      const res = await fetch(`/api/plans/${savedPlanId}/matches`, {
        headers: await bearerHeaders(false),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || t('errors.couldNotLoadMatches'));
      setMatchReview(body as MatchReviewData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.couldNotLoadMatches'));
    } finally {
      setMatchReviewLoading(false);
    }
  }, [savedPlanId, t]);

  useEffect(() => {
    if (showMatchReview) void loadMatchReview();
  }, [loadMatchReview, showMatchReview]);

  const setManualMatch = async (activityId: string, workoutKey: string | null) => {
    if (!savedPlanId) return;
    setMatchReviewLoading(true);
    try {
      const res = await fetch(`/api/plans/${savedPlanId}/matches`, {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({ activityId, workoutKey }),
      });
      const body = await res.json();
      // 503 = activity_plan_matches (migration 054) isn't applied. Retrying can't
      // help, so say so once in the panel instead of raising a failure toast the
      // coach would keep hitting.
      if (res.status === 503) {
        setMatchReview(prev => (prev ? { ...prev, matchesAvailable: false } : prev));
        setMatchReviewLoading(false);
        return;
      }
      if (!res.ok) throw new Error(body.error || t('errors.couldNotUpdateMatch'));
      await loadMatchReview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.couldNotUpdateMatch'));
      setMatchReviewLoading(false);
    }
  };

  const saveDraft = async () => {
    if (!groupedPlans || !savedPlanId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/plans', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({
          plan_id: savedPlanId,
          parsed_workouts: groupedPlans,
          status: 'draft',
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t('errors.failedToSaveDraft'));
      }
      setLastSavedAt(new Date());
      setWeekPlans((prev) =>
        prev.map((p) => (p.id === savedPlanId ? { ...p, parsed_workouts: groupedPlans } : p))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.failedToSaveDraft'));
    } finally {
      setSaving(false);
    }
  };

  const deletePlan = async () => {
    if (!savedPlanId) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/plans', {
        method: 'DELETE',
        headers: await bearerHeaders(),
        body: JSON.stringify({ plan_id: savedPlanId }),
      });
      if (!res.ok) throw new Error(t('errors.failedToDeletePlan'));
      setWeekPlans((prev) => prev.filter((p) => p.id !== savedPlanId));
      setSavedPlanId(null);
      setGroupedPlans(null);
      setParsedPlan(null);
      setConfirmDelete(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.failedToDeletePlan'));
    } finally {
      setDeleting(false);
    }
  };

  const executePush = async () => {
    if (!groupedPlans || !savedPlanId) return;
    setPushing(true);
    setError(null);
    setPushResults(null);

    try {
      let targetAthletes: Athlete[] = [];
      if (pushTab === 'all') {
        targetAthletes = activeAthletes;
      } else if (pushTab === 'groups') {
        targetAthletes = activeAthletes.filter(
          (a) => a.group_id && selectedGroupIds.includes(a.group_id)
        );
      } else {
        targetAthletes = activeAthletes.filter((a) => selectedAthleteIds.includes(a.id));
      }

      // Only athletes with Garmin connected can receive a workout push.
      targetAthletes = targetAthletes.filter((a) => a.hasGarmin);

      if (targetAthletes.length === 0) {
        throw new Error(t('errors.noGarminSelected'));
      }

      const sortedGroups = [...groups].sort((a, b) => {
        const aGoal = a.marathonGoal ? parseFloat(a.marathonGoal) : 999;
        const bGoal = b.marathonGoal ? parseFloat(b.marathonGoal) : 999;
        return aGoal - bGoal;
      });
      const groupLevelMap: Record<string, keyof GroupedWeeklyPlans> = {};
      sortedGroups.forEach((g, i) => {
        if (i === 0) groupLevelMap[g.id] = 'group1';
        else if (i === 1) groupLevelMap[g.id] = 'group2';
        else groupLevelMap[g.id] = 'group3';
      });

      const allResults: PushResultItem[] = [];
      const athletesByPaceGroup: Record<string, string[]> = { group1: [], group2: [], group3: [] };

      for (const athlete of targetAthletes) {
        const paceGroup = athlete.group_id ? (groupLevelMap[athlete.group_id] || 'group2') : 'group2';
        athletesByPaceGroup[paceGroup].push(athlete.id);
      }

      for (const [paceGroup, ids] of Object.entries(athletesByPaceGroup)) {
        if (ids.length === 0) continue;
        const plan = groupedPlans[paceGroup as keyof GroupedWeeklyPlans];
        // Send only the selected days (null = whole week).
        const workoutsToSend = pushDays
          ? plan.workouts.filter((w) => pushDays.includes(w.dayOfWeek))
          : plan.workouts;
        if (workoutsToSend.length === 0) continue;

        const res = await fetch('/api/garmin/push-workouts', {
          method: 'POST',
          headers: await bearerHeaders(),
          body: JSON.stringify({
            planId: savedPlanId,
            workouts: workoutsToSend,
            athleteIds: ids,
            weekStartDate,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || t('errors.failedToPushWorkouts'));
        }

        const data = await res.json();
        allResults.push(...(data.results || []));
      }

      setPushResults(allResults);

      const allSuccess = allResults.every((r) => r.status === 'success');
      const anySuccess = allResults.some((r) => r.status === 'success');
      const newStatus = allSuccess ? 'pushed' : anySuccess ? 'partial' : 'draft';

      await fetch('/api/plans', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({ plan_id: savedPlanId, status: newStatus }),
      });

      setWeekPlans((prev) =>
        prev.map((p) => (p.id === savedPlanId ? { ...p, status: newStatus as 'draft' | 'pushed' | 'partial' } : p))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.pushFailed'));
    } finally {
      setPushing(false);
    }
  };

  const retryFailed = async () => {
    if (!pushResults || !groupedPlans || !savedPlanId) return;
    const failedIds = pushResults
      .filter((r) => r.status === 'failed')
      .map((r) => r.athleteId);

    if (failedIds.length === 0) return;

    setPushing(true);
    setError(null);

    try {
      const res = await fetch('/api/garmin/push-workouts', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({
          planId: savedPlanId,
          workouts: pushDays
            ? groupedPlans.group1.workouts.filter((w) => pushDays.includes(w.dayOfWeek))
            : groupedPlans.group1.workouts,
          athleteIds: failedIds,
          weekStartDate,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t('errors.retryFailedErr'));
      }

      const data = await res.json();
      const retryResults: PushResultItem[] = data.results || [];

      const merged = pushResults.map((prev) => {
        if (prev.status === 'success') return prev;
        const retried = retryResults.find((r) => r.athleteId === prev.athleteId);
        return retried || prev;
      });

      setPushResults(merged);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.retryFailedErr'));
    } finally {
      setPushing(false);
    }
  };

  const workoutCount = parsedPlan ? new Set(parsedPlan.workouts.map(w => w.dayOfWeek)).size : 0;

  // Days that actually have a workout (from the base plan) — for the per-day
  // push selector. Sorted Sunday→Saturday.
  const planDays = useMemo(() => {
    const src = groupedPlans?.group1.workouts || parsedPlan?.workouts || [];
    return Array.from(new Set(src.map((w) => w.dayOfWeek))).sort((a, b) => a - b);
  }, [groupedPlans, parsedPlan]);

  // How many workouts the current day selection will send (per athlete).
  const selectedDayCount = pushDays === null ? planDays.length : pushDays.length;

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────

  return (
    // dvh, and 9.25rem rather than 6rem. `100vh` on iOS is the viewport measured
    // with the URL bar hidden, so it overstates the height a phone actually has —
    // and the app shell is `min-h-[100dvh]`, so this was the one page still mixing
    // the two units. 9.25rem is the chrome this sits inside and has to leave room
    // for: the 56px header, the shell's own pt-5, and the 72px bottom tab bar.
    <div className="min-h-[calc(100dvh-9.25rem)] flex flex-col">
      {/* Week Navigation Header */}
      <div className="border-b border-page/50 bg-page/50 px-6 py-4">
        {/* `flex-wrap` + a narrower label below `sm`. On a 375px phone the title
            block and the week navigator together needed ~458px of the 327px this
            row actually has (px-6 either side), and because the page is RTL the
            overflow went off the START edge: the "previous week" arrow sat at
            x -57..-13, entirely outside the viewport and impossible to tap. The
            same navigator on /dashboard/activities already carries the
            `min-w-[140px] sm:min-w-[180px]` pair — this one just never got it. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <Calendar className="h-5 w-5 text-brand-600" />
            <h1 className="text-xl sm:text-2xl font-bold text-ink-700">{t('title')}</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setWeekOffset((o) => o - 1)}
              // Icon-only, so without this the control is an unnamed button to a
              // screen reader. AcademyCompliance's identical navigator labels
              // both of its arrows; these two were missed.
              aria-label={t('lastWeek')}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            >
              {/* Right for "previous", left for "next" below — the page is `dir="rtl"`,
                  so earlier is to the right. Both were the other way round, which is
                  the LTR convention leaking in: the button sitting on the right,
                  correctly, pointed left. Matches the two other navigators of this
                  exact shape, AcademyCompliance's week nav and the calendar's month
                  nav, which both already do it this way. */}
              <ChevronRight className="h-5 w-5" />
            </button>

            <div className="text-center min-w-[140px] sm:min-w-[180px]">
              <p className="text-sm font-medium text-ink-700">{weekLabel}</p>
              <p className="text-xs text-ink-400">
                {weekOffset === 0 ? t('thisWeek') : weekOffset === 1 ? t('nextWeek') : weekOffset === -1 ? t('lastWeek') : ''}
              </p>
            </div>

            <button
              onClick={() => setWeekOffset((o) => o + 1)}
              aria-label={t('nextWeek')}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            {weekOffset !== getDefaultOffset() && (
              <button
                onClick={() => setWeekOffset(getDefaultOffset())}
                className="min-h-[44px] text-xs text-brand-600 hover:text-brand-700 ms-2"
              >
                {t('current')}
              </button>
            )}
          </div>

          <div className="w-[100px]" />
        </div>
      </div>

      {/* Loading state */}
      {loadingPlans && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-ink-400 animate-spin" />
        </div>
      )}

      {/* No plan for this week */}
      {!loadingPlans && !currentPlan && !showCreate && !parsing && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-6 max-w-sm">
            <div className="w-16 h-16 rounded-full bg-card border border-page flex items-center justify-center mx-auto">
              <Calendar className="h-7 w-7 text-ink-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-ink-700 mb-2">{t('noPlan')}</h2>
              <p className="text-sm text-ink-400">
                {programPdfUrl
                  ? t('uploadDescriptionProgram', { group: weekLabel })
                  : t('uploadDescription', { group: weekLabel })}
              </p>
            </div>
            <div className="flex flex-col gap-3 items-center">
              {programPdfUrl && (
                <Button onClick={syncFromProgram} size="lg">
                  <RefreshCw className="h-5 w-5" />
                  {t('syncFromProgram')}
                </Button>
              )}
              {programPdfUrl ? (
                <Button variant="ghost" size="md" onClick={() => setShowCreate(true)}>
                  <Plus className="h-4 w-4" />
                  {t('createManually')}
                </Button>
              ) : (
                <Button onClick={() => setShowCreate(true)} size="lg">
                  <Plus className="h-5 w-5" />
                  {t('createPlan')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="md"
                onClick={async () => {
                  setParsing(true);
                  setError(null);
                  try {
                    const res = await fetch('/api/plans/import-program', { method: 'POST', headers: await bearerHeaders() });
                    const data = await res.json();
                    if (data.results?.some((r: any) => r.status === 'imported')) {
                      // Import writes several weeks at once, but only the one on
                      // screen needs to be reflected here — navigating to another
                      // week refetches it.
                      const plansRes = await fetch(
                        `/api/plans?coach_id=${HARDCODED_COACH_ID}&week_start_date=${weekStartDate}`,
                        { headers: await bearerHeaders(false) },
                      );
                      if (plansRes.ok) {
                        const plansData = await plansRes.json();
                        setWeekPlans(plansData.plans || []);
                      }
                    } else {
                      setError(data.results?.map((r: any) => `${r.week}: ${r.status}`).join(', ') || t('noPlansImported'));
                    }
                  } catch (err: any) {
                    setError(err.message || t('importFailed'));
                  } finally {
                    setParsing(false);
                  }
                }}
              >
                {t('importFromProgram')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create mode */}
      {!loadingPlans && !currentPlan && showCreate && !parsing && (
        // `items-start`, not `items-center`: this panel is taller than the space a
        // phone has, and a centred flex item that overflows its container gets
        // clipped at the top with no way to scroll to it.
        <div className="flex-1 flex items-start justify-center px-4 py-5">
          <div className="w-full max-w-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-600/15 flex items-center justify-center shrink-0">
                  <Sparkles className="h-5 w-5 text-brand-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-ink-700 leading-tight">{t('createPlanFor', { group: weekLabel })}</h2>
                  <p className="text-xs text-ink-400">{t('aiParseHint')}</p>
                </div>
              </div>
              <button
                onClick={() => { setShowCreate(false); setError(null); }}
                aria-label={t('cancel')}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 hover:text-ink-900 shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* This week's uploaded program — the coach's source material */}
            {programPdfUrl && (
              <div className="rounded-xl border border-page bg-card/40 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2 text-sm text-ink-500">
                    <FileText className="h-4 w-4 text-brand-600" />
                    {t('programFor', { group: weekLabel })}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowProgramViewer((v) => !v)}
                      className="min-h-[44px] flex items-center text-xs text-brand-600 hover:text-brand-700"
                    >
                      {showProgramViewer ? t('hide') : t('view')}
                    </button>
                    <a
                      href={programPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] flex items-center text-xs text-ink-400 hover:text-ink-900"
                    >
                      {t('openArrow')}
                    </a>
                  </div>
                </div>
                {showProgramViewer && (
                  <iframe
                    src={programPdfUrl}
                    className="w-full border-0 border-t border-page bg-white"
                    style={{ height: '60vh' }}
                    title={t('programFor', { group: weekLabel })}
                  />
                )}
                <div className="px-4 py-2 border-t border-page/60">
                  <button
                    onClick={syncFromProgram}
                    className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1.5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('parseProgramAutomatically')}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-card bg-card/80 border border-page/50 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-page/60 flex items-center justify-center shrink-0">
                  <FileText className="h-3.5 w-3.5 text-ink-400" />
                </div>
                <span className="text-xs font-semibold text-ink-400 uppercase tracking-wide">{t('pasteTextLabel')}</span>
              </div>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onPaste={handlePaste}
                placeholder={t('pasteYourPlan')}
                rows={7}
                className="w-full resize-none text-base leading-relaxed bg-page/60 border border-page/50 rounded-xl px-4 py-3 text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600/50"
              />

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-page/50" />
                <span className="text-2xs font-semibold text-ink-400 uppercase tracking-wide">{t('or')}</span>
                <div className="flex-1 h-px bg-page/50" />
              </div>

              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-page/60 flex items-center justify-center shrink-0">
                  <ImageIcon className="h-3.5 w-3.5 text-ink-400" />
                </div>
                <span className="text-xs font-semibold text-ink-400 uppercase tracking-wide">{t('uploadFileLabel')}</span>
              </div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => !imagePreview && document.getElementById('file-upload-input')?.click()}
                className={cn(
                  'relative border-2 border-dashed rounded-xl p-5 text-center transition-all',
                  imagePreview
                    ? 'border-brand-600 bg-brand-600/5'
                    : 'border-page hover:border-ink-300 hover:bg-page/50 cursor-pointer'
                )}
              >
                {imagePreview && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeFile(); }}
                    aria-label={t('removeFile')}
                    className="absolute top-2 end-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                {imagePreview === 'pdf' ? (
                  <div className="flex items-center justify-center gap-3">
                    <div className="w-10 h-12 bg-accent-red/20 rounded flex items-center justify-center">
                      <span className="text-accent-red text-xs font-bold">PDF</span>
                    </div>
                    <div className="text-start">
                      <p className="text-sm text-ink-500">{imageFile?.name}</p>
                      <p className="text-xs text-ink-400">{t('readyToParse')}</p>
                    </div>
                  </div>
                ) : imagePreview ? (
                  <img src={imagePreview} alt={t('uploadedPlanAlt')} className="max-h-24 mx-auto rounded" />
                ) : (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <Upload className="h-6 w-6 text-ink-400" />
                    <p className="text-sm text-ink-400">{t('dropImage')}</p>
                  </div>
                )}
                <input
                  id="file-upload-input"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
            </div>

            {error && <ErrorBanner message={error} />}

            {/* Sticky, because this panel's content is ~837px at 390×844 while the
                header and tab bar leave it 696 — so the one button the whole screen
                exists for used to sit 37px below the fold, under the tab bar,
                reachable only by scrolling a page that gave no sign it scrolled.
                Same action-bar treatment the registrations queue uses. */}
            <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-0 z-20 -mx-4 px-4 pb-4 pt-3 rounded-t-card border-t border-page bg-card/95 backdrop-blur">
              <Button onClick={parsePlan} disabled={!hasInput} size="lg" className="w-full">
                <Sparkles className="h-5 w-5" />
                {t('parsePlan')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Parsing animation */}
      {parsing && (
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-sm text-center space-y-8">
            <div className="flex items-center justify-center">
              <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
                <style>{`
                  .stair { opacity: 0.2; animation: stairLight 2.4s ease-in-out infinite; }
                  .stair-1 { animation-delay: 0s; }
                  .stair-2 { animation-delay: 0.4s; }
                  .stair-3 { animation-delay: 0.8s; }
                  .stair-4 { animation-delay: 1.2s; }
                  .stair-5 { animation-delay: 1.6s; }
                  @keyframes stairLight { 0%,100%{opacity:0.2} 30%{opacity:1} 60%{opacity:0.4} }
                  .runner-dot { animation: climbStairs 2.4s ease-in-out infinite; }
                  @keyframes climbStairs {
                    0% { transform: translate(15px, 92px); }
                    20% { transform: translate(38px, 74px); }
                    40% { transform: translate(61px, 56px); }
                    60% { transform: translate(84px, 38px); }
                    80% { transform: translate(107px, 20px); }
                    100% { transform: translate(15px, 92px); }
                  }
                `}</style>
                <rect className="stair stair-1" x="10" y="95" width="24" height="6" rx="2" fill="#1525FF" />
                <rect className="stair stair-2" x="33" y="77" width="24" height="6" rx="2" fill="#1525FF" />
                <rect className="stair stair-3" x="56" y="59" width="24" height="6" rx="2" fill="#1525FF" />
                <rect className="stair stair-4" x="79" y="41" width="24" height="6" rx="2" fill="#1525FF" />
                <rect className="stair stair-5" x="102" y="23" width="24" height="6" rx="2" fill="#1525FF" />
                <rect x="33" y="83" width="3" height="12" rx="1" fill="#1525FF" opacity="0.15" />
                <rect x="56" y="65" width="3" height="12" rx="1" fill="#1525FF" opacity="0.15" />
                <rect x="79" y="47" width="3" height="12" rx="1" fill="#1525FF" opacity="0.15" />
                <rect x="102" y="29" width="3" height="12" rx="1" fill="#1525FF" opacity="0.15" />
                <circle className="runner-dot" cx="0" cy="0" r="5" fill="#1525FF" />
              </svg>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-ink-700">{savingAfterParse ? t('savingPlan') : t('parsingPlan')}</h2>
              <p className="text-sm text-ink-400">{savingAfterParse ? t('finalizingWeek') : t('readingWorkouts')}</p>
            </div>
            <div className="w-48 mx-auto h-1.5 bg-card rounded-full overflow-hidden">
              {/* Brand blue -> band 2 -> brand blue: a same-family shimmer. (The
                  purple mid-stop was left over from the dark palette; it's the one
                  place a category hue leaked into plain decoration.) */}
              <div className="h-full bg-gradient-to-r from-brand-600 via-band-2 to-brand-600 rounded-full animate-progress-indeterminate" />
            </div>
            <button
              onClick={cancelParsing}
              className="min-h-[44px] px-4 text-sm text-ink-400 hover:text-ink-500 transition-colors"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Plan exists - show it */}
      {!loadingPlans && currentPlan && groupedPlans && parsedPlan && (
        <div className="flex-1 flex flex-col">
          {/* Status bar — button labels hide below sm (icon + title tooltip
              only) so 5 elements + a wrapping count don't fight for space on
              a phone-width screen; full labels return once there's room. */}
          <div className="px-4 sm:px-6 py-3 border-b border-page/50 bg-card/30">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-ink-500 shrink-0">
                  {workoutCount} {t('workouts')}
                </span>
                <span className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded-full text-3xs font-medium shrink-0',
                  currentPlan.status === 'pushed' ? 'text-accent-900 bg-accent-600/10' :
                  currentPlan.status === 'partial' ? 'text-band-3-ink bg-band-3/10' :
                  'text-band-3-ink bg-band-3/10'
                )}>
                  {currentPlan.status === 'pushed' ? <CheckCircle2 className="h-3 w-3" /> :
                   currentPlan.status === 'partial' ? <AlertCircle className="h-3 w-3" /> :
                   <Clock className="h-3 w-3" />}
                  {currentPlan.status === 'pushed' ? t('pushed') : currentPlan.status === 'partial' ? t('partial') : t('draft')}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={syncFromProgram}
                  title={t('syncFromProgram')}
                >
                  <RefreshCw className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('sync')}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditMode(!editMode)}
                  title={editMode ? t('done') : t('edit')}
                  className={cn(editMode && 'ring-1 ring-brand-600')}
                >
                  <Edit3 className="h-4 w-4" />
                  <span className="hidden sm:inline">{editMode ? t('done') : t('edit')}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleting}
                  title={t('remove')}
                  className="text-accent-red hover:text-accent-red active:text-accent-red"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('remove')}</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Week view — one unified plan; a step's own value is Group ❶ and
              (Group ❷)/((Group ❸)) show inline wherever they actually
              differ, instead of three separate tabs to switch between. */}
          <div className="flex-1 px-6 py-6 w-full">
            {error && <ErrorBanner message={error} className="mb-4" />}

            <WeekView
              workouts={parsedPlan.workouts}
              editable={editMode}
              onWorkoutChange={handleWorkoutChange}
            />
          </div>

          {/* Bottom action bar */}
          <div className="border-t border-page bg-page/80 backdrop-blur px-6 py-4 sticky bottom-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {editMode && (
                  <Button variant="secondary" size="sm" onClick={saveDraft} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t('saveChanges')}
                  </Button>
                )}
                {lastSavedAt && (
                  <span className="text-xs text-ink-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-accent-600" />
                    {t('savedAt', { time: lastSavedAt.toLocaleTimeString(locale === 'he' ? 'he-IL' : 'en-US', { hour: '2-digit', minute: '2-digit' }) })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => { setError(null); setShowPush(true); }}
                >
                  <Watch className="h-4 w-4" />
                  {t('pushToAthletes')}
                </Button>
                <Button
                  onClick={() => {
                    setError(null);
                    setClipboardWorkoutIndex(0);
                    setShowClipboardReview(true);
                  }}
                  className="px-6"
                >
                  <ClipboardList className="h-4 w-4" />
                  {t('reviewAndPublish')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Sheet
        open={!!(showClipboardReview && groupedPlans && savedPlanId)}
        onOpenChange={(o) => { if (!o) setShowClipboardReview(false); }}
        title={t('clipboardStudioTitle')}
        className="md:max-w-5xl md:mx-auto"
        footer={groupedPlans && (
          <div className="flex items-center justify-between border-t border-page bg-card/30 px-5 py-4">
            <span className="text-xs text-ink-400">
              {t('partsTimesGroups', { parts: groupedPlans.group1.workouts.length })}
            </span>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowClipboardReview(false);
                  setShowMatchReview(true);
                }}
                disabled={clipboardLoading}
              >
                <Search className="h-4 w-4" />
                {t('activityMatches')}
              </Button>
              <Button variant="secondary" onClick={saveDraft} disabled={saving || clipboardLoading}>
                <Save className="h-4 w-4" />
                {t('saveDraft')}
              </Button>
              <Button onClick={publishClipboards} disabled={clipboardLoading} className="px-5">
                {clipboardLoading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <CheckCircle2 className="h-4 w-4" />}
                {t('publishAllClipboards')}
              </Button>
            </div>
          </div>
        )}
      >
        {groupedPlans && savedPlanId && (
          <>
            <p className="mb-3 text-xs text-ink-400">
              {t('clipboardStudioDesc')}
            </p>

            <SegmentedControl
              value={String(activeGroup)}
              onChange={(v) => setActiveGroup(Number(v) as 1 | 2 | 3)}
              options={[1, 2, 3].map((group) => ({ value: String(group), label: t('groupLabel', { n: group }) }))}
              className="mb-4"
            />

            <div className="grid md:grid-cols-[260px_1fr] gap-4">
              <aside className="md:border-e border-page md:pe-3">
                <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-ink-400">
                  {t('workoutParts')}
                </p>
                <div className="space-y-2">
                  {groupedPlans[`group${activeGroup}`].workouts.map((workout, index) => (
                    <button
                      key={workout.workoutKey || `${workout.dayOfWeek}-${index}`}
                      onClick={() => setClipboardWorkoutIndex(index)}
                      className={cn(
                        'w-full rounded-xl border p-3 text-start transition-colors',
                        clipboardWorkoutIndex === index
                          ? 'border-brand-600 bg-brand-600/10'
                          : 'border-page bg-card/40 hover:border-ink-300',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase text-ink-400">
                          {DAY_LABELS[workout.dayOfWeek]}
                          {workout.partCount && workout.partCount > 1
                            ? ` · ${t('partLabel', { index: workout.partIndex ?? 0, count: workout.partCount })}`
                            : ''}
                        </span>
                        {workout.clipboardImageUrl && (
                          <span className="rounded-full bg-accent-600/15 px-2 py-0.5 text-[9px] font-bold text-accent-900">
                            {t('published')}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-ink-700">{workout.name}</p>
                      <p className="mt-1 text-[10px] text-ink-400">
                        {workout.expectedDistanceM
                          ? t('expectedKm', { km: (workout.expectedDistanceM / 1000).toFixed(1) })
                          : workout.partKind || t('single')}
                      </p>
                    </button>
                  ))}
                </div>
              </aside>

              <main className="min-w-0">
                {(() => {
                  const workout =
                    groupedPlans[`group${activeGroup}`].workouts[clipboardWorkoutIndex];
                  if (!workout) return null;
                  return (
                    <div className="grid gap-6 lg:grid-cols-2">
                      <section>
                        <div className="mb-3 flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-ink-700">{workout.name}</h3>
                            <p className="text-xs text-ink-400">
                              {workout.workoutKey} · {t('groupLabel', { n: activeGroup })}
                            </p>
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => setClipboardEditing(true)}>
                            <Edit3 className="h-4 w-4" />
                            {t('editSteps')}
                          </Button>
                        </div>
                        <div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl border border-page bg-page/60 p-4">
                          {clipboardLoading && !clipboardPreview ? (
                            <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
                          ) : clipboardPreview ? (
                            <img
                              src={clipboardPreview}
                              alt={workout.name}
                              className="max-h-[560px] max-w-full rounded-lg object-contain"
                            />
                          ) : (
                            <div className="text-center text-sm text-ink-400">
                              <ImageIcon className="mx-auto mb-2 h-8 w-8" />
                              {t('previewUnavailable')}
                            </div>
                          )}
                        </div>
                      </section>

                      <section className="space-y-5">
                        <div>
                          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">
                            {t('aiReadableText')}
                          </h4>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-page bg-page/60 p-4 text-xs leading-6 text-ink-700">
                            {clipboardText || workout.clipboardText || t('rendering')}
                          </pre>
                        </div>

                        <div className="rounded-xl border border-page bg-card/35 p-4">
                          <h4 className="flex items-center gap-2 text-sm font-semibold text-ink-700">
                            <Sparkles className="h-4 w-4 text-purple-600" />
                            {t('refineWithAi')}
                          </h4>
                          <textarea
                            value={clipboardInstruction}
                            onChange={(event) => setClipboardInstruction(event.target.value)}
                            placeholder={t('refinePlaceholder')}
                            className="mt-3 min-h-24 w-full rounded-lg border border-ink-300 bg-page px-3 py-2 text-sm text-ink-700 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
                          />
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <SegmentedControl
                              value={clipboardRefineScope}
                              onChange={setClipboardRefineScope}
                              options={[
                                { value: 'all', label: t('allGroups') },
                                { value: 'current', label: t('currentGroupOnly') },
                              ]}
                              className="w-fit"
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={refineClipboard}
                              disabled={clipboardLoading || !clipboardInstruction.trim()}
                            >
                              {clipboardLoading
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Sparkles className="h-4 w-4" />}
                              {t('refine')}
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-xl border border-brand-600/30 bg-brand-600/5 p-4 text-xs text-ink-500">
                          {t('pngNote')}
                        </div>
                      </section>
                    </div>
                  );
                })()}
              </main>
            </div>
          </>
        )}
      </Sheet>

      {clipboardEditing && groupedPlans && (
        <WorkoutEditorPanel
          workout={groupedPlans[`group${activeGroup}`].workouts[clipboardWorkoutIndex]}
          dayName={DAY_LABELS[groupedPlans[`group${activeGroup}`].workouts[clipboardWorkoutIndex]?.dayOfWeek]}
          onChange={(workout) => handleClipboardWorkoutChange(clipboardWorkoutIndex, workout)}
          onClose={() => setClipboardEditing(false)}
        />
      )}

      <Sheet
        open={showMatchReview}
        onOpenChange={setShowMatchReview}
        title={t('matchReviewTitle')}
        footer={
          <div className="flex justify-between border-t border-page bg-card/30 p-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowMatchReview(false);
                setShowClipboardReview(true);
              }}
            >
              {t('backToClipboards')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void loadMatchReview()}
              disabled={matchReviewLoading}
            >
              {matchReviewLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              {t('refreshMatches')}
            </Button>
          </div>
        }
      >
        <>
            <p className="mb-4 text-xs text-ink-400">
              {t('matchReviewDesc')}
            </p>
            {matchReview?.matchesAvailable === false && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-accent-red/30 bg-accent-red/10 p-3 text-xs text-ink-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent-red" />
                <span>{t('matchesUnavailable')}</span>
              </div>
            )}
            <div className="min-h-0">
              {matchReviewLoading && !matchReview ? (
                <div className="flex h-52 items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
                </div>
              ) : matchReview?.activities.length ? (
                <div className="space-y-2">
                  {matchReview.activities.map((activity) => {
                    const match = matchReview.matches.find(
                      (candidate) => candidate.activity_id === activity.id,
                    );
                    const athlete = matchReview.athletes.find(
                      (candidate) => candidate.id === activity.athlete_id,
                    );
                    const candidates = matchCandidates(matchReview.workouts, activity.start_time);
                    return (
                      <div
                        key={activity.id}
                        className="grid gap-3 rounded-xl border border-page bg-card/35 p-4 md:grid-cols-[1fr_1.3fr]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink-700">
                              {athlete?.name || activity.athlete_id}
                            </span>
                            {/* Athlete-local, via the utils helpers: a raw
                                `new Date(start_time)` misreads Garmin's
                                space-separated startTimeLocal as viewer-local. */}
                            <span className="text-xs text-ink-400">
                              {DAY_LABELS[activityLocalDay(activity.start_time)]} · {formatActivityTime(activity.start_time)}
                            </span>
                            {match && (
                              <span className={cn(
                                'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase',
                                match.match_method === 'manual'
                                  ? 'bg-purple-500/15 text-purple-800'
                                  : 'bg-accent-600/15 text-accent-900',
                              )}>
                                {match.match_method === 'manual' ? t('matchManual') : t('matchAuto')}
                                {match.score != null ? ` ${Math.round(match.score)}` : ''}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-sm text-ink-500">
                            {activity.activity_name || t('runFallback')} ·{' '}
                            {activity.distance ? `${(activity.distance / 1000).toFixed(2)} km` : '—'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setMatchPickerActivityId(activity.id)}
                          disabled={matchReviewLoading || matchReview.matchesAvailable === false}
                          className="w-full min-h-[44px] flex items-center justify-between gap-2 rounded-lg border border-ink-300 bg-page px-3 py-2 text-sm text-ink-700 text-start disabled:opacity-50"
                        >
                          <span className="truncate">
                            {match
                              ? (() => {
                                  const matchedWorkout = candidates.find((workout) => workout.workoutKey === match.workout_key);
                                  if (!matchedWorkout) return match.workout_key;
                                  return `${DAY_LABELS[matchedWorkout.dayOfWeek]} · ${
                                    matchedWorkout.partCount && matchedWorkout.partCount > 1
                                      ? `${t('partLabel', { index: matchedWorkout.partIndex ?? 0, count: matchedWorkout.partCount })} · `
                                      : ''
                                  }${matchedWorkout.name}`;
                                })()
                              : t('noMatchedWorkout')}
                          </span>
                          <ChevronDown className="h-4 w-4 text-ink-400 shrink-0" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-16 text-center text-sm text-ink-400">
                  {t('noActivitiesStored')}
                </div>
              )}
            </div>
        </>
      </Sheet>

      {/* Activity → workout picker — Sheet-based replacement for the raw <select> */}
      <Sheet
        open={!!matchPickerActivityId}
        onOpenChange={(o) => { if (!o) setMatchPickerActivityId(null); }}
        title={t('selectWorkoutTitle')}
      >
        {matchPickerActivityId && matchReview && (() => {
          const activity = matchReview.activities.find((a) => a.id === matchPickerActivityId);
          if (!activity) return null;
          const candidates = matchCandidates(matchReview.workouts, activity.start_time);
          const match = matchReview.matches.find((candidate) => candidate.activity_id === activity.id);
          return (
            <InsetSection>
              <InsetRow
                label={t('noMatchedWorkout')}
                onClick={() => { setMatchPickerActivityId(null); void setManualMatch(activity.id, null); }}
                trailing={!match ? <Check className="h-4 w-4 text-brand-600" /> : <span className="w-4 h-4" />}
              />
              {candidates.map((workout) => (
                <InsetRow
                  key={workout.workoutKey}
                  label={`${DAY_LABELS[workout.dayOfWeek]}${
                    workout.partCount && workout.partCount > 1
                      ? ` · ${t('partLabel', { index: workout.partIndex ?? 0, count: workout.partCount })}`
                      : ''
                  } · ${workout.name}`}
                  onClick={() => { setMatchPickerActivityId(null); void setManualMatch(activity.id, workout.workoutKey ?? null); }}
                  trailing={match?.workout_key === workout.workoutKey ? <Check className="h-4 w-4 text-brand-600" /> : <span className="w-4 h-4" />}
                />
              ))}
            </InsetSection>
          );
        })()}
      </Sheet>

      {/* Delete confirmation */}
      <ConfirmSheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('removePlanTitle')}
        description={t('removeConfirm', { group: weekLabel })}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        onConfirm={deletePlan}
      />

      {/* Sync-from-program overwrite confirmation */}
      <ConfirmSheet
        open={confirmSyncFromProgram}
        onOpenChange={setConfirmSyncFromProgram}
        title={t('syncFromProgram')}
        description={t('errors.confirmReplacePlan', { group: weekLabel })}
        confirmLabel={t('sync')}
        cancelLabel={t('cancel')}
        danger={false}
        onConfirm={() => void doSyncFromProgram()}
      />

      {/* Push Modal */}
      <Sheet
        open={showPush}
        onOpenChange={(o) => { if (!o) { setShowPush(false); setPushResults(null); setError(null); } }}
        title={t('pushToAthletes')}
      >
            {pushResults ? (
              <div className="space-y-4">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2 text-accent-600">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">
                      {pushResults.filter((r) => r.status === 'success').length} {t('succeeded')}
                    </span>
                  </div>
                  {pushResults.some((r) => r.status === 'failed') && (
                    <div className="flex items-center gap-2 text-accent-red">
                      <XCircle className="h-5 w-5" />
                      <span className="font-medium">
                        {pushResults.filter((r) => r.status === 'failed').length} {t('failed')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {pushResults.map((r, i) => (
                    <div
                      key={r.athleteId || i}
                      className={cn(
                        'flex items-center justify-between p-3 rounded-lg border',
                        r.status === 'success'
                          ? 'bg-accent-600/5 border-accent-600/20'
                          : 'bg-accent-red/5 border-accent-red/20'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {r.status === 'success' ? (
                          <CheckCircle className="h-4 w-4 text-accent-600 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-accent-red shrink-0" />
                        )}
                        <div>
                          <span className="text-sm font-medium">{r.athleteName}</span>
                          {r.error && <p className="text-xs text-accent-red mt-0.5">{r.error}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-page">
                  {pushResults.some((r) => r.status === 'failed') && (
                    <Button variant="secondary" onClick={retryFailed} disabled={pushing}>
                      {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      {t('retryFailed')}
                    </Button>
                  )}
                  <Button onClick={() => { setShowPush(false); setPushResults(null); }}>
                    {t('done')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Which days to send — whole week (default) or specific days */}
                {planDays.length > 0 && (
                  <div className="mt-4 pb-4 border-b border-page">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-ink-400">{t('workoutsToSend')}</span>
                      <div className="flex items-center gap-2">
                        {planDays.includes(new Date().getDay()) && (
                          <button
                            onClick={() => setPushDays([new Date().getDay()])}
                            className="text-2xs text-brand-600 hover:text-brand-700"
                          >
                            {t('todayOnly')}
                          </button>
                        )}
                        <button
                          onClick={() => setPushDays(null)}
                          className={cn(
                            'text-2xs',
                            pushDays === null ? 'text-brand-600 font-medium' : 'text-ink-400 hover:text-ink-500'
                          )}
                        >
                          {t('wholeWeek')}
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {planDays.map((d) => {
                        const selected = pushDays === null || pushDays.includes(d);
                        const isToday = d === new Date().getDay();
                        return (
                          <button
                            key={d}
                            onClick={() => {
                              setPushDays((prev) => {
                                // From "whole week", first click starts an explicit selection.
                                const base = prev === null ? [...planDays] : prev;
                                const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d];
                                // If every day ends up selected, collapse back to null (whole week).
                                if (next.length === planDays.length) return null;
                                return next;
                              });
                            }}
                            className={cn(
                              'px-2.5 py-1 rounded-md text-2xs font-medium border transition-colors',
                              selected
                                ? 'bg-brand-600/15 border-brand-600/50 text-brand-600'
                                : 'border-page text-ink-400 hover:border-ink-300',
                              isToday && 'ring-1 ring-brand-600/40'
                            )}
                            title={DAY_LABELS[d]}
                          >
                            {DAY_LABELS[d]}{isToday ? ' •' : ''}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-3xs text-ink-400 mt-2">
                      {t('sendingWorkouts', { count: selectedDayCount })}
                      {pushDays !== null && selectedDayCount === 0 && t('selectAtLeastOneDay')}
                    </p>
                  </div>
                )}

                <SegmentedControl
                  value={pushTab}
                  onChange={setPushTab}
                  options={[
                    { value: 'all', icon: Users, label: t('allAthletes') },
                    { value: 'groups', icon: Layers, label: t('byGroup') },
                    { value: 'athletes', icon: UserCheck, label: t('specific') },
                  ]}
                  className="mt-4"
                />

                <div className="py-4 min-h-[200px]">
                  {loadingAthletes ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
                    </div>
                  ) : (
                    <>
                      {pushTab === 'all' && (
                        <div className="space-y-3">
                          {(() => {
                            const readyCount = activeAthletes.filter((a) => a.hasGarmin).length;
                            return (
                              <div className="text-center">
                                <p className="text-lg font-medium">
                                  {t('activeAthletesCount', { count: activeAthletes.length })}
                                </p>
                                <p className="text-sm text-ink-400 mt-0.5">
                                  {t('garminWillReceive', { ready: readyCount, count: workoutCount })}
                                </p>
                              </div>
                            );
                          })()}

                          {groups.length === 0 ? (
                            <p className="text-sm text-ink-400 text-center py-6">{t('noGroupsFound')}</p>
                          ) : (
                            groups.map((group, groupIdx) => {
                              const groupColor =
                                groupIdx === 0 ? { iconBg: 'bg-accent-600', label: t('groupLabel', { n: 1 }) } :
                                groupIdx === 1 ? { iconBg: 'bg-band-3', label: t('groupLabel', { n: 2 }) } :
                                { iconBg: 'bg-band-3', label: t('groupLabel', { n: 3 }) };
                              const members = activeAthletes.filter((a) => a.group_id === group.id);
                              const readyMembers = members.filter((a) => a.hasGarmin);
                              const isOpen = expandedAllGroup === group.id;
                              return (
                                <InsetSection key={group.id} className="mb-0">
                                  <InsetRow
                                    icon={Layers}
                                    iconBg={groupColor.iconBg}
                                    label={group.name}
                                    sublabel={groupColor.label}
                                    onClick={() => setExpandedAllGroup(isOpen ? null : group.id)}
                                    trailing={
                                      <span className="flex items-center gap-1.5 text-xs text-ink-400 shrink-0">
                                        {t('readyOfTotal', { ready: readyMembers.length, total: members.length })}
                                        {isOpen ? <ChevronUp className="h-4 w-4 text-ink-400" /> : <ChevronDown className="h-4 w-4 text-ink-400" />}
                                      </span>
                                    }
                                  />
                                  {isOpen && (
                                    members.length === 0 ? (
                                      <div className="px-4 py-3 text-xs text-ink-400 text-center">{t('noAthletesInGroup')}</div>
                                    ) : (
                                      members.map((a) => (
                                        <InsetRow
                                          key={a.id}
                                          icon={Watch}
                                          iconBg={a.hasGarmin ? 'bg-accent-600' : 'bg-ink-300'}
                                          label={a.name}
                                          trailing={
                                            a.hasGarmin ? (
                                              <span className="flex items-center gap-1 text-2xs text-accent-600">
                                                <CheckCircle className="h-3.5 w-3.5" /> {t('garmin')}
                                              </span>
                                            ) : (
                                              <span className="flex items-center gap-1 text-2xs text-ink-400">
                                                <XCircle className="h-3.5 w-3.5" /> {t('notConnected')}
                                              </span>
                                            )
                                          }
                                        />
                                      ))
                                    )
                                  )}
                                </InsetSection>
                              );
                            })
                          )}

                          {/* Athletes with no group assigned */}
                          {(() => {
                            const ungrouped = activeAthletes.filter((a) => !a.group_id);
                            if (ungrouped.length === 0) return null;
                            return (
                              <p className="text-xs text-ink-400 text-center pt-1">
                                {t('withoutGroupNote', { count: ungrouped.length })}
                              </p>
                            );
                          })()}
                        </div>
                      )}

                      {pushTab === 'groups' && (
                        <div>
                          {groups.length === 0 ? (
                            <p className="text-sm text-ink-400 text-center py-8">{t('noGroupsFound')}</p>
                          ) : (
                            <InsetSection>
                              {[...groups].sort((a, b) => {
                                const aGoal = a.marathonGoal ? parseFloat(a.marathonGoal) : 999;
                                const bGoal = b.marathonGoal ? parseFloat(b.marathonGoal) : 999;
                                return aGoal - bGoal;
                              }).map((group, groupIdx) => {
                                const count = activeAthletes.filter((a) => a.group_id === group.id).length;
                                const isSelected = selectedGroupIds.includes(group.id);
                                const groupLabel = t('groupLabel', { n: Math.min(groupIdx + 1, 3) });
                                const iconBg = groupIdx === 0 ? 'bg-accent-600' : groupIdx === 1 ? 'bg-band-3' : 'bg-band-3';
                                return (
                                  <InsetRow
                                    key={group.id}
                                    icon={Layers}
                                    iconBg={iconBg}
                                    label={group.name}
                                    sublabel={`${groupLabel} · ${t('athleteCount', { count })}`}
                                    onClick={() => {
                                      setSelectedGroupIds((prev) =>
                                        isSelected ? prev.filter((id) => id !== group.id) : [...prev, group.id]
                                      );
                                    }}
                                    trailing={
                                      isSelected
                                        ? <CheckCircle2 className="h-5 w-5 text-brand-600" />
                                        : <span className="h-5 w-5 rounded-full border-2 border-ink-300" />
                                    }
                                  />
                                );
                              })}
                            </InsetSection>
                          )}
                        </div>
                      )}

                      {pushTab === 'athletes' && (
                        <div className="space-y-3">
                          <div className="relative">
                            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                            <input
                              type="text"
                              value={athleteSearch}
                              onChange={(e) => setAthleteSearch(e.target.value)}
                              placeholder={t('searchAthletes')}
                              className="w-full min-h-[44px] ps-9 text-sm bg-page border border-page rounded-lg text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600/50"
                            />
                          </div>

                          <div className="max-h-[300px] overflow-y-auto">
                            {filteredAthletes.length === 0 ? (
                              <p className="text-sm text-ink-400 text-center py-6">{t('noAthletesFound')}</p>
                            ) : (
                              <InsetSection className="mb-0">
                                {filteredAthletes.map((athlete) => {
                                  const isSelected = selectedAthleteIds.includes(athlete.id);
                                  const athleteGroupIdx = groups.findIndex((g) => g.id === athlete.group_id);
                                  const athleteGroup = athleteGroupIdx >= 0 ? groups[athleteGroupIdx] : undefined;
                                  // Can't push a workout to an athlete with no Garmin connected.
                                  const canPush = !!athlete.hasGarmin;
                                  const row = (
                                    <InsetRow
                                      icon={Watch}
                                      iconBg={canPush ? 'bg-accent-600' : 'bg-ink-300'}
                                      label={athlete.name}
                                      sublabel={athleteGroup?.name}
                                      onClick={canPush ? () => {
                                        setSelectedAthleteIds((prev) =>
                                          isSelected ? prev.filter((id) => id !== athlete.id) : [...prev, athlete.id]
                                        );
                                      } : undefined}
                                      trailing={
                                        !canPush
                                          ? <span className="text-3xs text-accent-red/70 shrink-0">{t('noGarminTag')}</span>
                                          : isSelected
                                            ? <CheckCircle2 className="h-5 w-5 text-brand-600" />
                                            : <span className="h-5 w-5 rounded-full border-2 border-ink-300" />
                                      }
                                    />
                                  );
                                  return canPush ? (
                                    <div key={athlete.id}>{row}</div>
                                  ) : (
                                    <div key={athlete.id} className="opacity-50" title={t('noGarminTitle')}>{row}</div>
                                  );
                                })}
                              </InsetSection>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {error && <ErrorBanner message={error} className="p-3" />}

                <div className="flex items-center justify-between pt-4 border-t border-page">
                  <span className="text-sm text-ink-400">
                    {t('athletesSelected', { count: pushTargetCount })}
                  </span>
                  <Button
                    onClick={executePush}
                    disabled={pushing || pushTargetCount === 0 || selectedDayCount === 0}
                  >
                    {pushing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('pushingTo', { count: pushTargetCount })}
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        {pushDays === null
                          ? t('pushWorkouts')
                          : t('pushDaysBtn', { count: selectedDayCount })}
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
      </Sheet>
    </div>
  );
}
