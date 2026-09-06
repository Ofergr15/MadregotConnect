'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChartColumn, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Minus, ListChecks, ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPace } from '@/lib/garmin/pace';
import { useApi, apiHeaders } from '@/lib/api';
import { Spinner, LoadingBlock, EmptyState } from '@/components/ui';
import { ExecutionRing } from '@/components/activity/ExecutionRing';
import { DIRECTION_COLOR, type ExecutionSummary } from '@/lib/plan-execution/verdict';

// Mirror of the adherence API response (kept structural to avoid importing server types).
type MetricStatus = 'on_target' | 'under' | 'over' | 'unknown';
type PaceStatus = 'on_target' | 'faster' | 'slower' | 'unknown';

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
  /**
   * The accuracy verdict — the same one the athlete sees on the run itself, from
   * /api/academy/adherence?withExecution. `null` when it couldn't be graded, which
   * on this screen is usually a paced session whose laps nobody has fetched yet.
   */
  execution?: ExecutionSummary | null;
}

interface WeekAdherence {
  plannedCount: number;
  completedCount: number;
  completionRate: number;
  avgScore: number;
  /** Mean accuracy over the gradeable workouts only — see `gradedCount`. */
  avgAccuracy?: number | null;
  gradedCount?: number;
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

/** Below this the coach should be looking at the athlete, not the average. */
const BELOW_BAR = 0.6;

type ExecutionTranslator = ReturnType<typeof useTranslations<'execution'>>;

export function AcademyCompliance() {
  // Only the accuracy vocabulary comes from the message catalogue — the rest of
  // this coach-only screen is hardcoded Hebrew. Deliberate: "דיוק" and the
  // direction words must be the SAME words the athlete reads on their own run, or
  // the coach and the athlete end up describing one workout two ways.
  const t = useTranslations('execution');
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: adherence, isLoading } = useApi<{ athletes: AthleteAdherence[] }>(
    `/api/academy/adherence?weekStart=${weekStart}`,
  );

  const data = adherence?.athletes ?? [];

  const isCurrentWeek = weekStart === sundayOf(new Date());

  // Club roll-up.
  const gradedWorkouts = data.reduce((sum, a) => sum + (a.week.gradedCount ?? 0), 0);
  const completedWorkouts = data.reduce((sum, a) => sum + a.week.completedCount, 0);
  const plannedWorkouts = data.reduce((sum, a) => sum + a.week.plannedCount, 0);
  // Weighted by how many of each athlete's sessions could actually be graded, so
  // the number means what the caption beside it says: the average over those
  // sessions. Averaging the per-athlete averages instead would give an athlete
  // with one graded run the same weight as one with five, which is a different
  // statistic than "8 of 12 sessions came out at 72%".
  const clubAccuracy = gradedWorkouts
    ? data.reduce((sum, a) => sum + (a.week.avgAccuracy ?? 0) * (a.week.gradedCount ?? 0), 0) / gradedWorkouts
    : null;
  const clubCompletion = plannedWorkouts ? completedWorkouts / plannedWorkouts : 0;
  // Athletes, not sessions — this line exists to point at a person to talk to.
  const belowBar = data.filter(a => a.week.avgAccuracy != null && a.week.avgAccuracy < BELOW_BAR).length;

