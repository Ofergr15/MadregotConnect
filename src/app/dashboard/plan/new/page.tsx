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
  Plus,
} from 'lucide-react';
import { WeekView } from '@/components/WeekView';
import { ParsedWorkout, ParsedWeeklyPlan, GroupedWeeklyPlans, WorkoutStep } from '@/lib/ai/types';
import { splitIntoGroups } from '@/lib/ai/splitGroups';
import { cn } from '@/lib/utils';

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
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingAthletes, setLoadingAthletes] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [athleteSearch, setAthleteSearch] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushResults, setPushResults] = useState<PushResultItem[] | null>(null);

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

  // --- Load plan into editor when current plan changes ---
  useEffect(() => {
    if (currentPlan) {
      const workouts = currentPlan.parsed_workouts;
      if ('group1' in workouts && 'group2' in workouts && 'group3' in workouts) {
        setGroupedPlans(workouts as GroupedWeeklyPlans);
        setParsedPlan((workouts as GroupedWeeklyPlans).group1);
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

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to parse plan');
      }

      const data: ParsedWeeklyPlan = await res.json();
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

      if (targetAthletes.length === 0) {
        throw new Error('No athletes selected');
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

        const res = await fetch('/api/garmin/push-workouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planId: savedPlanId,
            workouts: plan.workouts,
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
          workouts: groupedPlans.group1.workouts,
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
                className="text-xs text-primary-400 hover:text-primary-300 ml-2"
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
                Upload a training plan image or paste text to create one for {weekLabel}.
              </p>
            </div>
            <div className="flex flex-col gap-3 items-center">
              <button
                onClick={() => setShowCreate(true)}
                className="btn-primary flex items-center gap-2 px-6 py-3"
              >
                <Plus className="h-5 w-5" />
                Create Plan
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
                  <div className="text-left">
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
              <div className="h-full bg-gradient-to-r from-[#4338ff] via-purple-500 to-[#4338ff] rounded-full animate-progress-indeterminate" />
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
                  'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
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
                const groupDist = groupWorkouts.reduce((s, w) => {
                  let d = 0;
                  const calc = (steps: WorkoutStep[]): number => {
                    let t = 0;
                    for (const step of steps) {
                      if (step.repeatCount && step.repeatSteps) t += calc(step.repeatSteps) * step.repeatCount;
                      else if (step.durationType === 'distance' && step.durationValue) t += step.durationValue;
                    }
                    return t;
                  };
                  d = calc(w.steps);
                  return s + d;
                }, 0);
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
                      'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold',
                      activeGroup === g ? colors.badge : 'bg-slate-700 text-slate-300'
                    )}>
                      {g}
                    </span>
                    <span>Group {g}</span>
                    {groupDist > 0 && (
                      <span className="text-[10px] text-slate-500 font-normal ml-1">
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
              workouts={groupedPlans[`group${activeGroup}` as keyof GroupedWeeklyPlans].workouts.filter((w, i, arr) => arr.findIndex(x => x.dayOfWeek === w.dayOfWeek) === i)}
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
                  setPushResults(null);
                  setShowPush(true);
                }}
                className="btn-primary flex items-center gap-2 px-6 py-2.5"
              >
                <Send className="h-4 w-4" />
                Push to Athletes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6">
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
                        <div className="text-center py-8 space-y-4">
                          <Users className="h-12 w-12 text-slate-500 mx-auto" />
                          <div>
                            <p className="text-lg font-medium">
                              {activeAthletes.length} active athlete{activeAthletes.length !== 1 ? 's' : ''}
                            </p>
                            <p className="text-sm text-slate-400 mt-1">
                              Push {workoutCount} workout{workoutCount !== 1 ? 's' : ''} to everyone
                            </p>
                          </div>
                          <div className="bg-slate-800 rounded-lg p-3 text-left text-xs text-slate-400 max-w-xs mx-auto">
                            <p className="font-medium text-slate-300 mb-1">Each athlete gets their group&apos;s plan:</p>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500" /> Group 1 — fastest paces</div>
                              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-500" /> Group 2 — middle paces</div>
                              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-indigo-500" /> Group 3 — adjusted paces</div>
                            </div>
                          </div>
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
                              const planLabel = groupIdx < 3 ? `Plan ${groupIdx + 1}` : 'Plan 3';
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
                                    'text-[10px] font-bold px-1.5 py-0.5 rounded',
                                    groupIdx === 0 ? 'bg-red-500/20 text-red-400' :
                                    groupIdx === 1 ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-indigo-500/20 text-indigo-400'
                                  )}>
                                    {planLabel}
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
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <input
                              type="text"
                              value={athleteSearch}
                              onChange={(e) => setAthleteSearch(e.target.value)}
                              placeholder="Search athletes..."
                              className="input w-full pl-9 text-sm"
                            />
                          </div>

                          <div className="space-y-1 max-h-[300px] overflow-y-auto">
                            {filteredAthletes.length === 0 ? (
                              <p className="text-sm text-slate-400 text-center py-6">No athletes found</p>
                            ) : (
                              filteredAthletes.map((athlete) => {
                                const isSelected = selectedAthleteIds.includes(athlete.id);
                                const athleteGroup = groups.find((g) => g.id === athlete.group_id);
                                return (
                                  <label
                                    key={athlete.id}
                                    className={cn(
                                      'flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors',
                                      isSelected ? 'bg-primary-500/10' : 'hover:bg-slate-800'
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        setSelectedAthleteIds((prev) =>
                                          isSelected ? prev.filter((id) => id !== athlete.id) : [...prev, athlete.id]
                                        );
                                      }}
                                      className="rounded border-slate-600 text-primary-500 focus:ring-primary-500"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <span className="text-sm">{athlete.name}</span>
                                    </div>
                                    {athleteGroup && (
                                      <span className="text-[10px] text-slate-500 shrink-0">{athleteGroup.name}</span>
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
                    disabled={pushing || pushTargetCount === 0}
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
                        Push Workouts
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
