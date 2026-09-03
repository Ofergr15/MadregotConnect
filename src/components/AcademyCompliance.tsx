'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Minus, ListChecks, ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPace } from '@/lib/garmin/pace';
import { useApi, apiHeaders } from '@/lib/api';
import { Spinner, LoadingBlock, EmptyState } from '@/components/ui';

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

const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

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
  return `${start.toLocaleDateString('he-IL', opts)} – ${end.toLocaleDateString('he-IL', opts)}`;
}

function km(meters: number | null): string {
  if (meters == null) return '—';
  return `${(meters / 1000).toFixed(1)} ק"מ`;
}

function mins(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.round(sec / 60);
  return `${m} דק'`;
}

function initialsOf(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function scoreColor(rate: number): string {
  if (rate >= 0.8) return 'text-accent-600';
  if (rate >= 0.5) return 'text-band-3';
  return 'text-accent-red';
}

const metricStyle: Record<MetricStatus | PaceStatus, string> = {
  on_target: 'text-accent-600',
  under: 'text-band-3',
  over: 'text-band-3',
  slower: 'text-band-3',
  faster: 'text-band-2',
  unknown: 'text-ink-400',
};

const metricLabel: Record<MetricStatus | PaceStatus, string> = {
  on_target: 'בטווח',
  under: 'מתחת',
  over: 'מעל',
  slower: 'לאט יותר',
  faster: 'מהיר יותר',
  unknown: '—',
};

export function AcademyCompliance() {
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: adherence, isLoading } = useApi<{ athletes: AthleteAdherence[] }>(
    `/api/academy/adherence?weekStart=${weekStart}`,
  );

  const data = adherence?.athletes ?? [];

  const isCurrentWeek = weekStart === sundayOf(new Date());

  return (
    <div dir="rtl">
      {/* Week selector */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <button
          onClick={() => setWeekStart(w => shiftWeek(w, -1))}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors"
          aria-label="השבוע הקודם"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="text-center min-w-[180px]">
          <div className="text-sm font-semibold text-ink-700">{fmtWeekLabel(weekStart)}</div>
          <div className="text-xs text-ink-400">{isCurrentWeek ? 'השבוע' : ''}</div>
        </div>
        <button
          onClick={() => setWeekStart(w => shiftWeek(w, 1))}
          disabled={isCurrentWeek}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="השבוע הבא"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : data.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="אין ספורטאי אקדמיה לדווח עליהם"
          description="הוסיפו ספורטאים בטאב הרוסטר קודם."
        />
      ) : (
        <div className="space-y-3">
          {data.map(a => {
            const w = a.week;
            const open = expanded === a.athleteId;
            return (
              <div key={a.athleteId} className="bg-card/50 border border-page/50 rounded-card overflow-hidden">
                <button
                  onClick={() => setExpanded(open ? null : a.athleteId)}
                  className="w-full flex items-center gap-4 p-4 text-start hover:bg-page/70 transition-colors min-h-[44px]"
                >
                  <div className="bg-brand-600/20 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-brand-600 shrink-0">
                    {initialsOf(a.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink-700 truncate" dir="auto">{a.name}</div>
                    <div className="text-xs text-ink-400">
                      {w.completedCount}/{w.plannedCount} אימונים בוצעו
                    </div>
                  </div>
                  {/* Sessions-done bar */}
                  <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                    {w.workouts.map((wk, i) => (
                      <span
                        key={i}
                        title={`${wk.name} — ${wk.completed ? 'בוצע' : 'לא בוצע'}`}
                        className={cn(
                          'w-2.5 h-2.5 rounded-full',
                          wk.completed ? (wk.score >= 0.5 ? 'bg-accent-600' : 'bg-band-3') : 'bg-ink-300'
                        )}
                      />
                    ))}
                  </div>
                  <div className={cn('text-center shrink-0 w-14', scoreColor(w.completionRate))}>
                    <div className="text-lg font-bold">{Math.round(w.completionRate * 100)}%</div>
                    <div className="text-[10px] text-ink-400 -mt-0.5">בוצע</div>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-page/50 divide-y divide-page/30">
                    {w.workouts.length === 0 ? (
                      <div className="p-4 text-sm text-ink-400 text-center">אין אימונים מתוכננים השבוע.</div>
                    ) : (
                      w.workouts.map((wk, i) => {
                        const dayIdx = new Date(`${wk.date}T12:00:00Z`).getUTCDay();
                        return (
                          <div key={i} className="p-4 flex items-start gap-3">
                            <div className="shrink-0 w-10 text-center">
                              <div className="text-[10px] text-ink-400 font-medium">{DAY_LABELS[dayIdx]}</div>
                              {wk.completed
                                ? <CheckCircle2 className="h-5 w-5 text-accent-600 mx-auto mt-1" />
                                : <XCircle className="h-5 w-5 text-ink-400 mx-auto mt-1" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-ink-700 text-sm truncate" dir="auto">{wk.name}</div>
                              {wk.completed ? (
                                <>
                                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                    <Metric
                                      label="מרחק"
                                      plan={`${km(wk.distance.plannedMin)}${wk.distance.plannedMax !== wk.distance.plannedMin ? `–${km(wk.distance.plannedMax)}` : ''}`}
                                      actual={km(wk.distance.actual)}
                                      status={wk.distance.status}
                                    />
                                    <Metric
                                      label="זמן"
                                      plan={mins(wk.duration.planned)}
                                      actual={mins(wk.duration.actual)}
                                      status={wk.duration.status}
                                    />
                                    <Metric
                                      label="קצב"
                                      plan={wk.pace.plannedMin != null
                                        ? `${formatPace(wk.pace.plannedMin)}${wk.pace.plannedMax && wk.pace.plannedMax !== wk.pace.plannedMin ? `–${formatPace(wk.pace.plannedMax)}` : ''}/ק"מ`
                                        : '—'}
                                      actual={wk.pace.actual != null ? `${formatPace(wk.pace.actual)}/ק"מ` : '—'}
                                      status={wk.pace.status}
                                    />
                                  </div>
                                  <SegmentsPanel athleteId={a.athleteId} date={wk.date} />
                                </>
                              ) : (
                                <div className="mt-1 text-xs text-ink-400 flex items-center gap-1">
                                  <Minus className="h-3 w-3" /> לא בוצע
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
      <span className="text-ink-400">{label}:</span>
      <span className="text-ink-500">{actual}</span>
      <span className="text-ink-400">/ {plan}</span>
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
      const res = await fetch(`/api/academy/segments?athleteId=${athleteId}&date=${date}`, {
        headers: await apiHeaders(),
      });
      const data = await res.json();
      setSegments(data.segments || []);
      if (!data.aligned) setReason(data.reason || 'נתוני מקטעים לא זמינים');
    } catch {
      setReason('טעינת המקטעים נכשלה');
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => { const next = !open; setOpen(next); if (next) load(); };
  const graded = (segments || []).filter(s => s.graded);

  return (
    <div className="mt-2">
      <button onClick={toggle} className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-400 hover:text-ink-900 min-h-[44px]">
        <ListChecks className="h-3.5 w-3.5" /> {open ? 'הסתרת מקטעים' : 'פירוט לפי מקטע'}
      </button>
      {open && (
        <div className="mt-2">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-ink-400 py-2"><Spinner size={14} /> טוען מקטעים…</div>
          ) : graded.length === 0 ? (
            <p className="text-[11px] text-ink-400 py-1">{reason || 'אין מקטעים מדורגים.'}</p>
          ) : (
            <div className="space-y-1">
              {segments!.map((s, i) => (
                <div key={i} className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs',
                  s.graded ? 'bg-page/50' : 'bg-page/20')}>
                  <span className="text-ink-400 flex-1 min-w-0 truncate" dir="auto">{s.label}</span>
                  {s.graded ? (
                    <>
                      <span className="text-ink-400">
                        {s.plannedPaceMin != null
                          ? `${formatPace(s.plannedPaceMin)}${s.plannedPaceMax && s.plannedPaceMax !== s.plannedPaceMin ? `–${formatPace(s.plannedPaceMax)}` : ''}`
                          : '—'}
                      </span>
                      <span className="text-ink-500 tabular-nums">{s.actualPace != null ? formatPace(s.actualPace) : '—'}</span>
                      <span className={cn('font-semibold w-16 text-end', metricStyle[s.status])}>{metricLabel[s.status]}</span>
                    </>
                  ) : (
                    <span className="text-ink-400 w-16 text-end">—</span>
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
