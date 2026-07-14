'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Sparkles, Send, CheckCircle2, XCircle, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COACH_ID } from '@/lib/constants';
import { formatPace } from '@/lib/garmin/pace';

interface AcademyAthlete {
  id: string;
  name: string;
  hasGarmin?: boolean;
}

interface Step {
  order: number;
  type: string;
  durationType: string;
  durationValue?: number;
  targetType: string;
  targetPaceMinPerKm?: number;
  targetPaceMaxPerKm?: number;
  notes?: string;
  repeatCount?: number;
  repeatSteps?: Step[];
}

interface Workout {
  dayOfWeek: number;
  name: string;
  steps: Step[];
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

function stepPaceText(step: Step): string {
  if (step.notes && /\d+:\d{2}/.test(step.notes)) return step.notes;
  if (step.targetPaceMinPerKm) {
    const min = step.targetPaceMinPerKm;
    const max = step.targetPaceMaxPerKm;
    return max && max !== min ? `${formatPace(min)}-${formatPace(max)}/km` : `${formatPace(min)}/km`;
  }
  return step.notes || '';
}

export function AcademyPlanComposer({ athletes }: { athletes: AcademyAthlete[] }) {
  const [athleteId, setAthleteId] = useState<string>('');
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));
  const [input, setInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!athleteId && athletes.length) setAthleteId(athletes[0].id);
  }, [athletes, athleteId]);

  // Reset the draft when switching athlete or week.
  useEffect(() => {
    setWorkouts(null);
    setPlanId(null);
    setPushResult(null);
    setError(null);
  }, [athleteId, weekStart]);

  const selected = athletes.find(a => a.id === athleteId);

  const parseAndSave = useCallback(async () => {
    if (!input.trim() || !athleteId) return;
    setParsing(true);
    setError(null);
    setPushResult(null);
    try {
      const parseRes = await fetch('/api/parse-workout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input }),
      });
      const parsed = await parseRes.json();
      if (!parseRes.ok) throw new Error(parsed.error || 'Failed to parse');
      const wks: Workout[] = parsed.workouts || [];
      setWorkouts(wks);

      // Save as an individual plan (athlete_id set). Stored flat — readers accept it.
      const saveRes = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coach_id: COACH_ID,
          week_start_date: weekStart,
          original_input: input,
          parsed_workouts: { workouts: wks },
          status: 'draft',
          athlete_id: athleteId,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || 'Failed to save');
      setPlanId(saveData.plan.id);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setParsing(false);
    }
  }, [input, athleteId, weekStart]);

  const push = useCallback(async () => {
    if (!workouts || !athleteId) return;
    setPushing(true);
    setError(null);
    setPushResult(null);
    try {
      const res = await fetch('/api/garmin/push-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          workouts,
          athleteIds: [athleteId],
          weekStartDate: weekStart,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Push failed');
      const results = data.results || [];
      const ok = results.length > 0 && results.every((r: any) => r.status === 'success');
      const failed = results.find((r: any) => r.status === 'failed');
      setPushResult({
        ok,
        msg: ok
          ? `Pushed to ${selected?.name}'s Garmin.`
          : failed?.error || 'Push failed.',
      });
      if (planId) {
        fetch('/api/plans', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_id: planId, status: ok ? 'pushed' : 'partial' }),
        }).catch(() => {});
      }
    } catch (err: any) {
      setError(err.message || 'Push failed');
    } finally {
      setPushing(false);
    }
  }, [workouts, athleteId, planId, weekStart, selected]);

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

      {/* Input */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">
          Paste the weekly plan (same format as the group planner)
        </label>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          rows={5}
          placeholder={"e.g. Tuesday: warmup 2km, 5x1km @ 3:40, easy 1km between…"}
          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-500 resize-y"
          dir="auto"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={parseAndSave}
            disabled={parsing || !input.trim()}
            className="flex items-center gap-2 px-4 h-10 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {parsing ? 'Parsing…' : 'Parse plan'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Preview */}
      {workouts && (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-white">
            {workouts.length} workout{workouts.length !== 1 ? 's' : ''} for {selected?.name}
          </div>
          {workouts.length === 0 ? (
            <p className="text-sm text-slate-500">No workouts parsed — check the input format.</p>
          ) : (
            [...workouts].sort((a, b) => a.dayOfWeek - b.dayOfWeek).map((w, i) => (
              <div key={i} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-primary-600/20 text-primary-300">
                    {DAY_LABELS[w.dayOfWeek] ?? '?'}
                  </span>
                  <span className="font-medium text-white text-sm">{w.name}</span>
                </div>
                <ul className="space-y-1 ps-1">
                  {w.steps.map((s, j) => (
                    <li key={j} className="text-xs text-slate-400 flex gap-2">
                      <span className="text-slate-500 capitalize shrink-0">{s.repeatCount ? `${s.repeatCount}×` : s.type}</span>
                      <span className="text-slate-300">{stepPaceText(s)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
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

          {workouts.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={push}
                disabled={pushing || !selected?.hasGarmin}
                title={selected?.hasGarmin ? '' : 'Athlete has no Garmin connected'}
                className="flex items-center gap-2 px-5 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {pushing ? 'Pushing…' : `Push to ${selected?.name?.split(' ')[0] || 'athlete'}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
