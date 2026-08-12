'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
} from 'lucide-react';
import { WeekView } from '@/components/WeekView';
import { WorkoutEditorPanel } from '@/components/WorkoutEditor';
import { ParsedWorkout, ParsedWeeklyPlan, GroupedWeeklyPlans, WorkoutStep } from '@/lib/ai/types';
import { totalDistanceMeters } from '@/lib/workout-distance';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';

const HARDCODED_COACH_ID = '30f056a7-c651-490e-8356-615ea9eff097';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

function getWeekLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const endDate = new Date(date);
  endDate.setDate(date.getDate() + 6);
  const startLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

export default function WeeklyPlannerPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

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
  const weekLabel = getWeekLabel(weekStartDate);

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

  // --- Save state ---
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);

  // --- Delete ---
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImageFile(file);
      if (file.type === 'application/pdf') {
        setImagePreview('pdf');
      } else {
        const reader = new FileReader();
        reader.onload = () => setImagePreview(reader.result as string);
        reader.readAsDataURL(file);
      }
    },
    []
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/') || file.type === 'application/pdf') {
      setImageFile(file);
      if (file.type === 'application/pdf') {
        setImagePreview('pdf');
      } else {
        const reader = new FileReader();
        reader.onload = () => setImagePreview(reader.result as string);
        reader.readAsDataURL(file);
      }
    }
  }, []);

  const parsePlan = async () => {
    setError(null);
    setParsing(true);

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
          throw new Error('Parsing timed out. The plan may be too large or complex — try a clearer photo or paste the text.');
        }
        throw new Error(`Failed to parse plan (server error ${res.status}). Please try again.`);
      }

      if (!parsedBody) {
        throw new Error('The server returned an unexpected response. Please try again.');
      }

      const data: ParsedWeeklyPlan = parsedBody;
      setParsedPlan(data);
      const grouped = splitIntoGroups(data);
      setGroupedPlans(grouped);

      // Save immediately
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
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setParsing(false);
    }
  };

  // Pull this week's uploaded training PDF from the Program page, parse it, and
  // save it as the planner's plan for the week. Confirms before overwriting an
  // existing plan so manual edits/pushes aren't silently lost.
  const syncFromProgram = async () => {
    if (currentPlan) {
      const ok = window.confirm(
        `A plan already exists for ${weekLabel}. Replace it with the program for this week? Any edits you made will be lost.`
      );
      if (!ok) return;
    }

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
          throw new Error('Parsing timed out. The program PDF may be too large — try again.');
        }
        throw new Error(`Failed to sync from program (server error ${res.status}).`);
      }
      if (!parsedBody) {
        throw new Error('The server returned an unexpected response. Please try again.');
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
      setError(err instanceof Error ? err.message : 'Failed to sync from program');
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
      if (!res.ok) throw new Error(body.error || 'Failed to render clipboard');
      setClipboardPreview(body.previewDataUrl || null);
      setClipboardText(body.clipboardText || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to render clipboard');
    } finally {
      setClipboardLoading(false);
    }
  }, [savedPlanId]);

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
        if (!res.ok) throw new Error(body.error || `Could not refine Group ${group}`);
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
      setError(err instanceof Error ? err.message : 'Could not refine clipboard');
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
      if (!saveRes.ok) throw new Error('Could not save the reviewed plan');

      const res = await fetch(`/api/plans/${savedPlanId}/clipboards`, {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ action: 'publish' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Clipboard publishing failed');
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
      setError(err instanceof Error ? err.message : 'Clipboard publishing failed');
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
      if (!res.ok) throw new Error(body.error || 'Could not load activity matches');
      setMatchReview(body as MatchReviewData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load activity matches');
    } finally {
      setMatchReviewLoading(false);
    }
  }, [savedPlanId]);

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
      if (!res.ok) throw new Error(body.error || 'Could not update match');
      await loadMatchReview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update match');
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
        throw new Error(err.error || 'Failed to save');
      }
      setLastSavedAt(new Date());
      setAllPlans((prev) =>
        prev.map((p) => (p.id === savedPlanId ? { ...p, parsed_workouts: groupedPlans } : p))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
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
      if (!res.ok) throw new Error('Failed to delete');
      setAllPlans((prev) => prev.filter((p) => p.id !== savedPlanId));
      setSavedPlanId(null);
      setGroupedPlans(null);
      setParsedPlan(null);
      setConfirmDelete(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete plan');
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
        throw new Error('No athletes with Garmin connected selected');
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
          throw new Error(err.error || 'Failed to push workouts');
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
      setError(err instanceof Error ? err.message : 'Push failed');
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
        throw new Error(err.error || 'Retry failed');
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
      setError(err instanceof Error ? err.message : 'Retry failed');
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
      <div className="border-b border-slate-700 bg-slate-900/50 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Calendar className="h-5 w-5 text-primary-400" />
            <h1 className="text-lg font-semibold text-white">Weekly Planner</h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setWeekOffset((o) => o - 1)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="text-center min-w-[180px]">
              <p className="text-sm font-medium text-white">{weekLabel}</p>
              <p className="text-xs text-slate-500">
                {weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : weekOffset === -1 ? 'Last week' : ''}
              </p>
            </div>

            <button
              onClick={() => setWeekOffset((o) => o + 1)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            {weekOffset !== getDefaultOffset() && (
              <button
                onClick={() => setWeekOffset(getDefaultOffset())}
                className="text-xs text-primary-400 hover:text-primary-300 ms-2"
              >
                Current
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
              <h2 className="text-xl font-semibold text-white mb-2">No plan for this week</h2>
              <p className="text-sm text-slate-400">
                {programPdfUrl
                  ? `The training program for ${weekLabel} is uploaded — sync it into a plan, or create one manually.`
                  : `Upload a training plan image or paste text to create one for ${weekLabel}.`}
              </p>
            </div>
            <div className="flex flex-col gap-3 items-center">
              {programPdfUrl && (
                <button
                  onClick={syncFromProgram}
                  className="btn-primary flex items-center gap-2 px-6 py-3"
                >
                  <RefreshCw className="h-5 w-5" />
                  Sync from Program
                </button>
              )}
              <button
                onClick={() => setShowCreate(true)}
                className={programPdfUrl
                  ? 'text-sm text-slate-400 hover:text-white hover:bg-slate-800 px-4 py-2 rounded-lg border border-slate-700/50 transition-colors flex items-center gap-2'
                  : 'btn-primary flex items-center gap-2 px-6 py-3'}
              >
                <Plus className={programPdfUrl ? 'h-4 w-4' : 'h-5 w-5'} />
                {programPdfUrl ? 'Create manually' : 'Create Plan'}
              </button>
              <button
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
                      setError(data.results?.map((r: any) => `${r.week}: ${r.status}`).join(', ') || 'No plans imported');
                    }
                  } catch (err: any) {
                    setError(err.message || 'Import failed');
                  } finally {
                    setParsing(false);
                  }
                }}
                className="text-sm text-slate-400 hover:text-white hover:bg-slate-800 px-4 py-2 rounded-lg border border-slate-700/50 transition-colors"
              >
                Import from Program PDFs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create mode */}
      {!loadingPlans && !currentPlan && showCreate && !parsing && (
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-2xl space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Create Plan for {weekLabel}</h2>
              <button
                onClick={() => { setShowCreate(false); setError(null); }}
                className="text-slate-400 hover:text-white"
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
                    Program for {weekLabel}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowProgramViewer((v) => !v)}
                      className="text-xs text-primary-400 hover:text-primary-300"
                    >
                      {showProgramViewer ? 'Hide' : 'View'}
                    </button>
                    <a
                      href={programPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Open ↗
                    </a>
                  </div>
                </div>
                {showProgramViewer && (
                  <iframe
                    src={programPdfUrl}
                    className="w-full border-0 border-t border-slate-700 bg-white"
                    style={{ height: '60vh' }}
                    title={`Training program for ${weekLabel}`}
                  />
                )}
                <div className="px-4 py-2 border-t border-slate-700/60">
                  <button
                    onClick={syncFromProgram}
                    className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1.5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Parse this program automatically
                  </button>
                </div>
              </div>
            )}

            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste your training plan from the coach..."
              rows={8}
              className="input w-full resize-none text-base leading-relaxed"
            />

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload-input')?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer',
                imagePreview
                  ? 'border-primary-500 bg-primary-500/5'
                  : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50'
              )}
            >
              {imagePreview === 'pdf' ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-10 h-12 bg-red-500/20 rounded flex items-center justify-center">
                    <span className="text-red-400 text-xs font-bold">PDF</span>
                  </div>
                  <div className="text-start">
                    <p className="text-sm text-slate-300">{imageFile?.name}</p>
                    <p className="text-xs text-slate-500">Ready to parse</p>
                  </div>
                </div>
              ) : imagePreview ? (
                <img src={imagePreview} alt="Uploaded plan" className="max-h-24 mx-auto rounded" />
              ) : (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Upload className="h-6 w-6 text-slate-500" />
                  <p className="text-sm text-slate-400">Drop an image or PDF here, or click to browse</p>
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

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={parsePlan}
              disabled={!hasInput}
              className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText className="h-5 w-5" />
              Parse Plan
            </button>
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
              <h2 className="text-xl font-semibold text-white">Parsing your plan...</h2>
              <p className="text-sm text-slate-400">Reading workouts and building your week</p>
            </div>
            <div className="w-48 mx-auto h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-primary-600 via-purple-500 to-primary-600 rounded-full animate-progress-indeterminate" />
            </div>
          </div>
        </div>
      )}

      {/* Plan exists - show it */}
      {!loadingPlans && currentPlan && groupedPlans && parsedPlan && (
        <div className="flex-1 flex flex-col">
          {/* Status bar */}
          <div className="px-6 py-3 border-b border-slate-700/50 bg-slate-800/30">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-300">
                  {workoutCount} workout{workoutCount !== 1 ? 's' : ''}
                </span>
                <span className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded-full text-3xs font-medium',
                  currentPlan.status === 'pushed' ? 'text-green-400 bg-green-400/10' :
                  currentPlan.status === 'partial' ? 'text-orange-400 bg-orange-400/10' :
                  'text-yellow-400 bg-yellow-400/10'
                )}>
                  {currentPlan.status === 'pushed' ? <CheckCircle2 className="h-3 w-3" /> :
                   currentPlan.status === 'partial' ? <AlertCircle className="h-3 w-3" /> :
                   <Clock className="h-3 w-3" />}
                  {currentPlan.status}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={syncFromProgram}
                  className="btn-secondary flex items-center gap-2 text-sm"
                  title="Re-parse this week's training PDF from the Program page"
                >
                  <RefreshCw className="h-4 w-4" />
                  Sync
                </button>
                <button
                  onClick={() => setEditMode(!editMode)}
                  className={cn(
                    'btn-secondary flex items-center gap-2 text-sm',
                    editMode && 'ring-1 ring-primary-500'
                  )}
                >
                  <Edit3 className="h-4 w-4" />
                  {editMode ? 'Done' : 'Edit'}
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="btn-secondary flex items-center gap-2 text-sm text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              </div>
            </div>
          </div>

          {/* Group tabs */}
          <div className="border-b border-slate-700/50 px-6 bg-slate-800/20">
            <div className="flex gap-1 max-w-7xl mx-auto py-2">
              {([1, 2, 3] as const).map((g) => {
                const groupWorkouts = groupedPlans[`group${g}` as keyof GroupedWeeklyPlans].workouts;
                // Coach-aware total (matches dashboard + WeekView).
                const groupDist = totalDistanceMeters(groupWorkouts);
                const colors = g === 1
                  ? { active: 'bg-green-500/10 border-green-500/50 text-green-400', badge: 'bg-green-500 text-white', dot: 'bg-green-400' }
                  : g === 2
                  ? { active: 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400', badge: 'bg-yellow-500 text-white', dot: 'bg-yellow-400' }
                  : { active: 'bg-orange-500/10 border-orange-500/50 text-orange-400', badge: 'bg-orange-500 text-white', dot: 'bg-orange-400' };
                return (
                  <button
                    key={g}
                    onClick={() => setActiveGroup(g)}
                    className={cn(
                      'px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2.5 border',
                      activeGroup === g
                        ? colors.active
                        : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    )}
                  >
                    <span className={cn(
                      'inline-flex items-center justify-center w-5 h-5 rounded-full text-3xs font-bold',
                      activeGroup === g ? colors.badge : 'bg-slate-700 text-slate-300'
                    )}>
                      {g}
                    </span>
                    <span>Group {g}</span>
                    {groupDist > 0 && (
                      <span className="text-3xs text-slate-500 font-normal ms-1">
                        {(groupDist / 1000).toFixed(0)}km
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Week view */}
          <div className="flex-1 px-6 py-6 max-w-7xl mx-auto w-full">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm mb-4">
                {error}
              </div>
            )}

            <WeekView
              workouts={groupedPlans[`group${activeGroup}` as keyof GroupedWeeklyPlans].workouts}
              editable={editMode}
              onWorkoutChange={handleWorkoutChange}
            />
          </div>

          {/* Bottom action bar */}
          <div className="border-t border-slate-700 bg-slate-900/80 backdrop-blur px-6 py-4 sticky bottom-0">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
              <div className="flex items-center gap-3">
                {editMode && (
                  <button
                    onClick={saveDraft}
                    disabled={saving}
                    className="btn-secondary flex items-center gap-2 text-sm"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                )}
                {lastSavedAt && (
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Saved {lastSavedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setClipboardWorkoutIndex(0);
                  setShowClipboardReview(true);
                }}
                className="btn-primary flex items-center gap-2 px-6 py-2.5"
              >
                <ClipboardList className="h-4 w-4" />
                Review & Publish Clipboards
              </button>
            </div>
          </div>
        </div>
      )}

      {showClipboardReview && groupedPlans && savedPlanId && (
        <div className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm p-4 md:p-8">
          <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                  <ClipboardList className="h-5 w-5 text-primary-400" />
                  Clipboard Review Studio
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Review every independently recorded part. Publishing stores both structured text and a group-specific image.
                </p>
              </div>
              <button
                onClick={() => setShowClipboardReview(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close clipboard review"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-800/30 px-5 py-3">
              {([1, 2, 3] as const).map((group) => (
                <button
                  key={group}
                  onClick={() => setActiveGroup(group)}
                  className={cn(
                    'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                    activeGroup === group
                      ? 'border-primary-500 bg-primary-500/15 text-primary-300'
                      : 'border-slate-700 text-slate-400 hover:text-white',
                  )}
                >
                  Group {group}
                </button>
              ))}
            </div>

            <div className="grid min-h-0 flex-1 md:grid-cols-[300px_1fr]">
              <aside className="overflow-y-auto border-e border-slate-700 p-3">
                <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Workout parts
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
                          {DAY_SHORT[workout.dayOfWeek]}
                          {workout.partCount && workout.partCount > 1
                            ? ` · Part ${workout.partIndex}/${workout.partCount}`
                            : ''}
                        </span>
                        {workout.clipboardImageUrl && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-400">
                            Published
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-white">{workout.name}</p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {workout.expectedDistanceM
                          ? `${(workout.expectedDistanceM / 1000).toFixed(1)} km expected`
                          : workout.partKind || 'single'}
                      </p>
                    </button>
                  ))}
                </div>
              </aside>

              <main className="min-h-0 overflow-y-auto p-5">
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
                              {workout.workoutKey} · Group {activeGroup}
                            </p>
                          </div>
                          <button
                            onClick={() => setClipboardEditing(true)}
                            className="btn-secondary flex items-center gap-2 text-sm"
                          >
                            <Edit3 className="h-4 w-4" />
                            Edit steps
                          </button>
                        </div>
                        <div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                          {clipboardLoading && !clipboardPreview ? (
                            <Loader2 className="h-7 w-7 animate-spin text-primary-400" />
                          ) : clipboardPreview ? (
                            <img
                              src={clipboardPreview}
                              alt={`Clipboard preview for ${workout.name}`}
                              className="max-h-[560px] max-w-full rounded-lg object-contain"
                            />
                          ) : (
                            <div className="text-center text-sm text-slate-500">
                              <ImageIcon className="mx-auto mb-2 h-8 w-8" />
                              Preview unavailable
                            </div>
                          )}
                        </div>
                      </section>

                      <section className="space-y-5">
                        <div>
                          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                            AI-readable workout text
                          </h4>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-xs leading-6 text-slate-200">
                            {clipboardText || workout.clipboardText || 'Rendering…'}
                          </pre>
                        </div>

                        <div className="rounded-xl border border-slate-700 bg-slate-800/35 p-4">
                          <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                            <Sparkles className="h-4 w-4 text-purple-400" />
                            Refine with AI
                          </h4>
                          <textarea
                            value={clipboardInstruction}
                            onChange={(event) => setClipboardInstruction(event.target.value)}
                            placeholder="For example: split recovery into 90 seconds, keep the 3000m test as one open effort…"
                            className="mt-3 min-h-24 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-primary-500 focus:outline-none"
                          />
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <label className="flex items-center gap-2 text-xs text-slate-400">
                              Apply to
                              <select
                                value={clipboardRefineScope}
                                onChange={(event) =>
                                  setClipboardRefineScope(event.target.value as 'current' | 'all')
                                }
                                className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-white"
                              >
                                <option value="all">all groups</option>
                                <option value="current">current group only</option>
                              </select>
                            </label>
                            <button
                              onClick={refineClipboard}
                              disabled={clipboardLoading || !clipboardInstruction.trim()}
                              className="btn-secondary flex items-center gap-2 text-sm"
                            >
                              {clipboardLoading
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Sparkles className="h-4 w-4" />}
                              Refine
                            </button>
                          </div>
                        </div>

                        <div className="rounded-xl border border-primary-500/30 bg-primary-500/5 p-4 text-xs text-slate-300">
                          The PNG is an attachment for people. The structured workout and the text above are saved alongside it for matching and AI Coach analysis.
                        </div>
                      </section>
                    </div>
                  );
                })()}
              </main>
            </div>

            <div className="flex items-center justify-between border-t border-slate-700 bg-slate-800/30 px-5 py-4">
              <span className="text-xs text-slate-500">
                {groupedPlans.group1.workouts.length} parts × 3 groups
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setShowClipboardReview(false);
                    setShowMatchReview(true);
                  }}
                  disabled={clipboardLoading}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Search className="h-4 w-4" />
                  Activity matches
                </button>
                <button
                  onClick={saveDraft}
                  disabled={saving || clipboardLoading}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  Save draft
                </button>
                <button
                  onClick={publishClipboards}
                  disabled={clipboardLoading}
                  className="btn-primary flex items-center gap-2 px-5"
                >
                  {clipboardLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <CheckCircle2 className="h-4 w-4" />}
                  Publish all clipboards
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {clipboardEditing && groupedPlans && (
        <WorkoutEditorPanel
          workout={groupedPlans[`group${activeGroup}`].workouts[clipboardWorkoutIndex]}
          dayName={DAY_NAMES[groupedPlans[`group${activeGroup}`].workouts[clipboardWorkoutIndex]?.dayOfWeek]}
          onChange={(workout) => handleWorkoutChange(clipboardWorkoutIndex, workout)}
          onClose={() => setClipboardEditing(false)}
        />
      )}

      {showMatchReview && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 p-5">
              <div>
                <h2 className="text-lg font-semibold text-white">Activity → workout matches</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Automatic matches use date, part order, distance tolerance, and activity name. A staff selection becomes the durable override.
                </p>
              </div>
              <button
                onClick={() => setShowMatchReview(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
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
                              {new Date(activity.start_time).toLocaleString('en-GB', {
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
                                {match.match_method}
                                {match.score != null ? ` ${Math.round(match.score)}` : ''}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-sm text-slate-300">
                            {activity.activity_name || 'Run'} ·{' '}
                            {activity.distance ? `${(activity.distance / 1000).toFixed(2)} km` : '—'}
                          </p>
                        </div>
                        <select
                          value={match?.workout_key || ''}
                          onChange={(event) =>
                            void setManualMatch(activity.id, event.target.value || null)
                          }
                          disabled={matchReviewLoading}
                          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                        >
                          <option value="">No matched workout</option>
                          {candidates.map((workout) => (
                            <option key={workout.workoutKey} value={workout.workoutKey}>
                              {DAY_SHORT[workout.dayOfWeek]} ·{' '}
                              {workout.partCount && workout.partCount > 1
                                ? `Part ${workout.partIndex}/${workout.partCount} · `
                                : ''}
                              {workout.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-16 text-center text-sm text-slate-500">
                  No activities are stored for this plan week yet.
                </div>
              )}
            </div>
            <div className="flex justify-between border-t border-slate-700 bg-slate-800/30 p-4">
              <button
                onClick={() => {
                  setShowMatchReview(false);
                  setShowClipboardReview(true);
                }}
                className="btn-secondary"
              >
                Back to clipboards
              </button>
              <button
                onClick={() => void loadMatchReview()}
                disabled={matchReviewLoading}
                className="btn-secondary flex items-center gap-2"
              >
                {matchReviewLoading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
                Refresh matches
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl max-w-sm w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Trash2 className="w-5 h-5 text-red-400" />
              <h3 className="text-lg font-semibold text-white">Remove Plan</h3>
            </div>
            <p className="text-slate-300 text-sm mb-6">
              Are you sure you want to remove the plan for <span className="font-medium text-white">{weekLabel}</span>? This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 text-sm text-slate-300 hover:text-white rounded-lg border border-slate-600 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={deletePlan}
                disabled={deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors font-medium flex items-center gap-2"
              >
                {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Push Modal */}
      {showPush && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card max-w-xl w-full max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold">Push to Athletes</h2>
              <button
                onClick={() => { setShowPush(false); setPushResults(null); setError(null); }}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {pushResults ? (
              <div className="flex-1 overflow-y-auto py-4 space-y-4">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">
                      {pushResults.filter((r) => r.status === 'success').length} succeeded
                    </span>
                  </div>
                  {pushResults.some((r) => r.status === 'failed') && (
                    <div className="flex items-center gap-2 text-red-400">
                      <XCircle className="h-5 w-5" />
                      <span className="font-medium">
                        {pushResults.filter((r) => r.status === 'failed').length} failed
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
                    <button
                      onClick={retryFailed}
                      disabled={pushing}
                      className="btn-secondary flex items-center gap-2"
                    >
                      {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Retry Failed
                    </button>
                  )}
                  <button onClick={() => { setShowPush(false); setPushResults(null); }} className="btn-primary">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Which days to send — whole week (default) or specific days */}
                {planDays.length > 0 && (
                  <div className="mt-4 pb-4 border-b border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-400">Workouts to send</span>
                      <div className="flex items-center gap-2">
                        {planDays.includes(new Date().getDay()) && (
                          <button
                            onClick={() => setPushDays([new Date().getDay()])}
                            className="text-2xs text-primary-400 hover:text-primary-300"
                          >
                            Today only
                          </button>
                        )}
                        <button
                          onClick={() => setPushDays(null)}
                          className={cn(
                            'text-2xs',
                            pushDays === null ? 'text-primary-400 font-medium' : 'text-slate-500 hover:text-slate-300'
                          )}
                        >
                          Whole week
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
                            title={DAY_NAMES[d]}
                          >
                            {DAY_SHORT[d]}{isToday ? ' •' : ''}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-3xs text-slate-500 mt-2">
                      Sending {selectedDayCount} workout{selectedDayCount !== 1 ? 's' : ''} per athlete
                      {pushDays !== null && selectedDayCount === 0 && ' — select at least one day'}
                    </p>
                  </div>
                )}

                <div className="flex border-b border-slate-700 mt-4">
                  {([
                    { key: 'all', icon: Users, label: 'All Athletes' },
                    { key: 'groups', icon: Layers, label: 'By Group' },
                    { key: 'athletes', icon: UserCheck, label: 'Specific' },
                  ] as const).map(({ key, icon: Icon, label }) => (
                    <button
                      key={key}
                      onClick={() => setPushTab(key)}
                      className={cn(
                        'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                        pushTab === key
                          ? 'border-primary-500 text-primary-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto py-4 min-h-[200px]">
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
                                  {activeAthletes.length} active athlete{activeAthletes.length !== 1 ? 's' : ''}
                                </p>
                                <p className="text-sm text-slate-400 mt-0.5">
                                  {readyCount} Garmin-connected · will receive {workoutCount} workout{workoutCount !== 1 ? 's' : ''}
                                </p>
                              </div>
                            );
                          })()}

                          {groups.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center py-6">No groups found</p>
                          ) : (
                            groups.map((group, groupIdx) => {
                              const groupColor =
                                groupIdx === 0 ? { dot: 'bg-green-400', badge: 'bg-green-500/20 text-green-400', label: 'Group 1' } :
                                groupIdx === 1 ? { dot: 'bg-yellow-400', badge: 'bg-yellow-500/20 text-yellow-400', label: 'Group 2' } :
                                { dot: 'bg-orange-400', badge: 'bg-orange-500/20 text-orange-400', label: 'Group 3' };
                              const members = activeAthletes.filter((a) => a.group_id === group.id);
                              const readyMembers = members.filter((a) => a.hasGarmin);
                              const isOpen = expandedAllGroup === group.id;
                              return (
                                <div key={group.id} className="rounded-lg border border-slate-700 overflow-hidden">
                                  <button
                                    onClick={() => setExpandedAllGroup(isOpen ? null : group.id)}
                                    className="w-full flex items-center gap-3 p-3 hover:bg-slate-800/60 transition-colors"
                                  >
                                    <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', groupColor.dot)} />
                                    <div className="flex-1 text-start min-w-0">
                                      <span className="text-sm font-medium">{group.name}</span>
                                      <span className={cn('ms-2 text-3xs font-bold px-1.5 py-0.5 rounded', groupColor.badge)}>
                                        {groupColor.label}
                                      </span>
                                    </div>
                                    <span className="text-xs text-slate-400 shrink-0">
                                      {readyMembers.length}/{members.length} ready
                                    </span>
                                    {isOpen ? <ChevronUp className="h-4 w-4 text-slate-500 shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />}
                                  </button>
                                  {isOpen && (
                                    <div className="border-t border-slate-700/50 divide-y divide-slate-800">
                                      {members.length === 0 ? (
                                        <p className="text-xs text-slate-500 text-center py-3">No athletes in this group</p>
                                      ) : (
                                        members.map((a) => (
                                          <div key={a.id} className="flex items-center justify-between px-3 py-2 bg-slate-900/40">
                                            <span className="text-sm">{a.name}</span>
                                            {a.hasGarmin ? (
                                              <span className="flex items-center gap-1 text-2xs text-green-400">
                                                <CheckCircle className="h-3.5 w-3.5" /> Garmin
                                              </span>
                                            ) : (
                                              <span className="flex items-center gap-1 text-2xs text-slate-500">
                                                <XCircle className="h-3.5 w-3.5" /> Not connected
                                              </span>
                                            )}
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}

                          {/* Athletes with no group assigned */}
                          {(() => {
                            const ungrouped = activeAthletes.filter((a) => !a.group_id);
                            if (ungrouped.length === 0) return null;
                            return (
                              <p className="text-xs text-slate-500 text-center pt-1">
                                {ungrouped.length} athlete{ungrouped.length !== 1 ? 's' : ''} without a group (get Group 1 plan by default)
                              </p>
                            );
                          })()}
                        </div>
                      )}

                      {pushTab === 'groups' && (
                        <div className="space-y-2">
                          {groups.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center py-8">No groups found</p>
                          ) : (
                            [...groups].sort((a, b) => {
                              const aGoal = a.marathonGoal ? parseFloat(a.marathonGoal) : 999;
                              const bGoal = b.marathonGoal ? parseFloat(b.marathonGoal) : 999;
                              return aGoal - bGoal;
                            }).map((group, groupIdx) => {
                              const count = activeAthletes.filter((a) => a.group_id === group.id).length;
                              const isSelected = selectedGroupIds.includes(group.id);
                              const groupLabel = `Group ${Math.min(groupIdx + 1, 3)}`;
                              return (
                                <label
                                  key={group.id}
                                  className={cn(
                                    'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                                    isSelected
                                      ? 'border-primary-500/50 bg-primary-500/10'
                                      : 'border-slate-700 hover:border-slate-600'
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      setSelectedGroupIds((prev) =>
                                        isSelected ? prev.filter((id) => id !== group.id) : [...prev, group.id]
                                      );
                                    }}
                                    className="rounded border-slate-600 text-primary-500 focus:ring-primary-500"
                                  />
                                  <div className="flex-1">
                                    <span className="text-sm font-medium">{group.name}</span>
                                  </div>
                                  <span className={cn(
                                    'text-3xs font-bold px-1.5 py-0.5 rounded',
                                    groupIdx === 0 ? 'bg-green-500/20 text-green-400' :
                                    groupIdx === 1 ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-orange-500/20 text-orange-400'
                                  )}>
                                    {groupLabel}
                                  </span>
                                  <span className="text-xs text-slate-400">
                                    {count} athlete{count !== 1 ? 's' : ''}
                                  </span>
                                </label>
                              );
                            })
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
                              placeholder="Search athletes..."
                              className="input w-full ps-9 text-sm"
                            />
                          </div>

                          <div className="space-y-1 max-h-[300px] overflow-y-auto">
                            {filteredAthletes.length === 0 ? (
                              <p className="text-sm text-slate-400 text-center py-6">No athletes found</p>
                            ) : (
                              filteredAthletes.map((athlete) => {
                                const isSelected = selectedAthleteIds.includes(athlete.id);
                                const athleteGroupIdx = groups.findIndex((g) => g.id === athlete.group_id);
                                const athleteGroup = athleteGroupIdx >= 0 ? groups[athleteGroupIdx] : undefined;
                                // Can't push a workout to an athlete with no Garmin connected.
                                const canPush = !!athlete.hasGarmin;
                                return (
                                  <label
                                    key={athlete.id}
                                    className={cn(
                                      'flex items-center gap-3 p-2.5 rounded-lg transition-colors',
                                      !canPush ? 'opacity-50 cursor-not-allowed' :
                                        isSelected ? 'bg-primary-500/10 cursor-pointer' : 'hover:bg-slate-800 cursor-pointer'
                                    )}
                                    title={canPush ? '' : 'No Garmin connected — cannot push'}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      disabled={!canPush}
                                      onChange={() => {
                                        if (!canPush) return;
                                        setSelectedAthleteIds((prev) =>
                                          isSelected ? prev.filter((id) => id !== athlete.id) : [...prev, athlete.id]
                                        );
                                      }}
                                      className="rounded border-slate-600 text-primary-500 focus:ring-primary-500 disabled:opacity-50"
                                    />
                                    {/* Garmin status — green when connected, muted/red when not */}
                                    <Watch className={cn('h-4 w-4 shrink-0', canPush ? 'text-emerald-400' : 'text-red-400/60')} />
                                    <div className="flex-1 min-w-0">
                                      <span className="text-sm">{athlete.name}</span>
                                      {!canPush && <span className="ms-2 text-3xs text-red-400/70">no Garmin</span>}
                                    </div>
                                    {athleteGroup && (
                                      <span className={cn(
                                        'text-3xs font-bold px-1.5 py-0.5 rounded shrink-0',
                                        athleteGroupIdx === 0 ? 'bg-green-500/20 text-green-400' :
                                        athleteGroupIdx === 1 ? 'bg-yellow-500/20 text-yellow-400' :
                                        'bg-orange-500/20 text-orange-400'
                                      )}>
                                        {athleteGroup.name}
                                      </span>
                                    )}
                                  </label>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-slate-700">
                  <span className="text-sm text-slate-400">
                    {pushTargetCount} athlete{pushTargetCount !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={executePush}
                    disabled={pushing || pushTargetCount === 0 || selectedDayCount === 0}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pushing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Pushing to {pushTargetCount} athlete{pushTargetCount !== 1 ? 's' : ''}...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        {pushDays === null
                          ? 'Push Workouts'
                          : `Push ${selectedDayCount} Day${selectedDayCount !== 1 ? 's' : ''}`}
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
