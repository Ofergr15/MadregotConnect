'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  Calendar, Users, ArrowRight, TrendingUp, TrendingDown,
  Sun, Cloud, CloudRain, Droplets, ChevronRight, MapPin, Zap, Wind, X, Repeat,
  Loader2, CheckCircle2, AlertCircle, RefreshCw, Dumbbell, Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from 'recharts';

const RACE_DATE = new Date('2026-12-06T09:00:00');
const TRAINING_BLOCK_START = new Date('2026-08-09T00:00:00');
const TOTAL_WEEKS = 17;

interface DashboardStats {
  athleteCount: number;
  totalAthletes: number;
  groupCount: number;
  planCount: number;
  deliverySuccessRate: number;
  recentActivity: Array<{ type: string; description: string; timestamp: string }>;
}

interface DaySession {
  min: number;
  max: number;
  type: string;
  name: string;
}

interface WeeklyData {
  dailyDistances: Array<{ day: string; dayOfWeek: number; min: number; max: number; type: string; sessions?: DaySession[] }>;
  weekTotalMin: number;
  weekTotalMax: number;
  weekDelta: number;
  prevWeekTotal: number;
  weeklyVolumes: Array<{ week: string; volume: number; weekNum: number }>;
  longRunProgression: Array<{ week: string; distance: number }>;
  keySessions: Array<{ day: string; dayOfWeek: number; name: string; type: string; totalKm: number; highlight: string; steps: any[] }>;
  typeDistribution: Record<string, number>;
  trainingDays: number;
  currentWeekStart: string;
}

interface WeatherDay {
  date: string; day: string; tempMin: number; tempMax: number;
  precipitation: number; windSpeed: number; humidity: number; code: number;
}

const typeColors: Record<string, string> = {
  intervals: '#ef4444', long_run: '#a855f7', tempo: '#f97316',
  fartlek: '#ec4899', progressive: '#14b8a6', easy: '#6366f1', rest: '#1e293b',
};

function inferRunTypeFromActivity(distanceKm: number, avgPaceSec: number | null): { type: string; label: string; color: string; bg: string } {
  const types: Record<string, { label: string; color: string; bg: string }> = {
    long_run: { label: 'Long Run', color: 'text-purple-400', bg: 'bg-purple-500/15' },
    tempo: { label: 'Tempo', color: 'text-orange-400', bg: 'bg-orange-500/15' },
    intervals: { label: 'Intervals', color: 'text-red-400', bg: 'bg-red-500/15' },
    easy: { label: 'Easy', color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
    recovery: { label: 'Recovery', color: 'text-slate-400', bg: 'bg-slate-500/15' },
  };

  if (distanceKm >= 16) return { type: 'long_run', ...types.long_run };
  if (avgPaceSec && avgPaceSec < 270 && distanceKm >= 8) return { type: 'tempo', ...types.tempo };
  if (avgPaceSec && avgPaceSec < 290 && distanceKm >= 6 && distanceKm < 14) return { type: 'intervals', ...types.intervals };
  if (distanceKm < 7 && avgPaceSec && avgPaceSec > 330) return { type: 'recovery', ...types.recovery };
  return { type: 'easy', ...types.easy };
}

const typeLabels: Record<string, string> = {
  intervals: 'Intervals', long_run: 'Long Run', tempo: 'Tempo',
  fartlek: 'Fartlek', progressive: 'Progressive', easy: 'Easy', rest: 'Rest',
};

function WeatherIcon({ code, className = "h-5 w-5" }: { code: number; className?: string }) {
  if (code <= 1) return <Sun className={cn(className, "text-amber-400")} />;
  if (code <= 3) return <Cloud className={cn(className, "text-slate-300")} />;
  if (code <= 67 || (code >= 80 && code <= 82)) return <CloudRain className={cn(className, "text-blue-400")} />;
  return <Cloud className={cn(className, "text-slate-300")} />;
}

function heatLevel(temp: number): { emoji: string; label: string; color: string } {
  if (temp >= 32) return { emoji: '🥵', label: 'Extreme', color: 'text-red-400' };
  if (temp >= 28) return { emoji: '🌡️', label: 'Hot', color: 'text-orange-400' };
  if (temp >= 22) return { emoji: '👌', label: 'Good', color: 'text-green-400' };
  return { emoji: '❄️', label: 'Cool', color: 'text-cyan-400' };
}

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (seconds >= 60) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return sec > 0 ? `${min}:${String(sec).padStart(2, '0')}` : `${min} min`;
  }
  return `${seconds}s`;
}

function getStepLabel(step: any): string {
  if (step.notes) return step.notes;
  const labels: Record<string, string> = {
    warmup: 'Warmup', cooldown: 'Cooldown', interval: 'Hard',
    active: 'Run', rest: 'Recovery', recovery: 'Recovery',
  };
  return labels[step.type] || step.type;
}

function getStepColor(step: any): string {
  if (step.type === 'warmup' || step.type === 'cooldown') return '#f59e0b';
  if (step.type === 'interval' || step.type === 'active') return '#ef4444';
  return '#64748b';
}

