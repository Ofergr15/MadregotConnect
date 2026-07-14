'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Send, CheckCircle2, XCircle, Calendar, ChevronLeft, ChevronRight,
  Plus, Pencil, Trash2, BookOpen, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { COACH_ID } from '@/lib/constants';
import { formatPace } from '@/lib/garmin/pace';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { WorkoutEditorPanel } from '@/components/WorkoutEditor';

interface AcademyAthlete {
  id: string;
  name: string;
  hasGarmin?: boolean;
}

interface LibraryWorkout {
  id: string;
  name: string;
  workout: ParsedWorkout;
  created_at: string;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function sundayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().split('T')[0];
}
function shiftWeek(weekStart: string, weeks: number): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().split('T')[0];
}
function fmtWeekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
}

function emptyWorkout(dayOfWeek: number): ParsedWorkout {
  return {
    dayOfWeek,
    name: `${DAY_FULL[dayOfWeek]} workout`,
    steps: [
      { order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'no_target' },
    ],
  };
}

function stepSummary(step: WorkoutStep): string {
  const dur = step.durationType === 'distance'
    ? `${((step.durationValue || 0) / 1000).toFixed(1)}km`
    : step.durationType === 'time'
      ? `${Math.round((step.durationValue || 0) / 60)}min`
      : 'lap';
  let pace = '';
  if (step.notes && /\d+:\d{2}/.test(step.notes)) pace = step.notes;
  else if (step.targetPaceMinPerKm) {
    const min = step.targetPaceMinPerKm, max = step.targetPaceMaxPerKm;
    pace = max && max !== min ? `${formatPace(min)}-${formatPace(max)}` : formatPace(min);
  }
  const rep = step.repeatCount ? `${step.repeatCount}× ` : '';
  return `${rep}${dur}${pace ? ` @ ${pace}` : ''}`;
}

