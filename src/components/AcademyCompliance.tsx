'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Minus, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPace } from '@/lib/garmin/pace';

// Mirror of the adherence API response (kept structural to avoid importing server types).
type MetricStatus = 'on_target' | 'under' | 'over' | 'unknown';
type PaceStatus = 'on_target' | 'faster' | 'slower' | 'unknown';

interface WorkoutAdherence {
  date: string;
  name: string;
  completed: boolean;
  distance: { status: MetricStatus; plannedMin: number; plannedMax: number; actual: number | null };
  duration: { status: MetricStatus; planned: number; actual: number | null };
  pace: { status: PaceStatus; plannedMin: number | null; plannedMax: number | null; actual: number | null };
  score: number;
}

interface WeekAdherence {
  plannedCount: number;
  completedCount: number;
  completionRate: number;
  avgScore: number;
  workouts: WorkoutAdherence[];
}

interface AthleteAdherence {
  athleteId: string;
  name: string;
  week: WeekAdherence;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function sundayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
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

function km(meters: number | null): string {
  if (meters == null) return '—';
  return `${(meters / 1000).toFixed(1)}km`;
}

function mins(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.round(sec / 60);
  return `${m}min`;
}

function initialsOf(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function scoreColor(rate: number): string {
  if (rate >= 0.8) return 'text-emerald-400';
  if (rate >= 0.5) return 'text-amber-400';
  return 'text-red-400';
}

const metricStyle: Record<MetricStatus | PaceStatus, string> = {
  on_target: 'text-emerald-400',
  under: 'text-amber-400',
  over: 'text-amber-400',
  slower: 'text-amber-400',
  faster: 'text-sky-400',
  unknown: 'text-slate-500',
};

const metricLabel: Record<MetricStatus | PaceStatus, string> = {
  on_target: 'on target',
  under: 'under',
  over: 'over',
  slower: 'slower',
  faster: 'faster',
  unknown: '—',
};

export function AcademyCompliance() {
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));
  const [data, setData] = useState<AthleteAdherence[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchAdherence = useCallback(async (week: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/academy/adherence?weekStart=${week}`);
      const json = await res.json();
      setData(json.athletes || []);
    } catch (err) {
      console.error('Failed to fetch adherence:', err);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdherence(weekStart);
  }, [weekStart, fetchAdherence]);

  const isCurrentWeek = weekStart === sundayOf(new Date());

  return (
    <div>
      {/* Week selector */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <button
          onClick={() => setWeekStart(w => shiftWeek(w, -1))}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="Previous week"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center min-w-[180px]">
          <div className="text-sm font-semibold text-white">{fmtWeekLabel(weekStart)}</div>
          <div className="text-xs text-slate-500">{isCurrentWeek ? 'This week' : ''}</div>
        </div>
        <button
          onClick={() => setWeekStart(w => shiftWeek(w, 1))}
          disabled={isCurrentWeek}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next week"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-7 w-7 text-primary-500 animate-spin" />
        </div>
      ) : data.length === 0 ? (
        <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl p-10 text-center">
          <p className="text-slate-300 font-medium">No academy athletes to report on</p>
          <p className="text-sm text-slate-500 mt-1">Add athletes in the Roster tab first.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(a => {
            const w = a.week;
            const open = expanded === a.athleteId;
            return (
              <div key={a.athleteId} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setExpanded(open ? null : a.athleteId)}
                  className="w-full flex items-center gap-4 p-4 text-start hover:bg-slate-800/70 transition-colors"
                >
                  <div className="bg-primary-600/20 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-primary-300 shrink-0">
                    {initialsOf(a.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white truncate">{a.name}</div>
                    <div className="text-xs text-slate-400">
                      {w.completedCount}/{w.plannedCount} sessions done
                    </div>
                  </div>
                  {/* Sessions-done bar */}
                  <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                    {w.workouts.map((wk, i) => (
                      <span
                        key={i}
                        title={`${wk.name} — ${wk.completed ? 'done' : 'missed'}`}
                        className={cn(
                          'w-2.5 h-2.5 rounded-full',
                          wk.completed ? (wk.score >= 0.5 ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-slate-600'
                        )}
                      />
                    ))}
                  </div>
                  <div className={cn('text-right shrink-0 w-14', scoreColor(w.completionRate))}>
                    <div className="text-lg font-bold">{Math.round(w.completionRate * 100)}%</div>
                    <div className="text-[10px] text-slate-500 -mt-0.5">done</div>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-slate-700/50 divide-y divide-slate-700/30">
                    {w.workouts.length === 0 ? (
                      <div className="p-4 text-sm text-slate-500 text-center">No planned workouts this week.</div>
                    ) : (
                      w.workouts.map((wk, i) => {
                        const dayIdx = new Date(`${wk.date}T12:00:00Z`).getUTCDay();
                        return (
                          <div key={i} className="p-4 flex items-start gap-3">
                            <div className="shrink-0 w-10 text-center">
                              <div className="text-[10px] text-slate-500 font-medium">{DAY_LABELS[dayIdx]}</div>
                              {wk.completed
                                ? <CheckCircle2 className="h-5 w-5 text-emerald-400 mx-auto mt-1" />
                                : <XCircle className="h-5 w-5 text-slate-600 mx-auto mt-1" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-white text-sm truncate">{wk.name}</div>
                              {wk.completed ? (
                                <>
                                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                    <Metric
                                      label="Distance"
                                      plan={`${km(wk.distance.plannedMin)}${wk.distance.plannedMax !== wk.distance.plannedMin ? `–${km(wk.distance.plannedMax)}` : ''}`}
                                      actual={km(wk.distance.actual)}
                                      status={wk.distance.status}
                                    />
                                    <Metric
                                      label="Time"
                                      plan={mins(wk.duration.planned)}
                                      actual={mins(wk.duration.actual)}
                                      status={wk.duration.status}
                                    />
                                    <Metric
                                      label="Pace"
                                      plan={wk.pace.plannedMin != null
                                        ? `${formatPace(wk.pace.plannedMin)}${wk.pace.plannedMax && wk.pace.plannedMax !== wk.pace.plannedMin ? `–${formatPace(wk.pace.plannedMax)}` : ''}/km`
                                        : '—'}
                                      actual={wk.pace.actual != null ? `${formatPace(wk.pace.actual)}/km` : '—'}
                                      status={wk.pace.status}
                                    />
                                  </div>
                                  <SegmentsPanel athleteId={a.athleteId} date={wk.date} />
                                </>
                              ) : (
                                <div className="mt-1 text-xs text-slate-500 flex items-center gap-1">
                                  <Minus className="h-3 w-3" /> Not completed
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, plan, actual, status }: { label: string; plan: string; actual: string; status: MetricStatus | PaceStatus }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-500">{label}:</span>
      <span className="text-slate-300">{actual}</span>
      <span className="text-slate-600">/ {plan}</span>
      <span className={cn('font-medium', metricStyle[status])}>{metricLabel[status]}</span>
    </div>
  );
}

interface SegmentVerdict {
  index: number; type: string; label: string;
  plannedPaceMin: number | null; plannedPaceMax: number | null;
  actualPace: number | null; status: PaceStatus; graded: boolean;
}

// Per-segment planned-vs-actual verdicts (lazy — fetched when opened). Reliable only
// when the athlete ran the pushed structured workout on-watch (per-step laps).
function SegmentsPanel({ athleteId, date }: { athleteId: string; date: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [segments, setSegments] = useState<SegmentVerdict[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  const load = async () => {
    if (segments || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/academy/segments?athleteId=${athleteId}&date=${date}`);
      const data = await res.json();
      setSegments(data.segments || []);
      if (!data.aligned) setReason(data.reason || 'per-segment data unavailable');
    } catch {
      setReason('failed to load segments');
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => { const next = !open; setOpen(next); if (next) load(); };
  const graded = (segments || []).filter(s => s.graded);

  return (
    <div className="mt-2">
      <button onClick={toggle} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-white">
        <ListChecks className="h-3.5 w-3.5" /> {open ? 'Hide segments' : 'Per-segment breakdown'}
      </button>
      {open && (
        <div className="mt-2">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading segments…</div>
          ) : graded.length === 0 ? (
            <p className="text-[11px] text-slate-500 py-1">{reason || 'No graded segments.'}</p>
          ) : (
            <div className="space-y-1">
              {segments!.map((s, i) => (
                <div key={i} className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs',
                  s.graded ? 'bg-slate-900/50' : 'bg-slate-900/20')}>
                  <span className="text-slate-400 flex-1 min-w-0 truncate">{s.label}</span>
                  {s.graded ? (
                    <>
                      <span className="text-slate-500">
                        {s.plannedPaceMin != null
                          ? `${formatPace(s.plannedPaceMin)}${s.plannedPaceMax && s.plannedPaceMax !== s.plannedPaceMin ? `–${formatPace(s.plannedPaceMax)}` : ''}`
                          : '—'}
                      </span>
                      <span className="text-slate-300 tabular-nums">{s.actualPace != null ? formatPace(s.actualPace) : '—'}</span>
                      <span className={cn('font-semibold w-14 text-end', metricStyle[s.status])}>{metricLabel[s.status]}</span>
                    </>
                  ) : (
                    <span className="text-slate-600 w-14 text-end">—</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