function summarizeSteps(steps: any[]): any[] {
  const summary: any[] = [];

  for (const step of steps) {
    if (step.repeatCount && step.repeatSteps) {
      // Check if repeat substeps are effort-based (no pace numbers in notes)
      const subsAreEffortBased = step.repeatSteps.every((sub: any) =>
        !sub.notes || !/\d:\d\d/.test(sub.notes)
      );
      // If parent has warmup-like duration+pace and substeps are effort-only,
      // extract the warmup as a separate phase
      if (subsAreEffortBased && step.notes && /דקות|דק/.test(step.notes) && /\d:\d\d/.test(step.notes) && step.durationValue && step.durationValue >= 300) {
        summary.push({
          type: 'phase',
          phase: 'warmup',
          steps: [{
            type: 'warmup',
            durationType: 'time',
            durationValue: step.durationValue,
            targetPaceMinPerKm: step.targetPaceMinPerKm,
            targetPaceMaxPerKm: step.targetPaceMaxPerKm,
          }],
        });
      }
      summary.push({ type: 'repeat', count: step.repeatCount, notes: step.notes, substeps: step.repeatSteps });
    } else if (step.type === 'warmup' || step.type === 'cooldown') {
      const prev = summary[summary.length - 1];
      if (prev?.type === 'phase' && prev.phase === step.type) {
        prev.steps.push(step);
      } else {
        summary.push({ type: 'phase', phase: step.type, steps: [step] });
      }
    } else if (step.type === 'rest' || step.type === 'recovery') {
      summary.push({ type: 'rest', step });
    } else {
      summary.push({ type: 'step', step });
    }
  }
  return summary;
}

function formatStepDuration(step: any): string {
  if (step.durationType === 'distance' && step.durationValue) {
    return step.durationValue >= 1000 ? `${step.durationValue / 1000} km` : `${step.durationValue}m`;
  }
  if (step.durationType === 'time' && step.durationValue) {
    return formatDuration(step.durationValue);
  }
  return '';
}

function isEffortBased(step: any): boolean {
  if (!step.notes) return false;
  const effortWords = /קל|מתון|בינוני|קשה|נוח|מתום/;
  return effortWords.test(step.notes);
}

function formatStepPace(step: any): string {
  if (isEffortBased(step)) return '';
  if (step.targetPaceMinPerKm && step.targetPaceMaxPerKm) {
    return `${formatPace(step.targetPaceMinPerKm)}–${formatPace(step.targetPaceMaxPerKm)}`;
  }
  if (step.targetPaceMinPerKm) return formatPace(step.targetPaceMinPerKm);
  return '';
}

