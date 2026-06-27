'use client';

import { useState, useCallback } from 'react';
import { Upload, FileText, Loader2, Send, Eye, Edit3, Save, CheckCircle, XCircle, Calendar } from 'lucide-react';
import { WeekView } from '@/components/WeekView';
import { GroupSelector } from '@/components/GroupSelector';
import { ParsedWorkout, ParsedWeeklyPlan } from '@/lib/ai/types';
import { cn } from '@/lib/utils';

const HARDCODED_COACH_ID = 'a34a0d10-1a1c-4b80-a1ca-e0044aa06232';

export default function NewPlanPage() {
  const [inputText, setInputText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsedPlan, setParsedPlan] = useState<ParsedWeeklyPlan | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushResult, setPushResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [weekStartDate, setWeekStartDate] = useState(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
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
    setParsedPlan(null);

    try {
      let body: any = {};

      if (imageFile) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.readAsDataURL(imageFile);
        });
        body.image = base64;
        body.imageMediaType = imageFile.type;
      }

      if (inputText) {
        body.text = inputText;
      }

      const res = await fetch('/api/parse-workout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to parse');
      }

      const data: ParsedWeeklyPlan = await res.json();
      setParsedPlan(data);
    } catch (err: any) {
      setError(err.message);
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

  const savePlanAsDraft = async () => {
    if (!parsedPlan) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coach_id: HARDCODED_COACH_ID,
          week_start_date: weekStartDate,
          original_input: inputText || (imageFile ? `[Image: ${imageFile.name}]` : null),
          parsed_workouts: { workouts: parsedPlan.workouts },
          status: 'draft',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save plan');
      }

      const data = await res.json();
      setSavedPlanId(data.plan.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const pushToAthletes = async () => {
    if (!parsedPlan) return;

    // If no plan is saved yet, save it first
    let planId = savedPlanId;
    if (!planId) {
      setSaving(true);
      setError(null);

      try {
        const res = await fetch('/api/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coach_id: HARDCODED_COACH_ID,
            week_start_date: weekStartDate,
            original_input: inputText || (imageFile ? `[Image: ${imageFile.name}]` : null),
            parsed_workouts: { workouts: parsedPlan.workouts },
            status: 'draft',
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to save plan');
        }

        const data = await res.json();
        planId = data.plan.id;
        setSavedPlanId(planId);
      } catch (err: any) {
        setError(err.message);
        setSaving(false);
        return;
      } finally {
        setSaving(false);
      }
    }

    // Fetch athletes from selected groups
    setPushing(true);
    setError(null);
    setPushResult(null);

    try {
      // Fetch all athletes from selected groups
      const athletesRes = await fetch(`/api/athletes?coach_id=${HARDCODED_COACH_ID}`);
      if (!athletesRes.ok) {
        throw new Error('Failed to fetch athletes');
      }

      const athletesData = await athletesRes.json();
      const allAthletes = athletesData.athletes || [];

      // Filter athletes by selected groups and active status
      const selectedAthletes = allAthletes.filter(
        (a: any) => a.group_id && selectedGroupIds.includes(a.group_id) && a.status === 'active'
      );

      if (selectedAthletes.length === 0) {
        throw new Error('No active athletes found in selected groups');
      }

      const athleteIds = selectedAthletes.map((a: any) => a.id);

      // Push workouts to athletes
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
        throw new Error(err.error || 'Failed to push');
      }

      const data = await res.json();
      setPushResult(data);

      // Update plan status based on results
      const allSuccess = data.results?.every((r: any) => r.status === 'success');
      const anySuccess = data.results?.some((r: any) => r.status === 'success');

      const newStatus = allSuccess ? 'pushed' : (anySuccess ? 'partial' : 'draft');

      await fetch('/api/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          status: newStatus,
        }),
      });

      setShowGroupSelector(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Weekly Plan</h1>
        <p className="text-slate-400 mt-1">Paste your training plan or upload an image</p>
      </div>

      {/* Input Section */}
      {!parsedPlan && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Text Input */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4" />
              Training Plan Text
            </label>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Paste your weekly training plan here...

Example:
Monday: Easy 8km
Tuesday: Rest
Wednesday: 2km WU, 5x1km at 4:30 with 2min rest, 2km CD
Thursday: Easy 6km
Friday: Rest
Saturday: Tempo 3km WU, 5km at threshold, 2km CD
Sunday: Long run 18km`}
              className="input w-full h-40 sm:h-64 resize-none"
            />
          </div>

          {/* Image Upload */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Upload className="h-4 w-4" />
              Or Upload Image / PDF
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className={cn(
                'border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer h-40 sm:h-64 flex flex-col items-center justify-center',
                imagePreview
                  ? 'border-primary-500 bg-primary-500/5'
                  : 'border-slate-600 hover:border-slate-500'
              )}
              onClick={() => document.getElementById('image-upload')?.click()}
            >
              {imagePreview === 'pdf' ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-14 bg-red-500/20 rounded-lg flex items-center justify-center">
                    <span className="text-red-400 text-xs font-bold">PDF</span>
                  </div>
                  <p className="text-sm text-slate-300">{imageFile?.name}</p>
                  <p className="text-xs text-slate-500">Ready to parse</p>
                </div>
              ) : imagePreview ? (
                <img
                  src={imagePreview}
                  alt="Uploaded plan"
                  className="max-h-full max-w-full object-contain rounded"
                />
              ) : (
                <>
                  <Upload className="h-8 w-8 text-slate-500 mb-3" />
                  <p className="text-sm text-slate-400">
                    Drag & drop an image or PDF to upload
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Screenshots, photos of whiteboards, coach PDFs
                  </p>
                </>
              )}
              <input
                id="image-upload"
                type="file"
                accept="image/*,application/pdf"
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>
          </div>
        </div>
      )}

      {/* Week Start Date */}
      {!parsedPlan && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">Week starting:</label>
          <input
            type="date"
            value={weekStartDate}
            onChange={(e) => setWeekStartDate(e.target.value)}
            className="input text-sm"
          />
        </div>
      )}

      {/* Parse Button */}
      {!parsedPlan && (
        <button
          onClick={parsePlan}
          disabled={parsing || (!inputText && !imageFile)}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          {parsing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Parsing plan...
            </>
          ) : (
            <>
              <FileText className="h-4 w-4" />
              Parse Plan
            </>
          )}
        </button>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Parsed Result */}
      {parsedPlan && (
        <div className="space-y-4">
          {/* Summary Bar */}
          <div className="card bg-primary-500/10 border-primary-500/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-primary-400" />
                <div>
                  <div className="font-semibold text-primary-300">
                    {parsedPlan.workouts.length} workout{parsedPlan.workouts.length !== 1 ? 's' : ''} parsed
                  </div>
                  <div className="text-sm text-slate-400">
                    Week of {new Date(weekStartDate).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={weekStartDate}
                  onChange={(e) => setWeekStartDate(e.target.value)}
                  className="input text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Weekly Plan</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditMode(!editMode)}
                className={cn('btn-secondary flex items-center gap-2 text-sm', editMode && 'bg-primary-600')}
              >
                {editMode ? <Eye className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
                {editMode ? 'Preview' : 'Edit'}
              </button>
              <button
                onClick={() => {
                  setParsedPlan(null);
                  setError(null);
                  setPushResult(null);
                  setSavedPlanId(null);
                  setShowGroupSelector(false);
                }}
                className="btn-secondary text-sm"
              >
                Start Over
              </button>
            </div>
          </div>

          <WeekView
            workouts={parsedPlan.workouts}
            editable={editMode}
            onWorkoutChange={handleWorkoutChange}
          />

          {/* Action Buttons */}
          {!pushResult && (
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-700">
              <button
                onClick={savePlanAsDraft}
                disabled={saving || !!savedPlanId}
                className="btn-secondary flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : savedPlanId ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-400" />
                    Saved as Draft
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save as Draft
                  </>
                )}
              </button>
              <button
                onClick={() => setShowGroupSelector(true)}
                disabled={pushing || saving}
                className="btn-primary flex items-center gap-2"
              >
                <Send className="h-4 w-4" />
                Push to Athletes
              </button>
            </div>
          )}
        </div>
      )}

      {/* Group Selector Modal */}
      {showGroupSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="card max-w-lg w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Select Groups to Push To</h3>
              <button
                onClick={() => setShowGroupSelector(false)}
                className="text-slate-400 hover:text-white"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <GroupSelector
              coachId={HARDCODED_COACH_ID}
              selectedGroupIds={selectedGroupIds}
              onSelectionChange={setSelectedGroupIds}
            />

            <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-slate-700">
              <button
                onClick={() => setShowGroupSelector(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={pushToAthletes}
                disabled={pushing || selectedGroupIds.length === 0}
                className="btn-primary flex items-center gap-2"
              >
                {pushing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Pushing...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Push Workouts
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Push Result */}
      {pushResult && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">Push Results</h3>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1 text-green-400">
                <CheckCircle className="h-4 w-4" />
                <span>{pushResult.results?.filter((r: any) => r.status === 'success').length || 0} success</span>
              </div>
              <div className="flex items-center gap-1 text-red-400">
                <XCircle className="h-4 w-4" />
                <span>{pushResult.results?.filter((r: any) => r.status === 'failed').length || 0} failed</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {pushResult.results?.map((r: any, index: number) => (
              <div
                key={r.athleteId || index}
                className={cn(
                  'flex items-start justify-between p-3 rounded-lg border',
                  r.status === 'success'
                    ? 'bg-green-500/5 border-green-500/30'
                    : 'bg-red-500/5 border-red-500/30'
                )}
              >
                <div className="flex items-start gap-3">
                  {r.status === 'success' ? (
                    <CheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-400 mt-0.5" />
                  )}
                  <div>
                    <div className="font-medium">{r.athleteName}</div>
                    {r.status === 'failed' && r.error && (
                      <div className="text-sm text-red-400 mt-1">{r.error}</div>
                    )}
                  </div>
                </div>
                {r.status === 'success' && (
                  <span className="text-xs text-green-400 font-medium">PUSHED</span>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end mt-4 pt-4 border-t border-slate-700">
            <button
              onClick={() => {
                setParsedPlan(null);
                setPushResult(null);
                setSavedPlanId(null);
                setSelectedGroupIds([]);
                setInputText('');
                setImageFile(null);
                setImagePreview(null);
              }}
              className="btn-primary"
            >
              Create Another Plan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
