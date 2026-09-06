'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Minus, ListChecks, ClipboardCheck, Info } from 'lucide-react';
import { cn, planWeekStartOf, shiftWeekStart } from '@/lib/utils';
import { formatPace } from '@/lib/garmin/pace';
import { useApi, apiHeaders } from '@/lib/api';
import { Spinner, LoadingBlock, EmptyState } from '@/components/ui';

// Mirror of the adherence API response (kept structural to avoid importing server types).
type MetricStatus = 'on_target' | 'under' | 'over' | 'unknown';
type PaceStatus = 'on_target' | 'faster' | 'slower' | 'unknown';

// What the report was graded with (lib/academy/adherence.ts): distance/duration are
// fractions, pace is ± seconds per km. Read from the response rather than restated
// here, so the legend can't disagree with the grading after a coach edits them.
interface AdherenceTolerances {
  distance: number;
  duration: number;
  paceSec: number;
}

interface WorkoutAdherence {
  date: string;
  name: string;
  completed: boolean;
  distance: { status: MetricStatus; plannedMin: number; plannedMax: number; actual: number | null };
  // `estimated` — the plan set no time, so `planned` is the engine's own guess and
  // isn't graded. `comparedMin/Max` — the band `pace.status` was judged against,
  // null for a structured session where a whole-run average can't judge it. Both
  // from lib/academy/adherence.ts.
  duration: { status: MetricStatus; planned: number; actual: number | null; estimated: boolean };
  pace: {
    status: PaceStatus;
    plannedMin: number | null;
    plannedMax: number | null;
    comparedMin: number | null;
    comparedMax: number | null;
    actual: number | null;
  };
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

/**
 * What the badges mean — the coach's key to this table.
 *
 * Worth spelling out because two of the verdicts read as bad news and aren't, and
 * one combination is the most useful thing on the page: distance `under` with pace
 * `on_target` is "ran only part of it, but ran that part right", which is a
 * different coaching conversation from "ran part of it, and not at the pace". The
 * numbers come from the response, not from restating DEFAULT_TOLERANCES here.
 */
function ComplianceLegend({ tolerances }: { tolerances: AdherenceTolerances }) {
  const [open, setOpen] = useState(false);
  const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

  const rows: Array<{ status: MetricStatus | PaceStatus; label?: string; text: string }> = [
    {
      status: 'on_target',
      text: `הביצוע בתוך הסטייה המותרת: ±${pct(tolerances.distance)} במרחק, ±${pct(tolerances.duration)} בזמן, ±${tolerances.paceSec} שנ׳/ק״מ בקצב.`,
    },
    {
      status: 'faster',
      text: `הקצב הממוצע היה מהיר מהיעד ביותר מ-${tolerances.paceSec} שנ׳/ק״מ. לא בהכרח טוב — באימון קל זה אומר שהוא לא היה קל.`,
    },
    {
      status: 'slower',
      text: `הקצב הממוצע היה איטי מהיעד ביותר מ-${tolerances.paceSec} שנ׳/ק״מ.`,
    },
    { status: 'under', text: 'פחות מהמתוכנן — מרחק או זמן מתחת לטווח.' },
    { status: 'over', text: 'יותר מהמתוכנן — מרחק או זמן מעל הטווח.' },
    {
      status: 'unknown',
      text: 'לא נמדד: או שהתוכנית לא קבעה זמן, או שזה אימון מובנה שממוצע כל הריצה לא יכול לשפוט — שם הקצב נמדד ב״פירוט לפי מקטע״.',
    },
  ];

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 mx-auto text-xs font-semibold text-ink-400 hover:text-ink-900 min-h-[44px] transition-colors"
      >
        <Info className="h-3.5 w-3.5" /> {open ? 'הסתרת המקרא' : 'מקרא — מה המדדים אומרים'}
      </button>
      {open && (
        <div className="mt-1 bg-card/50 border border-page/50 rounded-card p-4 space-y-3 text-xs">
          <div className="space-y-1.5">
            {rows.map(row => (
              <div key={row.status + row.text} className="flex gap-2">
                <span className={cn('font-semibold shrink-0 w-20', metricStyle[row.status])}>
                  {metricLabel[row.status]}
                </span>
                <span className="text-ink-500 flex-1">{row.text}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-page/50 pt-3 space-y-1.5">
            <div className="font-semibold text-ink-700">שילובים שכדאי להכיר</div>
            <div className="text-ink-500">
              <span className="text-band-3 font-semibold">מרחק מתחת</span> +{' '}
              <span className="text-accent-600 font-semibold">קצב בטווח</span> — בוצע רק חלק
              מהאימון, אבל מה שבוצע היה בקצב שנקבע.
            </div>
            <div className="text-ink-500">
              <span className="text-band-3 font-semibold">מרחק מתחת</span> +{' '}
              <span className="text-band-3 font-semibold">קצב לא בטווח</span> — בוצע רק חלק
              מהאימון, וגם לא בקצב שנקבע.
            </div>
          </div>

          <div className="border-t border-page/50 pt-3 space-y-1.5 text-ink-500">
            <div className="font-semibold text-ink-700">פירוט לפי מקטע</div>
            <div>
              אם האימון בוצע כאימון מובנה מהשעון — כל מקטע מדורג בנפרד מול היעד שלו.
            </div>
            <div>
              אם לא — הבדיקה מחפשת את החזרות המתוכננות בין המקטעים שהשעון רשם, בלי תלות בסדר
              (למשל: האם יש 6 מקטעים של 400 מ׳ בתוך טווח הקצב), ומציגה{' '}
              <span className="font-semibold">כמה מתוך כמה</span> נמצאו.
            </div>
            <div>
              כשהשעון רשם רק ק״מ שלמים אי אפשר לראות בהם חזרות של 400 מ׳ — במקרה כזה כתוב שאי
              אפשר לבדוק, ולא שהאימון לא בוצע.
            </div>
          </div>

          <div className="border-t border-page/50 pt-3 space-y-1.5 text-ink-500">
            <div className="font-semibold text-ink-700">האחוז והנקודות</div>
            <div>האחוז ליד השם: אימונים שבוצעו מתוך המתוכננים לשבוע.</div>
            <div>
              נקודה <span className="text-accent-600 font-semibold">ירוקה</span> = לפחות חצי
              מהמדדים באימון היו בטווח, <span className="text-band-3 font-semibold">כתומה</span> =
              פחות מחצי, <span className="text-ink-400 font-semibold">אפורה</span> = לא בוצע.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AcademyCompliance() {
  const [weekStart, setWeekStart] = useState(() => planWeekStartOf());
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: adherence, isLoading } = useApi<{
    athletes: AthleteAdherence[];
    tolerances?: AdherenceTolerances;
  }>(`/api/academy/adherence?weekStart=${weekStart}`);

  const data = adherence?.athletes ?? [];

  const isCurrentWeek = weekStart === planWeekStartOf();

  return (
    <div dir="rtl">
      {/* Week selector */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <button
          onClick={() => setWeekStart(w => shiftWeekStart(w, -1))}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          aria-label="השבוע הקודם"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="text-center min-w-[180px]">
          <div className="text-sm font-semibold text-ink-700">{fmtWeekLabel(weekStart)}</div>
          <div className="text-xs text-ink-400">{isCurrentWeek ? 'השבוע' : ''}</div>
        </div>
        <button
          onClick={() => setWeekStart(w => shiftWeekStart(w, 1))}
          disabled={isCurrentWeek}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="השבוע הבא"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>

      {/* Only once the report is in: the tolerances it was graded with come with it. */}
      {adherence?.tolerances && data.length > 0 && (
        <ComplianceLegend tolerances={adherence.tolerances} />
      )}

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
                                    {/* An estimated planned time isn't graded (see
                                        adherence.ts durationEstimated), so don't
                                        present the estimate as a target. */}
                                    <Metric
                                      label="זמן"
                                      plan={wk.duration.estimated ? 'לא נקבע' : mins(wk.duration.planned)}
                                      actual={mins(wk.duration.actual)}
                                      status={wk.duration.status}
                                    />
                                    {/* Show the prescribed work band, but say so
                                        when a single whole-run average can't judge
                                        it — a structured session is graded in the
                                        per-segment panel below, not here. */}
                                    <Metric
                                      label="קצב"
                                      plan={paceBandLabel(wk.pace.plannedMin, wk.pace.plannedMax)}
                                      actual={wk.pace.actual != null ? `${formatPace(wk.pace.actual)}/ק"מ` : '—'}
                                      status={wk.pace.status}
                                      hint={
                                        wk.pace.comparedMin == null && wk.pace.plannedMin != null
                                          ? 'אימון מובנה — ממוצע הקצב של כל הריצה לא מודד את קצב העבודה. הפירוט לפי מקטע למטה.'
                                          : undefined
                                      }
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

function paceBandLabel(min: number | null, max: number | null): string {
  if (min == null) return '—';
  const suffix = max != null && max !== min ? `–${formatPace(max)}` : '';
  return `${formatPace(min)}${suffix}/ק"מ`;
}

function Metric({ label, plan, actual, status, hint }: { label: string; plan: string; actual: string; status: MetricStatus | PaceStatus; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5" title={hint}>
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

// The order-free "did they do the work" verdict from lib/academy/segments.ts —
// what's left when the run wasn't the pushed structured workout.
interface EffortRequirement {
  label: string; distanceM: number; paceMin: number; paceMax: number;
  needed: number; found: number; foundPaces: number[]; verifiable: boolean;
}
interface EffortReport {
  verdict: 'confirmed' | 'partial' | 'missed' | 'unverifiable';
  requirements: EffortRequirement[];
  neededTotal: number; foundTotal: number;
  lapCount: number; medianLapM: number | null;
  reason?: 'no_paced_plan' | 'no_laps' | 'laps_too_coarse';
}

const effortHeadline: Record<Exclude<EffortReport['verdict'], 'unverifiable'>, { text: string; style: string }> = {
  confirmed: { text: 'העבודה בוצעה — כל החזרות נמצאו בקצב היעד', style: 'text-accent-600' },
  partial: { text: 'בוצע חלקית', style: 'text-band-3' },
  missed: { text: 'לא נמצאה אף חזרה בקצב היעד', style: 'text-accent-red' },
};

// Why the laps can't answer. Kept apart from "didn't do it" on purpose: an athlete
// who never presses the lap button gets automatic 1 km laps, and no 400 m rep is
// visible in those at any pace.
function effortReasonText(report: EffortReport): string {
  switch (report.reason) {
    case 'no_paced_plan':
      return 'לאימון הזה אין יעד קצב שאפשר לבדוק מול המקטעים.';
    case 'no_laps':
      return 'השעון רשם את הריצה כמקטע אחד, אין מה להשוות.';
    case 'laps_too_coarse':
      return `המקטעים שנרשמו (${report.medianLapM ?? '—'} מ׳ בערך) ארוכים מהחזרות המתוכננות, ולכן אי אפשר לזהות אותן — זה לא אומר שהאימון לא בוצע.`;
    default:
      return 'אין נתוני מקטעים לריצה הזו.';
  }
}

// Per-segment planned-vs-actual verdicts (lazy — fetched when opened). The
// positional grading needs per-step laps, i.e. the pushed structured workout run
// on-watch; for every other run the effort report below is the answer.
function SegmentsPanel({ athleteId, date }: { athleteId: string; date: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [segments, setSegments] = useState<SegmentVerdict[] | null>(null);
  const [efforts, setEfforts] = useState<EffortReport | null>(null);
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
      setEfforts(data.efforts || null);
      if (!data.aligned) setReason(data.reason || 'נתוני מקטעים לא זמינים');
    } catch {
      setReason('טעינת המקטעים נכשלה');
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => { const next = !open; setOpen(next); if (next) load(); };
  const graded = (segments || []).filter(s => s.graded);
  const effortRows = (efforts?.requirements || []).filter(r => r.verifiable);

  return (
    <div className="mt-2">
      <button onClick={toggle} className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-400 hover:text-ink-900 min-h-[44px]">
        <ListChecks className="h-3.5 w-3.5" /> {open ? 'הסתרת מקטעים' : 'פירוט לפי מקטע'}
      </button>
      {open && (
        <div className="mt-2">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-ink-400 py-2"><Spinner size={14} /> טוען מקטעים…</div>
          ) : graded.length === 0 && efforts && efforts.verdict !== 'unverifiable' ? (
            /* The run wasn't the structured workout, so grade it as a set of
               efforts instead of step by step. */
            <div className="space-y-1.5 text-xs">
              <div className={cn('font-semibold', effortHeadline[efforts.verdict].style)}>
                {efforts.verdict === 'partial'
                  ? `בוצע חלקית — ${efforts.foundTotal} מתוך ${efforts.neededTotal} חזרות בקצב היעד`
                  : effortHeadline[efforts.verdict].text}
              </div>
              {effortRows.map((r, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-page/50 px-2.5 py-1.5">
                  <span className="text-ink-400 flex-1 min-w-0 truncate" dir="auto">
                    {r.needed}×{Math.round(r.distanceM)} מ׳ ב-{paceBandLabel(r.paceMin, r.paceMax)}
                  </span>
                  <span className="text-ink-500 tabular-nums" dir="ltr">
                    {r.foundPaces.map(p => formatPace(p)).join(' · ') || '—'}
                  </span>
                  <span className={cn('font-semibold w-14 text-end',
                    r.found >= r.needed ? 'text-accent-600' : r.found > 0 ? 'text-band-3' : 'text-accent-red')}>
                    {r.found}/{r.needed}
                  </span>
                </div>
              ))}
              {efforts.requirements.some(r => !r.verifiable) && (
                <p className="text-[11px] text-ink-400">
                  חלק מהחזרות לא נראות במקטעים שנרשמו ולכן לא נבדקו.
                </p>
              )}
              <p className="text-[11px] text-ink-400">
                הריצה לא בוצעה כאימון מובנה מהשעון — הבדיקה מחפשת את החזרות בין המקטעים שנרשמו, בלי תלות בסדר.
              </p>
            </div>
          ) : graded.length === 0 ? (
            <p className="text-[11px] text-ink-400 py-1">
              {efforts ? effortReasonText(efforts) : reason || 'אין מקטעים מדורגים.'}
            </p>
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
