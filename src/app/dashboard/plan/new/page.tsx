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
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';
import { Sheet, ConfirmSheet, SegmentedControl, Button, InsetSection, InsetRow } from '@/components/ui';

const HARDCODED_COACH_ID = '30f056a7-c651-490e-8356-615ea9eff097';

type PushTab = 'all' | 'groups' | 'athletes';

interface SavedPlanSummary {
  id: string;
  week_start_date: string;
  status: 'draft' | 'pushed' | 'partial';
  created_at: string;
  parsed_workouts: GroupedWeeklyPlans | ParsedWeeklyPlan;
  original_input: string;
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
}

function getCurrentWeekSunday(offset: number = 0): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dayOfWeek + offset * 7);
  return sunday.toISOString().split('T')[0];
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

async function bearerHeaders(includeJson = true): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function ErrorBanner({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn('bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm', className)}>
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
  const [allPlans, setAllPlans] = useState<SavedPlanSummary[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  // --- Current week plan ---
  const currentPlan = useMemo(
    () => allPlans.find((p) => p.week_start_date === weekStartDate) || null,
    [allPlans, weekStartDate]
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

  // --- Fetch all plans ---
  useEffect(() => {
    const fetchPlans = async () => {
      setLoadingPlans(true);
      try {
        const res = await fetch(`/api/plans?coach_id=${HARDCODED_COACH_ID}`);
        if (res.ok) {
          const data = await res.json();
          setAllPlans(data.plans || []);
        }
      } catch {
        // silent
      } finally {
        setLoadingPlans(false);
      }
    };
    fetchPlans();
  }, []);

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
        setParsedPlan(effective.group1);
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        setAllPlans((prev) => [saveData.plan, ...prev]);
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
        headers: { 'Content-Type': 'application/json' },
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_id: savedPlanId, parsed_workouts: grouped, status: 'draft' }),
        });
        if (putRes.ok) {
          setLastSavedAt(new Date());
          setAllPlans((prev) =>
            prev.map((p) => (p.id === savedPlanId ? { ...p, parsed_workouts: grouped, status: 'draft' } : p))
          );
        }
      } else {
        const saveRes = await fetch('/api/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
          setAllPlans((prev) => [saveData.plan, ...prev.filter((p) => p.id !== saveData.plan.id)]);
        }
      }

      setShowCreate(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.failedToSyncProgram'));
    } finally {
      setParsing(false);
    }
  };

  const handleWorkoutChange = (index: number, workout: ParsedWorkout) => {
    if (!groupedPlans) return;
    const groupKey = `group${activeGroup}` as keyof GroupedWeeklyPlans;
    const currentGroupPlan = groupedPlans[groupKey];
    const newWorkouts = [...currentGroupPlan.workouts];
    newWorkouts[index] = workout;
    setGroupedPlans({
      ...groupedPlans,
      [groupKey]: { workouts: newWorkouts },
    });
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
        headers: { 'Content-Type': 'application/json' },
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
      setAllPlans((prev) =>
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
        headers: { 'Content-Type': 'application/json' },
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
      setAllPlans((prev) =>
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: savedPlanId }),
      });
      if (!res.ok) throw new Error(t('errors.failedToDeletePlan'));
      setAllPlans((prev) => prev.filter((p) => p.id !== savedPlanId));
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
          headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: savedPlanId, status: newStatus }),
      });

      setAllPlans((prev) =>
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
        headers: { 'Content-Type': 'application/json' },
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
    <div className="min-h-[calc(100vh-6rem)] flex flex-col">
      {/* Week Navigation Header */}
      <div className="border-b border-slate-700/50 bg-slate-900/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Calendar className="h-5 w-5 text-primary-400" />
            <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setWeekOffset((o) => o - 1)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="text-center min-w-[180px]">
              <p className="text-sm font-medium text-white">{weekLabel}</p>
              <p className="text-xs text-slate-500">
                {weekOffset === 0 ? t('thisWeek') : weekOffset === 1 ? t('nextWeek') : weekOffset === -1 ? t('lastWeek') : ''}
              </p>
            </div>

            <button
              onClick={() => setWeekOffset((o) => o + 1)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            {weekOffset !== getDefaultOffset() && (
              <button
                onClick={() => setWeekOffset(getDefaultOffset())}
                className="min-h-[44px] text-xs text-primary-400 hover:text-primary-300 ms-2"
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
          <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
        </div>
      )}

      {/* No plan for this week */}
      {!loadingPlans && !currentPlan && !showCreate && !parsing && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-6 max-w-sm">
            <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto">
              <Calendar className="h-7 w-7 text-slate-500" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">{t('noPlan')}</h2>
              <p className="text-sm text-slate-400">
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
                    const res = await fetch('/api/plans/import-program', { method: 'POST' });
                    const data = await res.json();
                    if (data.results?.some((r: any) => r.status === 'imported')) {
                      const plansRes = await fetch(`/api/plans?coach_id=${HARDCODED_COACH_ID}`);
                      if (plansRes.ok) {
                        const plansData = await plansRes.json();
                        setAllPlans(plansData.plans || []);
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
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-600/15 flex items-center justify-center shrink-0">
                  <Sparkles className="h-5 w-5 text-primary-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white leading-tight">{t('createPlanFor', { group: weekLabel })}</h2>
                  <p className="text-xs text-slate-500">{t('aiParseHint')}</p>
                </div>
              </div>
              <button
                onClick={() => { setShowCreate(false); setError(null); }}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* This week's uploaded program — the coach's source material */}
            {programPdfUrl && (
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <FileText className="h-4 w-4 text-primary-400" />
                    {t('programFor', { group: weekLabel })}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowProgramViewer((v) => !v)}
                      className="min-h-[44px] flex items-center text-xs text-primary-400 hover:text-primary-300"
                    >
                      {showProgramViewer ? t('hide') : t('view')}
                    </button>
                    <a
                      href={programPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] flex items-center text-xs text-slate-400 hover:text-white"
                    >
                      {t('openArrow')}
                    </a>
                  </div>
                </div>
                {showProgramViewer && (
                  <iframe
                    src={programPdfUrl}
                    className="w-full border-0 border-t border-slate-700 bg-white"
                    style={{ height: '60vh' }}
                    title={t('programFor', { group: weekLabel })}
                  />
                )}
                <div className="px-4 py-2 border-t border-slate-700/60">
                  <button
                    onClick={syncFromProgram}
                    className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1.5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('parseProgramAutomatically')}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-slate-700/60 flex items-center justify-center shrink-0">
                  <FileText className="h-3.5 w-3.5 text-slate-400" />
                </div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t('pasteTextLabel')}</span>
              </div>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onPaste={handlePaste}
                placeholder={t('pasteYourPlan')}
                rows={7}
                className="w-full resize-none text-base leading-relaxed bg-slate-900/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              />

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-700/50" />
                <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">{t('or')}</span>
                <div className="flex-1 h-px bg-slate-700/50" />
              </div>

              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-slate-700/60 flex items-center justify-center shrink-0">
                  <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
                </div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t('uploadFileLabel')}</span>
              </div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => !imagePreview && document.getElementById('file-upload-input')?.click()}
                className={cn(
                  'relative border-2 border-dashed rounded-xl p-5 text-center transition-all',
                  imagePreview
                    ? 'border-primary-500 bg-primary-500/5'
                    : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50 cursor-pointer'
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
                    <div className="w-10 h-12 bg-red-500/20 rounded flex items-center justify-center">
                      <span className="text-red-400 text-xs font-bold">PDF</span>
                    </div>
                    <div className="text-start">
                      <p className="text-sm text-slate-300">{imageFile?.name}</p>
                      <p className="text-xs text-slate-500">{t('readyToParse')}</p>
                    </div>
                  </div>
                ) : imagePreview ? (
                  <img src={imagePreview} alt={t('uploadedPlanAlt')} className="max-h-24 mx-auto rounded" />
                ) : (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <Upload className="h-6 w-6 text-slate-500" />
                    <p className="text-sm text-slate-400">{t('dropImage')}</p>
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

            <Button onClick={parsePlan} disabled={!hasInput} size="lg" className="w-full">
              <Sparkles className="h-5 w-5" />
              {t('parsePlan')}
            </Button>
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
                <rect className="stair stair-1" x="10" y="95" width="24" height="6" rx="2" fill="#4338ff" />
                <rect className="stair stair-2" x="33" y="77" width="24" height="6" rx="2" fill="#4338ff" />
                <rect className="stair stair-3" x="56" y="59" width="24" height="6" rx="2" fill="#4338ff" />
                <rect className="stair stair-4" x="79" y="41" width="24" height="6" rx="2" fill="#4338ff" />
                <rect className="stair stair-5" x="102" y="23" width="24" height="6" rx="2" fill="#4338ff" />
                <rect x="33" y="83" width="3" height="12" rx="1" fill="#4338ff" opacity="0.15" />
                <rect x="56" y="65" width="3" height="12" rx="1" fill="#4338ff" opacity="0.15" />
                <rect x="79" y="47" width="3" height="12" rx="1" fill="#4338ff" opacity="0.15" />
                <rect x="102" y="29" width="3" height="12" rx="1" fill="#4338ff" opacity="0.15" />
                <circle className="runner-dot" cx="0" cy="0" r="5" fill="#4338ff" />
              </svg>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">{savingAfterParse ? t('savingPlan') : t('parsingPlan')}</h2>
              <p className="text-sm text-slate-400">{savingAfterParse ? t('finalizingWeek') : t('readingWorkouts')}</p>
            </div>
            <div className="w-48 mx-auto h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-primary-600 via-purple-500 to-primary-600 rounded-full animate-progress-indeterminate" />
            </div>
            <button
              onClick={cancelParsing}
              className="min-h-[44px] px-4 text-sm text-slate-500 hover:text-slate-300 transition-colors"
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
          <div className="px-4 sm:px-6 py-3 border-b border-slate-700/50 bg-slate-800/30">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-slate-300 shrink-0">
                  {workoutCount} {t('workouts')}
                </span>
                <span className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded-full text-3xs font-medium shrink-0',
                  currentPlan.status === 'pushed' ? 'text-green-400 bg-green-400/10' :
                  currentPlan.status === 'partial' ? 'text-orange-400 bg-orange-400/10' :
                  'text-yellow-400 bg-yellow-400/10'
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
                  className={cn(editMode && 'ring-1 ring-primary-500')}
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
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('remove')}</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Group tabs */}
          <div className="border-b border-slate-700/50 px-6 py-2 bg-slate-800/20">
            <SegmentedControl
              value={String(activeGroup)}
              onChange={(v) => setActiveGroup(Number(v) as 1 | 2 | 3)}
              options={[1, 2, 3].map((g) => ({ value: String(g), label: t('groupLabel', { n: g }) }))}
            />
          </div>

          {/* Week view */}
          <div className="flex-1 px-6 py-6 w-full">
            {error && <ErrorBanner message={error} className="mb-4" />}

            <WeekView
              workouts={groupedPlans[`group${activeGroup}` as keyof GroupedWeeklyPlans].workouts}
              editable={editMode}
              onWorkoutChange={handleWorkoutChange}
            />
          </div>

          {/* Bottom action bar */}
          <div className="border-t border-slate-700 bg-slate-900/80 backdrop-blur px-6 py-4 sticky bottom-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {editMode && (
                  <Button variant="secondary" size="sm" onClick={saveDraft} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {t('saveChanges')}
                  </Button>
                )}
                {lastSavedAt && (
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
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
          <div className="flex items-center justify-between border-t border-slate-700 bg-slate-800/30 px-5 py-4">
            <span className="text-xs text-slate-500">
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
            <p className="mb-3 text-xs text-slate-400">
              {t('clipboardStudioDesc')}
            </p>

            <SegmentedControl
              value={String(activeGroup)}
              onChange={(v) => setActiveGroup(Number(v) as 1 | 2 | 3)}
              options={[1, 2, 3].map((group) => ({ value: String(group), label: t('groupLabel', { n: group }) }))}
              className="mb-4"
            />

            <div className="grid md:grid-cols-[260px_1fr] gap-4">
              <aside className="md:border-e border-slate-700 md:pe-3">
                <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
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
                          ? 'border-primary-500 bg-primary-500/10'
                          : 'border-slate-700 bg-slate-800/40 hover:border-slate-600',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase text-slate-500">
                          {DAY_LABELS[workout.dayOfWeek]}
                          {workout.partCount && workout.partCount > 1
                            ? ` · ${t('partLabel', { index: workout.partIndex ?? 0, count: workout.partCount })}`
                            : ''}
                        </span>
                        {workout.clipboardImageUrl && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-400">
                            {t('published')}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-white">{workout.name}</p>
                      <p className="mt-1 text-[10px] text-slate-500">
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
                            <h3 className="font-semibold text-white">{workout.name}</h3>
                            <p className="text-xs text-slate-500">
                              {workout.workoutKey} · {t('groupLabel', { n: activeGroup })}
                            </p>
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => setClipboardEditing(true)}>
                            <Edit3 className="h-4 w-4" />
                            {t('editSteps')}
                          </Button>
                        </div>
                        <div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                          {clipboardLoading && !clipboardPreview ? (
                            <Loader2 className="h-7 w-7 animate-spin text-primary-400" />
                          ) : clipboardPreview ? (
                            <img
                              src={clipboardPreview}
                              alt={workout.name}
                              className="max-h-[560px] max-w-full rounded-lg object-contain"
                            />
                          ) : (
                            <div className="text-center text-sm text-slate-500">
                              <ImageIcon className="mx-auto mb-2 h-8 w-8" />
                              {t('previewUnavailable')}
                            </div>
                          )}
                        </div>
                      </section>

                      <section className="space-y-5">
                        <div>
                          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                            {t('aiReadableText')}
                          </h4>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-xs leading-6 text-slate-200">
                            {clipboardText || workout.clipboardText || t('rendering')}
                          </pre>
                        </div>

                        <div className="rounded-xl border border-slate-700 bg-slate-800/35 p-4">
                          <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                            <Sparkles className="h-4 w-4 text-purple-400" />
                            {t('refineWithAi')}
                          </h4>
                          <textarea
                            value={clipboardInstruction}
                            onChange={(event) => setClipboardInstruction(event.target.value)}
                            placeholder={t('refinePlaceholder')}
                            className="mt-3 min-h-24 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-primary-500 focus:outline-none"
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

                        <div className="rounded-xl border border-primary-500/30 bg-primary-500/5 p-4 text-xs text-slate-300">
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
          onChange={(workout) => handleWorkoutChange(clipboardWorkoutIndex, workout)}
          onClose={() => setClipboardEditing(false)}
        />
      )}

      <Sheet
        open={showMatchReview}
        onOpenChange={setShowMatchReview}
        title={t('matchReviewTitle')}
        footer={
          <div className="flex justify-between border-t border-slate-700 bg-slate-800/30 p-4">
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
            <p className="mb-4 text-xs text-slate-400">
              {t('matchReviewDesc')}
            </p>
            <div className="min-h-0">
              {matchReviewLoading && !matchReview ? (
                <div className="flex h-52 items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-primary-400" />
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
                    const day = new Date(activity.start_time).getUTCDay();
                    const candidates = matchReview.workouts.filter(
                      (workout) => workout.dayOfWeek === day,
                    );
                    return (
                      <div
                        key={activity.id}
                        className="grid gap-3 rounded-xl border border-slate-700 bg-slate-800/35 p-4 md:grid-cols-[1fr_1.3fr]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-white">
                              {athlete?.name || activity.athlete_id}
                            </span>
                            <span className="text-xs text-slate-500">
                              {new Date(activity.start_time).toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB', {
                                weekday: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'UTC',
                              })}
                            </span>
                            {match && (
                              <span className={cn(
                                'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase',
                                match.match_method === 'manual'
                                  ? 'bg-purple-500/15 text-purple-300'
                                  : 'bg-emerald-500/15 text-emerald-300',
                              )}>
                                {match.match_method === 'manual' ? t('matchManual') : t('matchAuto')}
                                {match.score != null ? ` ${Math.round(match.score)}` : ''}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-sm text-slate-300">
                            {activity.activity_name || t('runFallback')} ·{' '}
                            {activity.distance ? `${(activity.distance / 1000).toFixed(2)} km` : '—'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setMatchPickerActivityId(activity.id)}
                          disabled={matchReviewLoading}
                          className="w-full min-h-[44px] flex items-center justify-between gap-2 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white text-start disabled:opacity-50"
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
                          <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-16 text-center text-sm text-slate-500">
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
          const day = new Date(activity.start_time).getUTCDay();
          const candidates = matchReview.workouts.filter((workout) => workout.dayOfWeek === day);
          const match = matchReview.matches.find((candidate) => candidate.activity_id === activity.id);
          return (
            <InsetSection>
              <InsetRow
                label={t('noMatchedWorkout')}
                onClick={() => { setMatchPickerActivityId(null); void setManualMatch(activity.id, null); }}
                trailing={!match ? <Check className="h-4 w-4 text-primary-400" /> : <span className="w-4 h-4" />}
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
                  trailing={match?.workout_key === workout.workoutKey ? <Check className="h-4 w-4 text-primary-400" /> : <span className="w-4 h-4" />}
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
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">
                      {pushResults.filter((r) => r.status === 'success').length} {t('succeeded')}
                    </span>
                  </div>
                  {pushResults.some((r) => r.status === 'failed') && (
                    <div className="flex items-center gap-2 text-red-400">
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
                          ? 'bg-green-500/5 border-green-500/20'
                          : 'bg-red-500/5 border-red-500/20'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {r.status === 'success' ? (
                          <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                        )}
                        <div>
                          <span className="text-sm font-medium">{r.athleteName}</span>
                          {r.error && <p className="text-xs text-red-400 mt-0.5">{r.error}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-700">
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
                  <div className="mt-4 pb-4 border-b border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-400">{t('workoutsToSend')}</span>
                      <div className="flex items-center gap-2">
                        {planDays.includes(new Date().getDay()) && (
                          <button
                            onClick={() => setPushDays([new Date().getDay()])}
                            className="text-2xs text-primary-400 hover:text-primary-300"
                          >
                            {t('todayOnly')}
                          </button>
                        )}
                        <button
                          onClick={() => setPushDays(null)}
                          className={cn(
                            'text-2xs',
                            pushDays === null ? 'text-primary-400 font-medium' : 'text-slate-500 hover:text-slate-300'
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
                                ? 'bg-primary-500/15 border-primary-500/50 text-primary-300'
                                : 'border-slate-700 text-slate-500 hover:border-slate-600',
                              isToday && 'ring-1 ring-primary-500/40'
                            )}
                            title={DAY_LABELS[d]}
                          >
                            {DAY_LABELS[d]}{isToday ? ' •' : ''}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-3xs text-slate-500 mt-2">
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
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
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
                                <p className="text-sm text-slate-400 mt-0.5">
                                  {t('garminWillReceive', { ready: readyCount, count: workoutCount })}
                                </p>
                              </div>
                            );
                          })()}

                          {groups.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center py-6">{t('noGroupsFound')}</p>
                          ) : (
                            groups.map((group, groupIdx) => {
                              const groupColor =
                                groupIdx === 0 ? { iconBg: 'bg-green-500', label: t('groupLabel', { n: 1 }) } :
                                groupIdx === 1 ? { iconBg: 'bg-yellow-500', label: t('groupLabel', { n: 2 }) } :
                                { iconBg: 'bg-orange-500', label: t('groupLabel', { n: 3 }) };
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
                                      <span className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
                                        {t('readyOfTotal', { ready: readyMembers.length, total: members.length })}
                                        {isOpen ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
                                      </span>
                                    }
                                  />
                                  {isOpen && (
                                    members.length === 0 ? (
                                      <div className="px-4 py-3 text-xs text-slate-500 text-center">{t('noAthletesInGroup')}</div>
                                    ) : (
                                      members.map((a) => (
                                        <InsetRow
                                          key={a.id}
                                          icon={Watch}
                                          iconBg={a.hasGarmin ? 'bg-emerald-600' : 'bg-slate-600'}
                                          label={a.name}
                                          trailing={
                                            a.hasGarmin ? (
                                              <span className="flex items-center gap-1 text-2xs text-green-400">
                                                <CheckCircle className="h-3.5 w-3.5" /> {t('garmin')}
                                              </span>
                                            ) : (
                                              <span className="flex items-center gap-1 text-2xs text-slate-500">
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
                              <p className="text-xs text-slate-500 text-center pt-1">
                                {t('withoutGroupNote', { count: ungrouped.length })}
                              </p>
                            );
                          })()}
                        </div>
                      )}

                      {pushTab === 'groups' && (
                        <div>
                          {groups.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center py-8">{t('noGroupsFound')}</p>
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
                                const iconBg = groupIdx === 0 ? 'bg-green-500' : groupIdx === 1 ? 'bg-yellow-500' : 'bg-orange-500';
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
                                        ? <CheckCircle2 className="h-5 w-5 text-primary-400" />
                                        : <span className="h-5 w-5 rounded-full border-2 border-slate-600" />
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
                            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <input
                              type="text"
                              value={athleteSearch}
                              onChange={(e) => setAthleteSearch(e.target.value)}
                              placeholder={t('searchAthletes')}
                              className="w-full min-h-[44px] ps-9 text-sm bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                            />
                          </div>

                          <div className="max-h-[300px] overflow-y-auto">
                            {filteredAthletes.length === 0 ? (
                              <p className="text-sm text-slate-400 text-center py-6">{t('noAthletesFound')}</p>
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
                                      iconBg={canPush ? 'bg-emerald-600' : 'bg-slate-600'}
                                      label={athlete.name}
                                      sublabel={athleteGroup?.name}
                                      onClick={canPush ? () => {
                                        setSelectedAthleteIds((prev) =>
                                          isSelected ? prev.filter((id) => id !== athlete.id) : [...prev, athlete.id]
                                        );
                                      } : undefined}
                                      trailing={
                                        !canPush
                                          ? <span className="text-3xs text-red-400/70 shrink-0">{t('noGarminTag')}</span>
                                          : isSelected
                                            ? <CheckCircle2 className="h-5 w-5 text-primary-400" />
                                            : <span className="h-5 w-5 rounded-full border-2 border-slate-600" />
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

                <div className="flex items-center justify-between pt-4 border-t border-slate-700">
                  <span className="text-sm text-slate-400">
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