function WorkoutDetailModal({ session, onClose }: { session: any; onClose: () => void }) {
  const blocks = summarizeSteps(session.steps || []);

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold text-[#4338ff] uppercase tracking-wider">{session.day}</p>
            <h3 className="text-lg font-bold text-white mt-1">{session.name}</h3>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm font-bold text-white">{session.totalKm} km</span>
              {session.highlight && (
                <code className="text-xs font-bold text-[#4338ff] bg-[#4338ff]/10 px-2 py-0.5 rounded">{session.highlight}</code>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Compact Workout Structure */}
        <div className="px-5 pb-5 overflow-y-auto max-h-[calc(80vh-100px)] space-y-2">
          {blocks.map((block, i) => {
            if (block.type === 'phase') {
              const step0 = block.steps[0];
              const durLabel = formatStepDuration(step0);
              const pace = formatStepPace(step0);
              return (
                <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-800/40">
                  <div className="w-1 h-5 rounded-full bg-amber-500 flex-shrink-0" />
                  <span className="text-sm text-white font-medium">{block.phase === 'warmup' ? 'Warmup' : 'Cooldown'}</span>
                  {durLabel && <span className="text-sm text-slate-400">{durLabel}</span>}
                  {pace && <span className="text-xs text-slate-500 ml-auto tabular-nums">{pace}</span>}
                </div>
              );
            }

            if (block.type === 'repeat') {
              const substeps = block.substeps || [];
              const summary = substeps.map((sub: any) => {
                const dur = formatStepDuration(sub);
                const label = getStepLabel(sub);
                const pace = formatStepPace(sub);
                return { dur, label, pace, isRest: sub.type === 'rest' || sub.type === 'recovery', step: sub };
              });

              return (
                <div key={i} className="rounded-lg border border-[#4338ff]/20 bg-[#4338ff]/5 px-3 py-2.5">
                  <div className="flex items-center gap-2 mb-2">
                    <Repeat className="h-3.5 w-3.5 text-[#4338ff]" />
                    <span className="text-sm font-bold text-white">{block.count}x</span>
                  </div>
                  <div className="space-y-1">
                    {summary.map((s: any, j: number) => (
                      <div key={j} dir="ltr" className="flex items-center gap-2 text-sm">
                        <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: getStepColor(s.step) }} />
                        <span className={cn("font-medium flex-shrink-0", s.isRest ? "text-slate-500" : "text-white")}>
                          {s.dur}
                        </span>
                        <span className="text-slate-400 truncate flex-1 text-right" dir="rtl">{s.label}</span>
                        {s.pace && <span className="text-xs text-slate-500 tabular-nums flex-shrink-0">{s.pace}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            if (block.type === 'rest') {
              const s = block.step;
              const dur = formatStepDuration(s) || 'Open';
              return (
                <div key={i} className="flex items-center gap-2 py-1.5 px-3 text-sm text-slate-500">
                  <div className="w-1 h-4 rounded-full bg-slate-600" />
                  <span>{s.notes || 'Recovery'}</span>
                  <span className="ml-auto">{dur}</span>
                </div>
              );
            }

            const s = block.step;
            const dur = formatStepDuration(s) || 'Open';
            const label = getStepLabel(s);
            const pace = formatStepPace(s);
            return (
              <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-slate-800/40 text-sm">
                <div className="w-1 h-5 rounded-full flex-shrink-0" style={{ background: getStepColor(s) }} />
                <span className="font-medium text-white">{label}</span>
                <span className="text-slate-400">{dur}</span>
                {pace && <span className="text-xs text-slate-500 ml-auto tabular-nums">{pace}</span>}
              </div>
            );
          })}

          {(!session.steps || session.steps.length === 0) && (
            <p className="text-sm text-slate-500 text-center py-8">No step details available</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface RecentActivity {
  id: string;
  athlete_name: string;
  activity_name: string;
  start_time: string;
  distance: number;
  duration: number;
  average_pace: number | null;
  average_hr: number | null;
}

type SyncStatus = 'syncing' | 'done' | 'error';

function FirstSyncModal({ status, syncedCount, error, onClose }: {
  status: SyncStatus;
  syncedCount: number;
  error?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm mx-4 p-6 text-center">
        <div className="flex flex-col items-center">
          {status === 'syncing' && (
            <>
              <div className="bg-[#4338ff]/20 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                <RefreshCw className="h-8 w-8 text-[#4338ff] animate-spin" />
              </div>
              <h2 className="text-lg font-bold text-white">Syncing Your Data</h2>
              <p className="text-sm text-slate-400 mt-2">
                Fetching your Garmin activities and setting up your dashboard...
              </p>
              <div className="mt-4 w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-[#4338ff] rounded-full animate-pulse" style={{ width: '60%' }} />
              </div>
            </>
          )}
          {status === 'done' && (
            <>
              <div className="bg-green-500/20 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="h-8 w-8 text-green-400" />
              </div>
              <h2 className="text-lg font-bold text-white">All Set!</h2>
              <p className="text-sm text-slate-400 mt-2">
                {syncedCount > 0
                  ? `Synced ${syncedCount} activities from Garmin.`
                  : 'Your dashboard is ready. Activities will appear after your next run!'}
              </p>
              <button
                onClick={onClose}
                className="mt-5 px-6 py-2.5 bg-[#4338ff] hover:bg-[#3730d4] text-white font-medium rounded-lg transition-colors"
              >
                Let&apos;s Go
              </button>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="bg-amber-500/20 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                <AlertCircle className="h-8 w-8 text-amber-400" />
              </div>
              <h2 className="text-lg font-bold text-white">Sync Issue</h2>
              <p className="text-sm text-slate-400 mt-2">
                {error || 'Could not sync activities. Your dashboard will update once data is available.'}
              </p>
              <button
                onClick={onClose}
                className="mt-5 px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                Continue to Dashboard
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [weather, setWeather] = useState<WeatherDay[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState({ d: 0, h: 0, m: 0, s: 0 });
  const [week, setWeek] = useState(0);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [selectedBar, setSelectedBar] = useState<number | null>(null);
  const lastClickRef = useRef<{ index: number; time: number } | null>(null);
  const [isCoach, setIsCoach] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [athleteName, setAthleteName] = useState<string>('');
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('syncing');
  const [syncedCount, setSyncedCount] = useState(0);
  const [syncError, setSyncError] = useState<string | undefined>();
  const [weeklyKm, setWeeklyKm] = useState(0);
  const [weeklyRuns, setWeeklyRuns] = useState(0);
  const [runnerWeeklyVolumes, setRunnerWeeklyVolumes] = useState<Array<{ week: string; km: number; runs: number }>>([]);
  const [leaderboard, setLeaderboard] = useState<Array<{ id: string; name: string; groupId: string; distanceKm: number; runs: number }>>([]);
  const [leaderboardFilter, setLeaderboardFilter] = useState<'all' | string>('all');
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const coachEmail = localStorage.getItem('coach_email');
    const storedAthleteId = localStorage.getItem('athlete_id');
    const name = localStorage.getItem('athlete_name') || '';
    setIsCoach(!!coachEmail);
    setAthleteId(storedAthleteId);
    setAthleteName(name);
  }, []);

  useEffect(() => {
    const tick = () => {
      const diff = RACE_DATE.getTime() - Date.now();
      if (diff <= 0) return;
      setCountdown({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
      const w = Math.floor((Date.now() - TRAINING_BLOCK_START.getTime()) / 604800000);
      setWeek(Math.max(0, Math.min(w + 1, TOTAL_WEEKS)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    async function load() {
      const myAthleteId = localStorage.getItem('athlete_id');
      const myIsCoach = !!localStorage.getItem('coach_email');
      const isFirstVisit = !localStorage.getItem('dashboard_synced');

      if (isFirstVisit && myAthleteId && !myIsCoach) {
        setShowSyncModal(true);
        setSyncStatus('syncing');
      }

      try {
        const [s, w] = await Promise.all([
          fetch('/api/dashboard/stats').then(r => r.json()),
          fetch('/api/dashboard/weekly').then(r => r.json()),
        ]);
        setStats(s);
        setWeekly(w);

        const wr = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=32.08&longitude=34.78&hourly=temperature_2m,relativehumidity_2m,precipitation,windspeed_10m,weathercode&timezone=Asia/Jerusalem&forecast_days=7'
        ).then(r => r.json());

        if (wr.hourly) {
          const dn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const map: Record<string, { t: number[]; h: number[]; p: number[]; w: number[]; c: number[] }> = {};
          wr.hourly.time.forEach((time: string, i: number) => {
            const hr = new Date(time).getHours();
            if (hr >= 5 && hr <= 8) {
              const dk = time.split('T')[0];
              if (!map[dk]) map[dk] = { t: [], h: [], p: [], w: [], c: [] };
              map[dk].t.push(wr.hourly.temperature_2m[i]);
              map[dk].h.push(wr.hourly.relativehumidity_2m?.[i] ?? 0);
              map[dk].p.push(wr.hourly.precipitation[i]);
              map[dk].w.push(wr.hourly.windspeed_10m[i]);
              map[dk].c.push(wr.hourly.weathercode[i]);
            }
          });
          setWeather(Object.entries(map).map(([date, d]) => ({
            date, day: dn[new Date(date).getDay()],
            tempMin: Math.round(Math.min(...d.t)), tempMax: Math.round(Math.max(...d.t)),
            humidity: Math.round(d.h.reduce((a, b) => a + b, 0) / d.h.length),
            precipitation: Math.round(d.p.reduce((a, b) => a + b, 0) * 10) / 10,
            windSpeed: Math.round(Math.max(...d.w)),
            code: d.c.sort((a, b) => b - a)[0],
          })));
        }

        if (isFirstVisit && myAthleteId && !myIsCoach) {
          try {
            const syncRes = await fetch('/api/garmin/sync-activities', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ athleteId: myAthleteId }),
            });
            if (syncRes.ok) {
              const syncData = await syncRes.json();
              setSyncedCount(syncData.synced || 0);
              setSyncStatus('done');
            } else {
              setSyncStatus('done');
              setSyncedCount(0);
            }
          } catch {
            setSyncStatus('error');
            setSyncError('Could not sync Garmin data.');
          }
          localStorage.setItem('dashboard_synced', '1');
        }

        const actRes = await fetch('/api/garmin/sync-activities');
        if (actRes.ok) {
          const actData = await actRes.json();
          const allActs = actData.activities || [];
          const filtered = myIsCoach ? allActs : allActs.filter((a: any) => a.athlete_id === myAthleteId);
          setRecentActivities(filtered.slice(0, 3));

          if (!myIsCoach && myAthleteId) {
            const now = new Date();
            const dayOfWeek = now.getDay();
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - dayOfWeek);
            weekStart.setHours(0, 0, 0, 0);

            const thisWeekActs = filtered.filter((a: any) => new Date(a.start_time) >= weekStart);
            const totalKm = thisWeekActs.reduce((sum: number, a: any) => sum + (a.distance || 0), 0) / 1000;
            setWeeklyKm(Math.round(totalKm * 10) / 10);
            setWeeklyRuns(thisWeekActs.length);

            const weekMap: Record<string, { km: number; runs: number }> = {};
            filtered.forEach((a: any) => {
              const d = new Date(a.start_time);
              const wStart = new Date(d);
              wStart.setDate(d.getDate() - d.getDay());
              const key = `${wStart.getDate().toString().padStart(2, '0')}/${(wStart.getMonth() + 1).toString().padStart(2, '0')}`;
              if (!weekMap[key]) weekMap[key] = { km: 0, runs: 0 };
              weekMap[key].km += (a.distance || 0) / 1000;
              weekMap[key].runs += 1;
            });

            const sortedWeeks = Object.entries(weekMap)
              .map(([week, data]) => ({ week, km: Math.round(data.km * 10) / 10, runs: data.runs }))
              .sort((a, b) => {
                const [dA, mA] = a.week.split('/').map(Number);
                const [dB, mB] = b.week.split('/').map(Number);
                return mA !== mB ? mA - mB : dA - dB;
              })
              .slice(-8);
            setRunnerWeeklyVolumes(sortedWeeks);
          }
        }
        if (!myIsCoach) {
          try {
            const [lbRes, grpRes] = await Promise.all([
              fetch('/api/groups/leaderboard'),
              fetch('/api/groups'),
            ]);
            if (lbRes.ok) {
              const lbData = await lbRes.json();
              setLeaderboard(lbData.leaderboard || []);
            }
            if (grpRes.ok) {
              const grpData = await grpRes.json();
              setGroups(grpData.groups || grpData || []);
            }
          } catch {}
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="animate-spin h-10 w-10 border-[3px] border-[#4338ff]/20 border-t-[#4338ff] rounded-full" />
    </div>
  );

  const todayDow = new Date().getDay();
  const hasData = weekly && weekly.weekTotalMax > 0;
  const todayWeather = weather.find(w => new Date(w.date).getDay() === todayDow);
  const todayWorkout = weekly?.dailyDistances?.find(d => d.dayOfWeek === todayDow);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-6 sm:space-y-8">

      {/* ═══ RACE COUNTDOWN ═══ */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 sm:gap-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-4 w-4 text-[#4338ff]" />
              <span className="text-sm font-semibold text-slate-300">Valencia Marathon</span>
              <span className="text-sm text-slate-500">· Dec 6, 2026</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl sm:text-8xl font-black text-white leading-none tracking-tight tabular-nums">{countdown.d}</span>
              <span className="text-xl sm:text-2xl font-medium text-slate-400">days</span>
            </div>
            <div className="flex items-center gap-3 mt-2 tabular-nums text-base text-slate-300">
              <span className="font-semibold">{String(countdown.h).padStart(2, '0')}h</span>
              <span className="font-semibold">{String(countdown.m).padStart(2, '0')}m</span>
              <span className="text-slate-500">{String(countdown.s).padStart(2, '0')}s</span>
            </div>
          </div>

          <div className="sm:text-right">
            <p className="text-sm font-semibold text-slate-400 mb-1">Training Block</p>
            <p className="text-3xl sm:text-4xl font-black text-white">
              {week > 0 ? (
                <>Week <span className="text-[#4338ff]">{week}</span><span className="text-slate-500 text-xl font-medium">/{TOTAL_WEEKS}</span></>
              ) : (
                <span className="text-slate-400">Pre-season</span>
              )}
            </p>
            <div className="w-full sm:w-48 h-2 bg-slate-800 rounded-full mt-3 overflow-hidden sm:ml-auto">
              <div className="h-full bg-[#4338ff] rounded-full transition-all duration-1000" style={{ width: `${Math.max(4, (week / TOTAL_WEEKS) * 100)}%` }} />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ STATS ROW ═══ */}
      {isCoach ? (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-slate-800/50 rounded-2xl p-4 sm:p-5 border border-slate-700/30">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Weekly Volume</p>
            <p className="text-xl sm:text-2xl font-black text-white mt-2 tabular-nums">
              {hasData ? `${Math.round(weekly!.weekTotalMin)}–${Math.round(weekly!.weekTotalMax)}` : '—'}
              <span className="text-sm font-medium text-slate-500 ml-1">km</span>
            </p>
            {weekly?.weekDelta !== 0 && weekly?.weekDelta !== undefined && (
              <div className="flex items-center gap-1 mt-2">
                {weekly.weekDelta > 0 ? <TrendingUp className="h-3.5 w-3.5 text-green-400" /> : <TrendingDown className="h-3.5 w-3.5 text-amber-400" />}
                <span className={cn('text-sm font-semibold', weekly.weekDelta > 0 ? 'text-green-400' : 'text-amber-400')}>
                  {weekly.weekDelta > 0 ? '+' : ''}{weekly.weekDelta}%
                </span>
              </div>
            )}
          </div>
          <div className="bg-slate-800/50 rounded-2xl p-4 sm:p-5 border border-slate-700/30">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Training Days</p>
            <p className="text-xl sm:text-2xl font-black text-white mt-2 tabular-nums">
              {weekly?.trainingDays || 0}<span className="text-sm font-medium text-slate-500 ml-1">/7</span>
            </p>
            <p className="text-sm text-slate-500 mt-1">this week</p>
          </div>
          <div className="bg-slate-800/50 rounded-2xl p-4 sm:p-5 border border-slate-700/30">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Athletes</p>
            <p className="text-xl sm:text-2xl font-black text-white mt-2 tabular-nums">{stats?.athleteCount || 0}</p>
            <p className="text-sm text-slate-500 mt-1">{stats?.groupCount || 0} groups</p>
          </div>
          <div className="bg-slate-800/50 rounded-2xl p-4 sm:p-5 border border-slate-700/30">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Delivery</p>
            <p className="text-xl sm:text-2xl font-black text-white mt-2 tabular-nums">
              {stats?.deliverySuccessRate || 0}<span className="text-sm font-medium text-slate-500 ml-0.5">%</span>
            </p>
            <p className="text-sm text-slate-500 mt-1">success rate</p>
          </div>
        </section>
      ) : (
        <section className="space-y-3 sm:space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="bg-slate-800/50 rounded-2xl p-4 sm:p-5 border border-slate-700/30">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Weekly Volume</p>
              <p className="text-xl sm:text-2xl font-black text-white mt-2 tabular-nums">
                {weeklyKm > 0 ? weeklyKm : '—'}
                <span className="text-sm font-medium text-slate-500 ml-1">km</span>
              </p>
              {hasData && (
                <div className="mt-2">
                  <p className="text-xs text-slate-500">Target: {Math.round(weekly!.weekTotalMin)}–{Math.round(weekly!.weekTotalMax)} km</p>
                  <div className="w-full h-1.5 bg-slate-700 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', weeklyKm >= weekly!.weekTotalMin ? 'bg-emerald-400' : 'bg-[#4338ff]')}
                      style={{ width: `${Math.min(100, (weeklyKm / weekly!.weekTotalMax) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {!hasData && <p className="text-sm text-slate-500 mt-1">{weeklyRuns} {weeklyRuns === 1 ? 'run' : 'runs'}</p>}
            </div>

            <div className="bg-slate-800/50 rounded-2xl p-4 sm:p-5 border border-slate-700/30">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Training Days</p>
              <p className="text-xl sm:text-2xl font-black text-white mt-2 tabular-nums">
                {weeklyRuns}<span className="text-sm font-medium text-slate-500 ml-1">/ {hasData ? weekly!.trainingDays : 7}</span>
              </p>
              <p className="text-sm text-slate-500 mt-1">completed</p>
            </div>
          </div>

          {leaderboard.length > 0 && (() => {
            const filtered = leaderboardFilter === 'all' ? leaderboard : leaderboard.filter(a => a.groupId === leaderboardFilter);
            const top3 = filtered.slice(0, 3);
            const myRank = filtered.findIndex(a => a.id === athleteId) + 1;
            const podiumColors = ['text-yellow-400', 'text-slate-300', 'text-amber-600'];
            const podiumBg = ['bg-yellow-500/10 border-yellow-500/30', 'bg-slate-500/10 border-slate-500/30', 'bg-amber-600/10 border-amber-600/30'];
            const podiumHeights = ['h-20', 'h-14', 'h-10'];
            return (
              <div className="bg-slate-800/50 rounded-2xl p-4 sm:p-5 border border-slate-700/30">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-yellow-400" />
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Top Runners This Week</p>
                  </div>
                  {groups.length > 1 && (
                    <select
                      value={leaderboardFilter}
                      onChange={(e) => setLeaderboardFilter(e.target.value)}
                      className="text-xs bg-slate-900/50 border border-slate-700/50 rounded-lg px-2 py-1 text-slate-300 focus:outline-none"
                    >
                      <option value="all">All Groups</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="flex items-end justify-center gap-3 sm:gap-4">
                  {top3.length >= 2 && (
                    <div className="flex flex-col items-center gap-1.5 flex-1">
                      <div className={cn('w-full rounded-t-lg border-t border-x flex items-end justify-center', podiumBg[1], podiumHeights[1])}>
                        <span className="text-lg font-black text-white pb-1">{top3[1].distanceKm}</span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-300">2nd</span>
                      <span className="text-xs text-slate-400 truncate max-w-full">{top3[1].name.split(' ')[0]}</span>
                    </div>
                  )}
                  {top3.length >= 1 && (
                    <div className="flex flex-col items-center gap-1.5 flex-1">
                      <div className={cn('w-full rounded-t-lg border-t border-x flex items-end justify-center', podiumBg[0], podiumHeights[0])}>
                        <span className="text-xl font-black text-white pb-1">{top3[0].distanceKm}</span>
                      </div>
                      <span className="text-[10px] font-bold text-yellow-400">1st</span>
                      <span className="text-xs text-slate-300 font-semibold truncate max-w-full">{top3[0].name.split(' ')[0]}</span>
                    </div>
                  )}
                  {top3.length >= 3 && (
                    <div className="flex flex-col items-center gap-1.5 flex-1">
                      <div className={cn('w-full rounded-t-lg border-t border-x flex items-end justify-center', podiumBg[2], podiumHeights[2])}>
                        <span className="text-lg font-black text-white pb-1">{top3[2].distanceKm}</span>
                      </div>
                      <span className="text-[10px] font-bold text-amber-600">3rd</span>
                      <span className="text-xs text-slate-400 truncate max-w-full">{top3[2].name.split(' ')[0]}</span>
                    </div>
                  )}
                </div>
                {myRank > 3 && (
                  <p className="text-xs text-slate-500 text-center mt-3">You&apos;re #{myRank} with {filtered[myRank - 1]?.distanceKm} km</p>
                )}
              </div>
            );
          })()}

          {todayWorkout && todayWorkout.max > 0 && (() => {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayActs = recentActivities.filter(a => new Date(a.start_time) >= todayStart);
            const todayKm = todayActs.reduce((sum, a) => sum + (a.distance || 0) / 1000, 0);
            const isCompleted = todayKm >= todayWorkout.min;
            return (
              <div className={cn(
                'rounded-2xl p-5 sm:p-6 border',
                isCompleted
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-gradient-to-br from-slate-800/80 to-slate-800/40 border-slate-700/30'
              )}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-300">Today&apos;s Workout</p>
                  <div className="flex items-center gap-2">
                    {isCompleted && (
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Done
                      </span>
                    )}
                    <div className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: `${typeColors[todayWorkout.type]}20`, color: typeColors[todayWorkout.type] }}>
                      {typeLabels[todayWorkout.type] || todayWorkout.type}
                    </div>
                  </div>
                </div>
                <div className="flex items-end justify-between mt-3">
                  <p className="text-4xl sm:text-5xl font-black text-white tabular-nums">
                    {todayWorkout.min === todayWorkout.max ? todayWorkout.max : `${todayWorkout.min}–${todayWorkout.max}`}
                    <span className="text-xl text-slate-400 ml-1">km</span>
                  </p>
                  {todayKm > 0 && (
                    <p className="text-sm font-semibold text-slate-300">
                      {Math.round(todayKm * 10) / 10} km done
                    </p>
                  )}
                </div>
              </div>
            );
          })()}
        </section>
      )}

      {/* ═══ DAILY KM BAR CHART ═══ */}
      <section className="bg-slate-800/30 rounded-2xl p-4 sm:p-6 border border-slate-700/20">
        <div className="flex items-center justify-between mb-4 sm:mb-5">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white">Weekly Plan</h2>
            <p className="text-sm text-slate-400 mt-0.5">Week of {weekly?.currentWeekStart || '—'}</p>
          </div>
          {hasData && (
            <div className="hidden sm:flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(weekly!.typeDistribution || {}).map(([type]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: typeColors[type] }} />
                  <span className="text-xs text-slate-400 font-medium">{typeLabels[type] || type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {hasData ? (
          <>
            {/* Custom Bar Chart */}
            <div className="relative" onMouseLeave={() => { setHoveredBar(null); setSelectedBar(null); }}>
              {/* Y-axis labels */}
              <div className="flex">
                <div className="w-6 sm:w-8 flex flex-col justify-between py-1 pr-2 h-48 sm:h-60">
                  {(() => {
                    const maxVal = Math.max(...weekly!.dailyDistances.map(d => d.max), 1);
                    const topTick = Math.ceil(maxVal / 8) * 8;
                    return [topTick, Math.round(topTick * 0.75), Math.round(topTick * 0.5), Math.round(topTick * 0.25), 0].map(v => (
                      <span key={v} className="text-[11px] text-slate-600 text-right leading-none">{v}</span>
                    ));
                  })()}
                </div>

                {/* Bars */}
                <div className="flex-1 flex items-end gap-1 sm:gap-2 h-48 sm:h-60">
                  {weekly!.dailyDistances.map((d, i) => {
                    const maxVal = Math.max(...weekly!.dailyDistances.map(x => x.max), 1);
                    const topTick = Math.ceil(maxVal / 8) * 8;
                    const session = weekly!.keySessions.find(s => s.dayOfWeek === d.dayOfWeek);
                    const isActive = hoveredBar === i || selectedBar === i;
                    const someActive = hoveredBar !== null || selectedBar !== null;
                    const sessions = d.sessions || [];
                    const hasMultiple = sessions.length > 1;

                    return (
                      <div
                        key={d.dayOfWeek}
                        className="flex-1 flex flex-col items-center justify-end h-full cursor-pointer group relative"
                        onMouseEnter={() => setHoveredBar(i)}
                        onClick={() => {
                          setSelectedBar(i);
                          if (session) setSelectedSession(session);
                        }}
                      >
                        {/* Tooltip on hover */}
                        {isActive && d.max > 0 && (
                          <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-10 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 shadow-xl whitespace-nowrap pointer-events-none">
                            <p className="text-xs font-bold text-white">{d.day}{hasMultiple && ' (2 sessions)'}</p>
                            <p className="text-[11px] text-slate-300">
                              {d.min && d.min !== d.max ? `${d.min}–${d.max}` : d.max} km · {typeLabels[d.type] || d.type}
                            </p>
                          </div>
                        )}

                        {/* The bar(s) */}
                        {hasMultiple ? (
                          <div className={cn(
                            'w-full max-w-[44px] flex gap-0.5 items-end transition-all duration-150',
                            isActive && 'scale-105',
                          )} style={{ height: `${(d.max / topTick) * 100}%`, minHeight: '4px' }}>
                            {sessions.map((s, j) => {
                              const segH = d.max > 0 ? (s.max / d.max) * 100 : 0;
                              return (
                                <div
                                  key={j}
                                  className={cn('flex-1 rounded-t-md', isActive && 'ring-1 ring-white/50')}
                                  style={{
                                    height: `${Math.max(segH, 20)}%`,
                                    backgroundColor: typeColors[s.type] || '#6366f1',
                                    opacity: someActive ? (isActive ? 1 : 0.3) : (d.dayOfWeek === todayDow ? 1 : 0.75),
                                    filter: isActive ? 'brightness(1.2)' : 'none',
                                  }}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <div
                            className={cn(
                              'w-full max-w-[32px] sm:max-w-[44px] rounded-t-lg transition-all duration-150',
                              isActive && 'ring-2 ring-white/60 scale-105',
                            )}
                            style={{
                              height: `${d.max > 0 ? (d.max / topTick) * 100 : 0}%`,
                              minHeight: d.max > 0 ? '4px' : '0px',
                              backgroundColor: typeColors[d.type] || '#6366f1',
                              opacity: someActive ? (isActive ? 1 : 0.3) : (d.dayOfWeek === todayDow ? 1 : 0.75),
                              filter: isActive ? 'brightness(1.2)' : 'none',
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* X-axis labels + day cards */}
              <div className="flex mt-3 ml-6 sm:ml-8">
                <div className="flex-1 grid grid-cols-7 gap-1 sm:gap-2">
                  {weekly!.dailyDistances.map((d, i) => {
                    const session = weekly!.keySessions.find(s => s.dayOfWeek === d.dayOfWeek);
                    const isActive = hoveredBar === i || selectedBar === i;
                    const sessions = d.sessions || [];
                    const hasMultiple = sessions.length > 1;
                    return (
                      <div
                        key={d.dayOfWeek}
                        onClick={() => session && setSelectedSession(session)}
                        className={cn(
                          "text-center py-2.5 sm:py-3 rounded-xl transition-all relative",
                          session ? "cursor-pointer" : "",
                          isActive ? "bg-slate-700/60 ring-1 ring-white/20" :
                            d.dayOfWeek === todayDow ? "bg-[#4338ff]/15 ring-1 ring-[#4338ff]/40" : "bg-slate-800/40 hover:bg-slate-700/40"
                        )}
                        onMouseEnter={() => setHoveredBar(i)}
                      >
                        {hasMultiple && (
                          <span className="absolute -top-1.5 -right-1 text-[8px] font-bold text-amber-300 bg-amber-500/25 border border-amber-500/40 px-1 py-0 rounded-full">
                            x{sessions.length}
                          </span>
                        )}
                        <p className={cn("text-xs font-bold uppercase", d.dayOfWeek === todayDow ? "text-[#4338ff]" : "text-slate-400")}>{d.day}</p>
                        <p className={cn("text-base sm:text-lg font-black tabular-nums mt-1", d.max > 0 ? "text-white" : "text-slate-600")}>
                          {d.max > 0 ? d.max : '—'}
                        </p>
                        {hasMultiple ? (
                          <div className="flex items-center justify-center gap-1 mt-0.5">
                            {sessions.map((s, j) => (
                              <div key={j} className="w-2 h-2 rounded-full" style={{ backgroundColor: typeColors[s.type] || '#6366f1' }} />
                            ))}
                          </div>
                        ) : (
                          <p className={cn("text-[10px] sm:text-xs mt-0.5 font-medium", d.max > 0 ? "text-slate-400" : "text-slate-600")}>
                            {d.max > 0 ? typeLabels[d.type] || d.type : 'Rest'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="h-52 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700/60">
            <Calendar className="h-10 w-10 text-slate-600 mb-3" />
            <p className="text-base text-slate-400">No plan loaded this week</p>
            <Link href="/dashboard/plan/new" className="mt-3 text-sm font-bold text-[#4338ff] hover:text-[#5b54ff] inline-flex items-center gap-1">
              Upload a plan <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </section>

      {/* ═══ RUNNER WEEKLY VOLUME + RECENT RUNS ═══ */}
      {!isCoach && runnerWeeklyVolumes.length > 1 && (() => {
        const maxKm = Math.max(...runnerWeeklyVolumes.map(w => w.km));
        const avgKm = Math.round(runnerWeeklyVolumes.reduce((s, w) => s + w.km, 0) / runnerWeeklyVolumes.length * 10) / 10;
        const lastWeek = runnerWeeklyVolumes[runnerWeeklyVolumes.length - 1];
        const prevWeek = runnerWeeklyVolumes[runnerWeeklyVolumes.length - 2];
        const trend = prevWeek && prevWeek.km > 0 ? Math.round(((lastWeek.km - prevWeek.km) / prevWeek.km) * 100) : 0;
        const yMax = Math.ceil(maxKm * 1.2 / 5) * 5 || 10;
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <section className="bg-slate-800/30 rounded-2xl border border-slate-700/20 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white">Weekly KM</h2>
                  <span className="text-[10px] text-slate-500">{avgKm} avg · {runnerWeeklyVolumes.length}w</span>
                </div>
                {trend !== 0 && (
                  <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-md', trend > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400')}>
                    {trend > 0 ? '+' : ''}{trend}%
                  </span>
                )}
              </div>
              <div className="h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={runnerWeeklyVolumes} margin={{ top: 4, right: 4, bottom: 0, left: -16 }} barCategoryGap="30%">
                    <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} dy={4} />
                    <YAxis tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} width={24} domain={[0, yMax]} tickCount={3} />
                    <Tooltip
                      cursor={{ fill: 'rgba(99,102,241,0.06)' }}
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #4338ff', borderRadius: '10px', fontSize: '11px', padding: '6px 10px', color: '#f1f5f9' }}
                      labelStyle={{ color: '#fff', fontWeight: 700 }}
                      formatter={(v: any, _: any, props: any) => [`${v} km · ${props?.payload?.runs || 0} runs`, '']}
                      labelFormatter={l => `Week of ${l}`}
                      separator=""
                    />
                    <Bar dataKey="km" radius={[4, 4, 0, 0]} maxBarSize={24}>
                      {runnerWeeklyVolumes.map((_, i) => (
                        <Cell key={i} fill={i === runnerWeeklyVolumes.length - 1 ? '#818cf8' : '#4f46e5'} opacity={0.6 + (i / runnerWeeklyVolumes.length) * 0.4} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {recentActivities.length > 0 && (
              <section className="bg-slate-800/30 rounded-2xl border border-slate-700/20 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-400" />
                    <h2 className="text-sm font-bold text-white">Recent Runs</h2>
                  </div>
                  <Link href="/dashboard/activities" className="text-[11px] font-semibold text-[#4338ff] hover:text-[#5b54ff] inline-flex items-center gap-0.5">
                    All <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="space-y-2">
                  {recentActivities.slice(0, 3).map((a) => {
                    const km = (a.distance / 1000).toFixed(1);
                    const kmNum = a.distance / 1000;
                    const pace = a.average_pace ? formatPace(a.average_pace) : null;
                    const date = new Date(a.start_time);
                    const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const runType = inferRunTypeFromActivity(kmNum, a.average_pace);
                    return (
                      <Link key={a.id} href="/dashboard/activities" className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/40 border border-slate-700/20 hover:border-[#4338ff]/30 transition-all">
                        <div className="flex items-center gap-2.5">
                          <div className={cn('w-2 h-2 rounded-full', runType.bg)} style={{ backgroundColor: runType.color.includes('#') ? runType.color : undefined }} />
                          <div>
                            <p className="text-xs font-semibold text-white">{km} km</p>
                            <p className="text-[10px] text-slate-500">{dateLabel}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {pace && <span className="text-[11px] font-bold text-emerald-400 tabular-nums">{pace}</span>}
                          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded', runType.bg, runType.color)}>{runType.label}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        );
      })()}


      {showSyncModal && (
        <FirstSyncModal
          status={syncStatus}
          syncedCount={syncedCount}
          error={syncError}
          onClose={() => setShowSyncModal(false)}
        />
      )}

      {selectedSession && (
        <WorkoutDetailModal session={selectedSession} onClose={() => setSelectedSession(null)} />
      )}

      {/* ═══ WEATHER FORECAST ═══ */}
      {weather.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm sm:text-base font-bold text-white">7-Day Weather</h2>
            <span className="text-sm text-slate-400">5–8am Tel Aviv</span>
          </div>
          {/* Mobile: horizontal scroll. Desktop: grid */}
          <div className="flex sm:grid sm:grid-cols-7 gap-2 overflow-x-auto sm:overflow-visible pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0">
            {weather.map((day, i) => {
              const isToday = new Date(day.date).getDay() === todayDow;
              return (
                <div key={i} className={cn(
                  "flex-shrink-0 w-[80px] sm:w-auto text-center py-4 px-2 rounded-2xl transition-all",
                  isToday ? "bg-[#4338ff]/15 ring-1 ring-[#4338ff]/40" : "bg-slate-800/40"
                )}>
                  <p className={cn("text-xs font-bold uppercase", isToday ? "text-[#4338ff]" : "text-slate-400")}>{isToday ? 'Today' : day.day}</p>
                  <WeatherIcon code={day.code} className="h-5 w-5 mx-auto mt-2" />
                  <p className={cn("text-lg font-black mt-2 tabular-nums", heatLevel(day.tempMax).color)}>{day.tempMax}°</p>
                  <p className="text-xs text-slate-400 mt-1">{day.humidity}%</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══ TRAINING LOAD CURVE ═══ */}
      {weekly?.weeklyVolumes && weekly.weeklyVolumes.length > 1 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm sm:text-base font-bold text-white">Training Load</h2>
            <Link href="/dashboard/history" className="text-sm font-semibold text-slate-400 hover:text-[#4338ff] inline-flex items-center gap-1 transition-colors">
              History <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="h-48 sm:h-56 rounded-2xl bg-slate-800/30 border border-slate-700/20 p-4 pt-6">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weekly.weeklyVolumes} margin={{ top: 0, right: 4, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4338ff" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#4338ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="weekNum" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `W${v}`} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={36} tickFormatter={v => `${v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', fontSize: '13px', padding: '8px 12px', color: '#f1f5f9' }}
                  labelStyle={{ color: '#fff', fontWeight: 700 }}
                  itemStyle={{ color: '#e2e8f0' }}
                  formatter={(v: any) => [`${v} km`, 'Volume']}
                  labelFormatter={l => `Week ${l}`}
                />
                <Area type="monotone" dataKey="volume" stroke="#4338ff" fill="url(#loadGrad)" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: '#4338ff', strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* ═══ QUICK LINKS ═══ */}
      <section className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-800/50">
        <Link href="/dashboard/program" className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white bg-[#4338ff] hover:bg-[#3730d4] transition-colors">
          <Dumbbell className="h-4 w-4" /> Program
        </Link>
        <Link href="/dashboard/activities" className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 transition-colors">
          <Zap className="h-4 w-4" /> Activities
        </Link>
        {isCoach && (
          <Link href="/dashboard/plan/new" className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 transition-colors">
            <Calendar className="h-4 w-4" /> Weekly Planner
          </Link>
        )}
        {isCoach && (
          <Link href="/dashboard/athletes" className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 transition-colors">
            <Users className="h-4 w-4" /> Athletes
          </Link>
        )}
      </section>

    </div>
  );
}
