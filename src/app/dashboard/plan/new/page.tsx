'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
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
  ArrowLeft,
} from 'lucide-react';
import { WeekView } from '@/components/WeekView';
import { ParsedWorkout, ParsedWeeklyPlan } from '@/lib/ai/types';
import { cn } from '@/lib/utils';

const HARDCODED_COACH_ID = 'a34a0d10-1a1c-4b80-a1ca-e0044aa06232';

type Stage = 'input' | 'review' | 'push';
type PushTab = 'all' | 'groups' | 'athletes';

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
  athlete_count?: number;
}

interface PushResultItem {
  athleteId: string;
  athleteName: string;
  status: 'success' | 'failed';
  error?: string;
}

function getNextSunday(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  return sunday.toISOString().split('T')[0];
}

export default function NewPlanPage() {
  // --- Stage ---
  const [stage, setStage] = useState<Stage>('input');

  // --- Input stage ---
  const [inputText, setInputText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [weekStartDate, setWeekStartDate] = useState(getNextSunday);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Review stage ---
  const [parsedPlan, setParsedPlan] = useState<ParsedWeeklyPlan | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);

  // --- Push stage ---
  const [pushTab, setPushTab] = useState<PushTab>('all');
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingAthletes, setLoadingAthletes] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [athleteSearch, setAthleteSearch] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushResults, setPushResults] = useState<PushResultItem[] | null>(null);

  // --- Derived ---
  const hasInput = inputText.trim().length > 0 || imageFile !== null;
  const workoutCount = parsedPlan?.workouts.length ?? 0;

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

  // --- Fetch athletes & groups when push modal opens ---
  useEffect(() => {
    if (stage !== 'push') return;
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
        // silently handle — user will see empty lists
      } finally {
        setLoadingAthletes(false);
      }
    };
    fetchData();
  }, [stage]);

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
      setStage('review');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setParsing(false);
    }
  };

  const handleWorkoutChange = (index: number, workout: ParsedWorkout) => {
    if (!parsedPlan) return;
    const newWorkouts = [...parsedPlan.workouts];
    newWorkouts[index] = workout;
    setParsedPlan({ workouts: newWorkouts });
  };

  const savePlanAndGetId = async (): Promise<string> => {
    if (savedPlanId) return savedPlanId;

    const res = await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coach_id: HARDCODED_COACH_ID,
        week_start_date: weekStartDate,
        original_input:
          inputText || (imageFile ? `[Image: ${imageFile.name}]` : ''),
        parsed_workouts: { workouts: parsedPlan!.workouts },
        status: 'draft',
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save plan');
    }

    const data = await res.json();
    const id = data.plan.id;
    setSavedPlanId(id);
    return id;
  };

  const executePush = async () => {
    if (!parsedPlan) return;
    setPushing(true);
    setError(null);
    setPushResults(null);

    try {
      const planId = await savePlanAndGetId();

      let athleteIds: string[] = [];
      if (pushTab === 'all') {
        athleteIds = activeAthletes.map((a) => a.id);
      } else if (pushTab === 'groups') {
        athleteIds = activeAthletes
          .filter((a) => a.group_id && selectedGroupIds.includes(a.group_id))
          .map((a) => a.id);
      } else {
        athleteIds = selectedAthleteIds;
      }

      if (athleteIds.length === 0) {
        throw new Error('No athletes selected');
      }

      const res = await fetch('/api/garmin/push-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          workouts: parsedPlan.workouts,
          athleteIds,
          weekStartDate,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to push workouts');
      }

      const data = await res.json();
      setPushResults(data.results || []);

      // Update plan status
      const allSuccess = data.results?.every(
        (r: PushResultItem) => r.status === 'success'
      );
      const anySuccess = data.results?.some(
        (r: PushResultItem) => r.status === 'success'
      );
      const newStatus = allSuccess
        ? 'pushed'
        : anySuccess
          ? 'partial'
          : 'draft';

      await fetch('/api/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, status: newStatus }),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setPushing(false);
    }
  };

  const retryFailed = async () => {
    if (!pushResults || !parsedPlan) return;
    const failedIds = pushResults
      .filter((r) => r.status === 'failed')
      .map((r) => r.athleteId);

    if (failedIds.length === 0) return;

    setPushing(true);
    setError(null);

    try {
      const planId = savedPlanId!;
      const res = await fetch('/api/garmin/push-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          workouts: parsedPlan.workouts,
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

      // Merge: keep previous successes, replace failed with new results
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

  const startOver = () => {
    setStage('input');
    setInputText('');
    setImageFile(null);
    setImagePreview(null);
    setParsedPlan(null);
    setEditMode(false);
    setSavedPlanId(null);
    setError(null);
    setPushResults(null);
    setSelectedGroupIds([]);
    setSelectedAthleteIds([]);
    setAthleteSearch('');
    setPushTab('all');
    setWeekStartDate(getNextSunday());
  };

  const weekLabel = new Date(weekStartDate + 'T00:00:00').toLocaleDateString(
    'en-US',
    { month: 'short', day: 'numeric', year: 'numeric' }
  );

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────

  return (
    <div className="min-h-[calc(100vh-6rem)] flex flex-col">
      {/* ──── STAGE 1: INPUT ──── */}
      {stage === 'input' && !parsing && (
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-2xl space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold">Create Weekly Plan</h1>
              <p className="text-slate-400">
                Paste a training plan or upload an image to get started
              </p>
            </div>

            {/* Textarea */}
            <div className="space-y-2">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Paste your training plan from the coach..."
                rows={8}
                className="input w-full resize-none text-base leading-relaxed"
              />
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() =>
                document.getElementById('file-upload-input')?.click()
              }
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
                <img
                  src={imagePreview}
                  alt="Uploaded plan"
                  className="max-h-24 mx-auto rounded"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Upload className="h-6 w-6 text-slate-500" />
                  <p className="text-sm text-slate-400">
                    Drop an image or PDF here, or click to browse
                  </p>
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

            {/* Week start date */}
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-slate-400" />
              <label className="text-sm text-slate-400">Week starting:</label>
              <input
                type="date"
                value={weekStartDate}
                onChange={(e) => setWeekStartDate(e.target.value)}
                className="input text-sm"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Parse button */}
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

      {/* ──── PARSING LOADING STATE ──── */}
      {stage === 'input' && parsing && (
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-sm text-center space-y-8">
            {/* Oval track with runner */}
            <div className="relative w-64 h-40 mx-auto">
              {/* Track oval */}
              <svg className="w-full h-full" viewBox="0 0 240 140">
                {/* Track surface */}
                <ellipse cx="120" cy="70" rx="100" ry="50" fill="none" stroke="currentColor" strokeWidth="12" className="text-slate-800" />
                {/* Lane lines */}
                <ellipse cx="120" cy="70" rx="100" ry="50" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-slate-600" />
                <ellipse cx="120" cy="70" rx="88" ry="44" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-slate-600" />
                {/* Group 1 - fastest (red) */}
                <circle r="6" fill="#ef4444">
                  <animateMotion dur="2.8s" repeatCount="indefinite">
                    <mpath href="#trackPath" />
                  </animateMotion>
                </circle>
                {/* Group 2 - middle (yellow) */}
                <circle r="5" fill="#eab308">
                  <animateMotion dur="3.2s" repeatCount="indefinite" begin="-1s">
                    <mpath href="#trackPath" />
                  </animateMotion>
                </circle>
                {/* Group 3 - slowest (blue) */}
                <circle r="4" fill="#6366f1">
                  <animateMotion dur="3.6s" repeatCount="indefinite" begin="-2s">
                    <mpath href="#trackPath" />
                  </animateMotion>
                </circle>
                {/* Hidden path for motion */}
                <path id="trackPath" d="M 20,70 A 100,50 0 1,1 20,69.99 Z" fill="none" />
              </svg>
              {/* Center label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-black text-slate-600 tracking-tight">300m</span>
              </div>
            </div>

            {/* Text */}
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">Parsing your plan...</h2>
              <p className="text-sm text-slate-400">
                Reading workouts and building your week
              </p>
            </div>

            {/* Progress dots */}
            <div className="flex items-center justify-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse [animation-delay:200ms]" />
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse [animation-delay:400ms]" />
            </div>
          </div>
        </div>
      )}

      {/* ──── STAGE 2: REVIEW ──── */}
      {stage === 'review' && parsedPlan && (
        <div className="flex-1 flex flex-col">
          {/* Summary header */}
          <div className="border-b border-slate-700 bg-slate-900/50 px-6 py-4">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-primary-400" />
                <div>
                  <h1 className="text-lg font-semibold">
                    {workoutCount} workout{workoutCount !== 1 ? 's' : ''} parsed
                  </h1>
                  <p className="text-sm text-slate-400">
                    Week of {weekLabel}
                  </p>
                </div>
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
                  {editMode ? 'Done Editing' : 'Edit'}
                </button>
                <button
                  onClick={startOver}
                  className="btn-secondary flex items-center gap-2 text-sm text-slate-400"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Start Over
                </button>
              </div>
            </div>
          </div>

          {/* Week view - hero */}
          <div className="flex-1 px-6 py-6 max-w-7xl mx-auto w-full">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm mb-4">
                {error}
              </div>
            )}

            <WeekView
              workouts={parsedPlan.workouts}
              editable={editMode}
              onWorkoutChange={handleWorkoutChange}
            />
          </div>

          {/* Bottom action bar */}
          <div className="border-t border-slate-700 bg-slate-900/80 backdrop-blur px-6 py-4 sticky bottom-0">
            <div className="flex items-center justify-end max-w-7xl mx-auto">
              <button
                onClick={() => {
                  setError(null);
                  setStage('push');
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

      {/* ──── STAGE 3: PUSH MODAL ──── */}
      {stage === 'push' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card max-w-xl w-full max-h-[85vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold">Push to Athletes</h2>
              <button
                onClick={() => {
                  setStage('review');
                  setPushResults(null);
                  setError(null);
                }}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Push results view */}
            {pushResults ? (
              <div className="flex-1 overflow-y-auto py-4 space-y-4">
                {/* Summary counts */}
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">
                      {pushResults.filter((r) => r.status === 'success').length}{' '}
                      succeeded
                    </span>
                  </div>
                  {pushResults.some((r) => r.status === 'failed') && (
                    <div className="flex items-center gap-2 text-red-400">
                      <XCircle className="h-5 w-5" />
                      <span className="font-medium">
                        {pushResults.filter((r) => r.status === 'failed').length}{' '}
                        failed
                      </span>
                    </div>
                  )}
                </div>

                {/* Result list */}
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
                          <span className="text-sm font-medium">
                            {r.athleteName}
                          </span>
                          {r.error && (
                            <p className="text-xs text-red-400 mt-0.5">
                              {r.error}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-700">
                  {pushResults.some((r) => r.status === 'failed') && (
                    <button
                      onClick={retryFailed}
                      disabled={pushing}
                      className="btn-secondary flex items-center gap-2"
                    >
                      {pushing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      Retry Failed
                    </button>
                  )}
                  <button onClick={startOver} className="btn-primary">
                    Create Another Plan
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Tabs */}
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

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto py-4 min-h-[200px]">
                  {loadingAthletes ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </div>
                  ) : (
                    <>
                      {/* All Athletes */}
                      {pushTab === 'all' && (
                        <div className="text-center py-8 space-y-3">
                          <Users className="h-12 w-12 text-slate-500 mx-auto" />
                          <div>
                            <p className="text-lg font-medium">
                              {activeAthletes.length} active athlete
                              {activeAthletes.length !== 1 ? 's' : ''}
                            </p>
                            <p className="text-sm text-slate-400 mt-1">
                              Push {workoutCount} workout
                              {workoutCount !== 1 ? 's' : ''} to everyone
                            </p>
                          </div>
                        </div>
                      )}

                      {/* By Group */}
                      {pushTab === 'groups' && (
                        <div className="space-y-2">
                          {groups.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center py-8">
                              No groups found
                            </p>
                          ) : (
                            groups.map((group) => {
                              const count = activeAthletes.filter(
                                (a) => a.group_id === group.id
                              ).length;
                              const isSelected = selectedGroupIds.includes(
                                group.id
                              );
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
                                        isSelected
                                          ? prev.filter((id) => id !== group.id)
                                          : [...prev, group.id]
                                      );
                                    }}
                                    className="rounded border-slate-600 text-primary-500 focus:ring-primary-500"
                                  />
                                  <div className="flex-1">
                                    <span className="text-sm font-medium">
                                      {group.name}
                                    </span>
                                  </div>
                                  <span className="text-xs text-slate-400">
                                    {count} athlete{count !== 1 ? 's' : ''}
                                  </span>
                                </label>
                              );
                            })
                          )}
                        </div>
                      )}

                      {/* Specific Athletes */}
                      {pushTab === 'athletes' && (
                        <div className="space-y-3">
                          {/* Search */}
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
                              <p className="text-sm text-slate-400 text-center py-6">
                                No athletes found
                              </p>
                            ) : (
                              filteredAthletes.map((athlete) => {
                                const isSelected =
                                  selectedAthleteIds.includes(athlete.id);
                                return (
                                  <label
                                    key={athlete.id}
                                    className={cn(
                                      'flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors',
                                      isSelected
                                        ? 'bg-primary-500/10'
                                        : 'hover:bg-slate-800'
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        setSelectedAthleteIds((prev) =>
                                          isSelected
                                            ? prev.filter(
                                                (id) => id !== athlete.id
                                              )
                                            : [...prev, athlete.id]
                                        );
                                      }}
                                      className="rounded border-slate-600 text-primary-500 focus:ring-primary-500"
                                    />
                                    <span className="text-sm">
                                      {athlete.name}
                                    </span>
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

                {/* Error */}
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                {/* Push action */}
                <div className="flex items-center justify-between pt-4 border-t border-slate-700">
                  <span className="text-sm text-slate-400">
                    {pushTargetCount} athlete
                    {pushTargetCount !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={executePush}
                    disabled={pushing || pushTargetCount === 0}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pushing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Pushing to {pushTargetCount} athlete
                        {pushTargetCount !== 1 ? 's' : ''}...
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