export function AcademyPlanComposer({ athletes }: { athletes: AcademyAthlete[] }) {
  const [athleteId, setAthleteId] = useState('');
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));
  // Day-of-week (0=Sun..6=Sat) → the workout planned for that day.
  const [slots, setSlots] = useState<Record<number, ParsedWorkout>>({});
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [library, setLibrary] = useState<LibraryWorkout[]>([]);
  const [pickerDay, setPickerDay] = useState<number | null>(null);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!athleteId && athletes.length) setAthleteId(athletes[0].id);
  }, [athletes, athleteId]);

  const fetchLibrary = useCallback(async () => {
    try {
      const res = await fetch('/api/academy/workouts');
      const data = await res.json();
      setLibrary(data.workouts || []);
    } catch { /* library is optional */ }
  }, []);

  useEffect(() => { fetchLibrary(); }, [fetchLibrary]);

  // Reset the draft when switching athlete or week.
  useEffect(() => {
    setSlots({});
    setPushResult(null);
    setError(null);
  }, [athleteId, weekStart]);

  const selected = athletes.find(a => a.id === athleteId);
  const filledDays = Object.keys(slots).map(Number).sort((a, b) => a - b);

  const setSlot = (day: number, workout: ParsedWorkout) => {
    setSlots(prev => ({ ...prev, [day]: { ...workout, dayOfWeek: day } }));
    setPushResult(null);
  };
  const clearSlot = (day: number) => {
    setSlots(prev => {
      const next = { ...prev };
      delete next[day];
      return next;
    });
  };

  // Save a workout to the reusable library (fire-and-forget, refresh list).
  const saveToLibrary = useCallback(async (w: ParsedWorkout) => {
    try {
      await fetch('/api/academy/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: w.name, workout: w }),
      });
      fetchLibrary();
    } catch { /* non-blocking */ }
  }, [fetchLibrary]);

  const deleteLibraryWorkout = async (id: string) => {
    try {
      await fetch(`/api/academy/workouts?id=${id}`, { method: 'DELETE' });
      setLibrary(prev => prev.filter(w => w.id !== id));
    } catch { /* ignore */ }
  };

  const push = useCallback(async () => {
    if (!filledDays.length || !athleteId) return;
    setPushing(true);
    setError(null);
    setPushResult(null);
    const workouts = filledDays.map(d => slots[d]);
    try {
      // Save the plan (individual, flat) so it shows in adherence.
      const saveRes = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coach_id: COACH_ID,
          week_start_date: weekStart,
          original_input: '[built in-app]',
          parsed_workouts: { workouts },
          status: 'draft',
          athlete_id: athleteId,
        }),
      });
      const saveData = await saveRes.json();
      const planId = saveRes.ok ? saveData.plan?.id : null;

      const res = await fetch('/api/garmin/push-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, workouts, athleteIds: [athleteId], weekStartDate: weekStart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Push failed');
      const results = data.results || [];
      const ok = results.length > 0 && results.every((r: any) => r.status === 'success');
      const failed = results.find((r: any) => r.status === 'failed');
      setPushResult({ ok, msg: ok ? `Pushed ${workouts.length} workout${workouts.length !== 1 ? 's' : ''} to ${selected?.name}'s Garmin.` : (failed?.error || 'Push failed.') });
      if (planId) {
        fetch('/api/plans', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_id: planId, status: ok ? 'pushed' : 'partial' }),
        }).catch(() => {});
      }
    } catch (err: any) {
      setError(err.message || 'Push failed');
    } finally {
      setPushing(false);
    }
  }, [filledDays, slots, athleteId, weekStart, selected]);

  if (!athletes.length) {
    return (
      <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl p-10 text-center">
        <p className="text-slate-300 font-medium">No academy athletes yet</p>
        <p className="text-sm text-slate-500 mt-1">Add athletes in the Roster tab to build them individual plans.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Athlete + week */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Athlete</label>
          <select
            value={athleteId}
            onChange={e => setAthleteId(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 h-11 text-sm text-white focus:outline-none focus:border-primary-500"
          >
            {athletes.map(a => (
              <option key={a.id} value={a.id}>{a.name}{a.hasGarmin ? '' : ' (no Garmin)'}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Week</label>
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-xl h-11 px-1">
            <button onClick={() => setWeekStart(w => shiftWeek(w, -1))} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-white font-medium px-1 flex items-center gap-1.5 min-w-[150px] justify-center">
              <Calendar className="h-3.5 w-3.5 text-slate-500" /> {fmtWeekLabel(weekStart)}
            </span>
            <button onClick={() => setWeekStart(w => shiftWeek(w, 1))} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Day slots */}
      <div className="space-y-2">
        {DAY_LABELS.map((label, day) => {
          const w = slots[day];
          return (
            <div key={day} className="flex items-center gap-3 bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
              <div className="w-10 text-center shrink-0">
                <div className="text-xs font-bold text-slate-300">{label}</div>
              </div>
              {w ? (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{w.name}</div>
                    <div className="text-xs text-slate-400 truncate">
                      {w.steps.map(stepSummary).join(' · ')}
                    </div>
                  </div>
                  <button onClick={() => setEditingDay(day)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700" title="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => clearSlot(day)} className="p-2 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10" title="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-xs text-slate-500 flex-1">Rest / no workout</span>
                  <button
                    onClick={() => { setSlot(day, emptyWorkout(day)); setEditingDay(day); }}
                    className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-primary-600/20 text-primary-300 hover:bg-primary-600/30 text-xs font-semibold"
                  >
                    <Plus className="h-3.5 w-3.5" /> Build
                  </button>
                  <button
                    onClick={() => setPickerDay(day)}
                    disabled={library.length === 0}
                    className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-xs font-semibold disabled:opacity-40"
                    title={library.length ? 'Pick from library' : 'Library is empty'}
                  >
                    <BookOpen className="h-3.5 w-3.5" /> Library
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {pushResult && (
        <div className={cn(
          'flex items-center gap-2 rounded-xl px-4 py-3 text-sm border',
          pushResult.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'
        )}>
          {pushResult.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          {pushResult.msg}
        </div>
      )}

      {/* Push */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {filledDays.length} workout{filledDays.length !== 1 ? 's' : ''} planned
        </span>
        <button
          onClick={push}
          disabled={pushing || filledDays.length === 0 || !selected?.hasGarmin}
          title={selected?.hasGarmin ? '' : 'Athlete has no Garmin connected'}
          className="flex items-center gap-2 px-5 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {pushing ? 'Pushing…' : `Push to ${selected?.name?.split(' ')[0] || 'athlete'}`}
        </button>
      </div>

      {/* Structured builder — reuses the same editor as the group planner. On save,
          also store the workout in the library for reuse. */}
      {editingDay !== null && slots[editingDay] && (
        <WorkoutEditorPanel
          workout={slots[editingDay]}
          dayName={DAY_FULL[editingDay]}
          onChange={(w) => { setSlot(editingDay, w); saveToLibrary(w); }}
          onClose={() => setEditingDay(null)}
        />
      )}

      {/* Library picker */}
      {pickerDay !== null && (
        <LibraryPicker
          day={pickerDay}
          library={library}
          onPick={(w) => { setSlot(pickerDay, w); setPickerDay(null); }}
          onDelete={deleteLibraryWorkout}
          onClose={() => setPickerDay(null)}
        />
      )}
    </div>
  );
}

function LibraryPicker({
  day, library, onPick, onDelete, onClose,
}: {
  day: number;
  library: LibraryWorkout[];
  onPick: (w: ParsedWorkout) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary-400" />
            <h2 className="text-lg font-bold text-white">Workout library · {DAY_FULL[day]}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-2">
          {library.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">
              Your library is empty. Build a workout and it will be saved here for reuse.
            </p>
          ) : (
            library.map(item => (
              <div key={item.id} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-700/50 transition-colors">
                <button onClick={() => onPick(item.workout)} className="flex-1 min-w-0 text-start">
                  <div className="font-medium text-white text-sm truncate">{item.name}</div>
                  <div className="text-xs text-slate-400 truncate">
                    {(item.workout.steps || []).map(stepSummary).join(' · ')}
                  </div>
                </button>
                <button onClick={() => onDelete(item.id)} className="p-2 rounded-lg text-slate-500 hover:text-red-300 hover:bg-red-500/10 shrink-0" title="Delete from library">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