  return (
    <div dir="rtl">
      {/* Week selector */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <button
          onClick={() => setWeekStart(w => shiftWeek(w, -1))}
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
          onClick={() => setWeekStart(w => shiftWeek(w, 1))}
          disabled={isCurrentWeek}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-30 disabled:cursor-not-allowed"
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
                  {/* One dot per planned workout — the week at a glance, and shown
                      on a phone now: this is the screen a coach opens between
                      intervals, and `hidden sm:` meant they never saw it there.
                      Three states, not two, because "done but never measured" and
                      "not done" are opposite facts about an athlete: hollow = the
                      session didn't happen, grey = it did but has no accuracy yet,
                      colour = graded, in the same DIRECTION colours as the rings. */}
                  <div className="flex items-center gap-1 shrink-0">
                    {w.workouts.map((wk, i) => {
                      const acc = wk.execution?.score ?? null;
                      return (
                        <span
                          key={i}
                          title={`${wk.name} — ${dotTitle(wk, t)}`}
                          className={cn(
                            'w-2.5 h-2.5 rounded-full',
                            !wk.completed && 'border-[1.5px] border-ink-300',
                            wk.completed && acc == null && 'bg-ink-300',
                          )}
                          style={acc != null && wk.execution
                            ? { backgroundColor: DIRECTION_COLOR[wk.execution.direction] }
                            : undefined}
                        />
                      );
                    })}
                  </div>
                  {/* Accuracy leads. The question this tab exists for is not "did
                      they turn up" but "did they run what was asked", and turning
                      up is already stated in words on the line above. Coloured by
                      threshold rather than by DIRECTION: a week holds several
                      directions at once and there is no honest single one. */}
                  <div className="text-center shrink-0 w-14">
                    {w.avgAccuracy != null ? (
                      <div className={cn('text-lg font-bold tabular-nums', scoreColor(w.avgAccuracy))}>
                        {Math.round(w.avgAccuracy * 100)}%
                      </div>
                    ) : (
                      <div
                        className="text-lg font-bold text-ink-400"
                        title="אין עוד ציון דיוק לשבוע הזה — נמדד מהחזרות, ואלה נקראות כשנפתח אימון."
                      >
                        —
                      </div>
                    )}
                    {/* When only some of the week could be graded, say so right
                        under the number: 81% over 3 of her 5 sessions is not a
                        verdict on her week, and unqualified it reads like one. */}
                    <div
                      className="text-[10px] text-ink-400 -mt-0.5"
                      title={w.gradedCount != null && w.gradedCount < w.completedCount
                        ? `נמדד על ${w.gradedCount} מתוך ${w.completedCount} האימונים שבוצעו`
                        : undefined}
                    >
                      {t('accuracyShort')}
                      {w.gradedCount != null && w.completedCount > 0 && w.gradedCount < w.completedCount && (
                        <span className="text-ink-300"> <Num>{w.gradedCount}/{w.completedCount}</Num></span>
                      )}
                    </div>
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
                              {/* The ring rides with the title, not in a column of
                                  its own at the end of the row. As a column it took
                                  64px off a 326px row and the pace metric wrapped
                                  mid-token — "3:20–" on one line, "3:30/ק״מ" and its
                                  verdict word on the next. Here the metrics get the
                                  full width, and the score sits beside the workout's
                                  name exactly as it does on the athlete's own card.
                                  Rendered only where the session happened: a "—" ring
                                  on a missed workout reads as a measurement that
                                  failed rather than a session that never started. */}
                              <div className="flex items-start gap-2.5">
                                {wk.completed && wk.execution && (
                                  <div className="shrink-0 mt-0.5">
                                    <ExecutionRing
                                      score={wk.execution.score}
                                      direction={wk.execution.direction}
                                      size={36}
                                      ariaLabel={wk.execution.score != null
                                        ? t('ringLabel', { score: wk.execution.score })
                                        : t('ringLabelUngraded')}
                                    />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-ink-700 text-sm truncate" dir="auto">{wk.name}</div>
                                  {/* The verdict word under the name rather than under
                                      the ring: under the ring it needs a 56px column
                                      and wraps to two or three lines, and it left a
                                      hole beside a short workout name. `dirShort_`,
                                      not `dir_` — the athlete's own copy is second
                                      person ("רצתם מהר מהמתוכנן"), and a coach reading
                                      it about someone else was being addressed as if
                                      they had run it. */}
                                  {wk.completed && wk.execution && (
                                    <div className="text-[10px] text-ink-400 leading-tight truncate">
                                      {t(`dirShort_${wk.execution.direction}` as 'dirShort_unknown')}
                                    </div>
                                  )}
                                  {/* Say the score is missing rather than leaving the
                                      line blank. A ringless row beside metric rows
                                      that DO show numbers reads as "nothing to say
                                      about this one"; until the laps get read that is
                                      the common case, and the coach should know which
                                      two of the five weren't measured. */}
                                  {wk.completed && !wk.execution && (
                                    <div
                                      className="text-[10px] text-ink-300 leading-tight truncate"
                                      title={t('ungradedBody')}
                                    >
                                      אין ציון {t('accuracyShort')}
                                    </div>
                                  )}
                                </div>
                              </div>
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

          {/* The club line, last: a coach reads the roster first and wants the one
              sentence that says whether to worry. Both numbers, because they
              answer different questions and one without the other misleads —
              everybody turning up and running the wrong paces is 100% / 61%. */}
          <div className="bg-card/50 border border-page/50 rounded-card p-4 mt-1">
            <div className="flex items-center gap-2 mb-3">
              <ChartColumn className="h-4 w-4 text-brand-600" />
              <span className="text-sm font-semibold text-ink-700">ממוצע האקדמיה השבוע</span>
            </div>
            {/* Label above the number, and a divider between: the two figures are
                often within a few points of each other and both land in the same
                colour band, so side-by-side with the labels underneath they were
                two orange 70-somethings a coach had to squint at to tell apart. */}
            <div className="flex items-stretch">
              <Stat
                label={t('accuracyShort')}
                value={clubAccuracy != null ? `${Math.round(clubAccuracy * 100)}%` : '—'}
                color={clubAccuracy != null ? scoreColor(clubAccuracy) : 'text-ink-400'}
                // Measured-out-of, always. An average over 8 of 12 sessions is not
                // the academy's accuracy, and the number alone can't say so.
                note={<>נמדד על <Num>{gradedWorkouts}</Num> מתוך <Num>{completedWorkouts}</Num> אימונים</>}
              />
              <div className="w-px bg-page/70 mx-4" />
              <Stat
                label="בוצע"
                value={`${Math.round(clubCompletion * 100)}%`}
                color={scoreColor(clubCompletion)}
                note={<><Num>{completedWorkouts}</Num> מתוך <Num>{plannedWorkouts}</Num> אימונים</>}
              />
            </div>
            {belowBar > 0 && (
              <p className="mt-3 pt-3 border-t border-page/50 text-xs text-accent-red font-medium">
                {belowBar === 1 ? 'מתאמן אחד מתחת' : <>{<Num>{belowBar}</Num>} מתאמנים מתחת</>}
                {' '}ל־<Num>{Math.round(BELOW_BAR * 100)}%</Num> דיוק&#x200F;.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * An LTR-isolated number inside Hebrew prose.
 *
 * `8 מתוך 12` without it is a bidi coin toss — the two digits sit either side of a
 * Hebrew word and the browser is free to reorder them, which turns "8 of 12" into
 * "12 of 8" without anything looking broken.
 */
function Num({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr" className="tabular-nums">{children}</bdi>;
}

/** One club figure: what it is, the number, and what it was measured over. */
function Stat({ label, value, color, note }: {
  label: string;
  value: string;
  color: string;
  note: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-[11px] font-semibold text-ink-500">{label}</div>
      <div className={cn('text-2xl font-black tabular-nums leading-tight mt-0.5', color)}>{value}</div>
      <div className="text-[10px] text-ink-400 mt-0.5 leading-snug">{note}</div>
    </div>
  );
}

/**
 * What a week dot means, in words, for its tooltip.
 *
 * Kept out of the row so the three states are stated once: the dot's colour and
 * its title are the same fact, and a colour that says "graded" over a title that
 * says "done" is how a coach ends up trusting the wrong one.
 */
function dotTitle(wk: WorkoutAdherence, t: ExecutionTranslator): string {
  if (!wk.completed) return 'לא בוצע';
  const score = wk.execution?.score;
  if (score == null || !wk.execution) return 'בוצע · אין ציון דיוק';
  return `${score}% ${t('accuracyShort')} · ${t(`dir_${wk.execution.direction}` as 'dir_unknown')}`;
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
