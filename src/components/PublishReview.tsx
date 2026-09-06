'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Edit3, FileText, Info, Loader2, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GroupedWeeklyPlans, ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { mergeGroupsToUnified } from '@/lib/ai/splitGroups';
import { textDir } from '@/lib/bidi';
import { cn } from '@/lib/utils';
import { stepPaceTokens } from '@/lib/garmin/pace';
import { boardStates, sessionBoardsPublished } from '@/lib/plans/publish-boards';
import { sessionKind } from '@/lib/plans/session-label';
import { classifyWorkout, sessionHeadline } from '@/lib/plans/session-summary';
import { isRestStep, stepMetric, stepQualifier, type StepUnits } from '@/lib/plans/step-display';
import {
  isEstimate,
  planEstimateOptions,
  workoutDistanceEstimate,
  type EstimateOptions,
} from '@/lib/plans/step-estimate';
import { auditWeek, countWarnings, type AuditFinding } from '@/lib/plans/workout-audit';
import { planDayKey, WORKOUT_TYPE_COLORS, WORKOUT_TYPE_TEXT_COLORS } from '@/lib/plans/workout-parsing';
import { tableRows, workoutSections } from '@/lib/plans/workout-shape';
import { workoutDurationRangeSec } from '@/lib/workout-duration';
import { Button, SegmentedControl } from '@/components/ui';

/**
 * The screen the coach stands on between parsing a PDF and sending the week to
 * sixty phones.
 *
 * What it replaced answered one question — "what does group ❷'s Tuesday image
 * look like?" — and to answer it the coach had to page through a flat list of
 * nine "workout parts" three times over, each labelled with its internal
 * `workoutKey` and an English `partKind` on an otherwise Hebrew screen. Nothing
 * on it said how far Tuesday was, whether the three groups actually differed, or
 * how many of the twenty-seven boards already existed. The coach's own words for
 * it were that the data arrives very unclearly.
 *
 * So it is organised the way the program is: the WEEK down the rail, the SESSION
 * in the middle, and the three groups side by side inside it — because the groups
 * are three columns of one plan, not three plans, and the old top-level ❶❷❸ tabs
 * were what made a plan feel like three. The rendered picture is one tab of four
 * rather than the whole screen, since an image of a board is the last thing worth
 * checking and the first thing that used to be shown.
 *
 * Every number here comes from the shared pure modules (`step-estimate`,
 * `workout-shape`, `session-summary`, `workout-audit`, `publish-boards`), so what
 * the coach approves is what the athlete's Plan tab will say.
 */

export interface PublishReviewProps {
  grouped: GroupedWeeklyPlans;
  /** Sunday ISO of the week being published — the rail's dates. */
  weekStartDate: string;
  /** Which session is open, as an index into a group's `workouts`. */
  index: number;
  onIndex: (index: number) => void;
  /** Which group's rendered artifacts the image / text tabs show. */
  group: 1 | 2 | 3;
  onGroup: (group: 1 | 2 | 3) => void;
  /** Live-rendered PNG of the open session for `group`, as a data URL. */
  preview: string | null;
  previewText: string;
  loading: boolean;
  publishing: boolean;
  onEditSteps: () => void;
  programPdfUrl: string | null;
  onOpenPdf: () => void;
  instruction: string;
  onInstruction: (value: string) => void;
  refineScope: 'current' | 'all';
  onRefineScope: (scope: 'current' | 'all') => void;
  onRefine: () => void;
}

type View = 'steps' | 'image' | 'text' | 'source';

const GROUPS = [1, 2, 3] as const;

/** ❶ ❷ ❸ — the club's own notation for its groups, on every screen it has. */
const GROUP_MARKS = ['❶', '❷', '❸'];

/** Group ❶ is ink, ❷ the league blue, ❸ the league orange. */
const GROUP_TEXT = ['text-ink-900', 'text-band-2-ink', 'text-band-3-ink'];
const GROUP_CELL = ['bg-ink-900/[0.045]', 'bg-band-2/10', 'bg-band-3/10'];

const STEP_TYPE_KEYS: Record<string, string> = {
  warmup: 'stepWarmup', cooldown: 'stepCooldown', interval: 'stepInterval',
  active: 'stepActive', rest: 'stepRest', recovery: 'stepRecovery',
};

/** The key the audit files a session's findings under — `auditWeek`'s own. */
function auditKey(workout: ParsedWorkout, index: number): string {
  return workout.workoutKey || `day-${workout.dayOfWeek}-part-${workout.partIndex ?? index + 1}`;
}

/** d/M — a day's date beside its name, short enough for a 288px rail. */
function formatDayDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${Number(day)}/${Number(month)}`;
}

function roundKm(meters: number): number {
  return Math.round(meters / 100) / 10;
}

export function PublishReview(props: PublishReviewProps) {
  const { grouped, weekStartDate, index, onIndex, group, onGroup } = props;
  const t = useTranslations('publishReview');
  const tp = useTranslations('planner');
  const tc = useTranslations('common');
  const ta = useTranslations('activities');
  const [view, setView] = useState<View>('steps');

  const dayNames = tc.raw('dayNames') as string[];
  const units: StepUnits = { km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes') };

  // The unified view — group ❶'s steps carrying ❷/❸ wherever they differ — is
  // rebuilt here rather than read off the page's `parsedPlan`, which two of its
  // own code paths overwrite with a bare `group1`, losing ❷/❸ at exactly the
  // moment the coach has just refined or published something.
  const unified = useMemo(() => mergeGroupsToUnified(grouped).workouts, [grouped]);
  const estimateOptions = useMemo(() => planEstimateOptions(unified), [unified]);
  const audit = useMemo(() => auditWeek(unified, estimateOptions), [unified, estimateOptions]);
  const boards = useMemo(() => boardStates(grouped), [grouped]);

  const workout = unified[index];
  const findings = workout ? audit.byKey[auditKey(workout, index)] || [] : [];

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      dateKey: planDayKey(weekStartDate, dayOfWeek),
      sessions: unified
        .map((w, i) => ({ workout: w, index: i }))
        .filter((s) => s.workout.dayOfWeek === dayOfWeek),
    })),
    [unified, weekStartDate],
  );

  const publishedBoards = boards.filter((b) => b.published).length;
  const trainingDays = days.filter((day) => day.sessions.length > 0).length;

  /** "9.2–11.4", and whether anybody actually wrote it down. */
  const distanceOf = (w: ParsedWorkout) => {
    const estimate = workoutDistanceEstimate(w, { assumeOpenBlocks: true, ...estimateOptions });
    const min = roundKm(estimate.range.min);
    const max = roundKm(estimate.range.max);
    return {
      text: max === 0 ? '' : min === max ? `${max}` : `${min}–${max}`,
      approx: isEstimate(estimate.from),
    };
  };

  const durationOf = (w: ParsedWorkout) => {
    const { min, max } = workoutDurationRangeSec(w, estimateOptions);
    const minutes = (sec: number) => Math.round(sec / 60);
    if (max === 0) return '';
    return minutes(min) === minutes(max) ? `${minutes(max)}` : `${minutes(min)}–${minutes(max)}`;
  };

  const kindLabel = (w: ParsedWorkout) => {
    const kind = sessionKind(w);
    if (kind === 'morning') return tp('sessionMorning');
    if (kind === 'evening') return tp('sessionEvening');
    if (kind === 'part') return tp('partLabel', { index: w.partIndex ?? 1, count: w.partCount ?? 1 });
    return '';
  };

  const typeLabel = (w: ParsedWorkout) => ta(`runType_${classifyWorkout(w)}` as 'runType_easy');

  return (
    <div>
      {/* ═══ hero: the four numbers the decision to publish rests on ═══ */}
      <div className="flex flex-wrap items-start gap-y-3 pb-3 [&>*+*]:border-s [&>*+*]:border-page [&>*+*]:ps-4">
        <Stat
          label={t('statSessions')}
          value={
            <>
              <bdi dir="ltr">{unified.length}</bdi>{' '}
              <small className="text-2xs font-light text-ink-400">
                {t('daysOf', { days: trainingDays })}
              </small>
            </>
          }
        />
        <Stat label={t('statBoards')} value={<bdi dir="ltr">{publishedBoards}/{boards.length}</bdi>} />
        <Stat label={t('statDiffering')} value={<bdi dir="ltr">{audit.differingPaceSteps}</bdi>} />
        <Stat
          label={t('statReview')}
          value={
            audit.sessionsWithWarnings
              ? <span className="text-accent-red-ink"><bdi dir="ltr">{audit.sessionsWithWarnings}</bdi></span>
              : <span className="text-accent-900">{t('allClear')}</span>
          }
        />
      </div>

      {/* The boards themselves — three ticks per session, in session order, so a
          gap in a triplet is one group that failed and not a vague "partial". */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-page py-2.5">
        <span className="text-2xs text-ink-400">{t('boardsLabel', { count: boards.length })}</span>
        <div className="flex gap-2">
          {unified.map((w, i) => (
            <button
              key={auditKey(w, i)}
              type="button"
              onClick={() => onIndex(i)}
              title={`${dayNames[w.dayOfWeek]} · ${sessionBoardsPublished(grouped, i)}/3`}
              className={cn(
                'flex gap-0.5 rounded-tile p-0.5',
                i === index ? 'bg-brand-600/15' : 'hover:bg-brand-600/[0.07]',
              )}
            >
              {GROUPS.map((g) => {
                const board = boards.find((b) => b.index === i && b.group === g);
                return (
                  <span
                    key={g}
                    className={cn(
                      'h-3.5 w-[7px] rounded-[2px]',
                      board?.published ? 'bg-accent-500'
                        : props.publishing ? 'animate-pulse bg-brand-600'
                        : 'bg-ink-300',
                    )}
                  />
                );
              })}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 pt-3 md:grid-cols-[288px_1fr]">
        {/* ═══ rail: the week, by day ═══ */}
        <aside className="md:max-h-[70vh] md:overflow-y-auto md:pe-1">
          <p className="px-1 pb-2 text-4xs font-bold uppercase tracking-[0.12em] text-ink-400">
            {t('railHead')}
          </p>
          {days.map((day) => (
            <div
              key={day.dayOfWeek}
              className={cn(
                'mb-2 overflow-hidden rounded-2xl',
                day.sessions.length ? 'bg-card' : 'bg-card/45',
              )}
            >
              <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
                <span className={cn('text-xs font-bold', day.sessions.length ? 'text-ink-900' : 'text-ink-400')}>
                  {dayNames[day.dayOfWeek]}
                </span>
                <span className="text-3xs text-ink-400">
                  {day.sessions.length
                    ? <bdi dir="ltr">{formatDayDate(day.dateKey)}</bdi>
                    : t('restDay')}
                </span>
              </div>
              {day.sessions.map(({ workout: w, index: i }) => {
                const type = classifyWorkout(w);
                const warnings = countWarnings(audit.byKey[auditKey(w, i)] || []);
                const km = distanceOf(w);
                const minutes = durationOf(w);
                const done = sessionBoardsPublished(grouped, i);
                const kind = kindLabel(w);
                return (
                  <button
                    key={auditKey(w, i)}
                    type="button"
                    onClick={() => onIndex(i)}
                    className={cn(
                      'flex w-full items-center gap-2 border-t border-page px-3 py-2 text-start',
                      i === index ? 'bg-brand-600/[0.07]' : 'hover:bg-brand-600/[0.04]',
                    )}
                  >
                    <span
                      className={cn('h-8 shrink-0 rounded-full', i === index ? 'w-1' : 'w-[3px]')}
                      style={{ background: WORKOUT_TYPE_COLORS[type] }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-4xs font-bold">
                        <span style={{ color: WORKOUT_TYPE_TEXT_COLORS[type] }}>{typeLabel(w)}</span>
                        {kind && <span className="text-ink-400">{kind}</span>}
                        {w.optional && <span className="text-ink-400">{tp('sessionOptional')}</span>}
                      </span>
                      <span className="block truncate text-13 text-ink-900">
                        <bdi dir="ltr">{sessionHeadline(w.steps, units) || w.name}</bdi>
                      </span>
                      <span className="block text-3xs text-ink-400">
                        {km.text && <bdi dir="ltr">{km.approx ? '~' : ''}{km.text} {units.km}</bdi>}
                        {km.text && minutes ? ' · ' : ''}
                        {minutes && <bdi dir="ltr">{minutes} {units.min}</bdi>}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      {warnings > 0 ? (
                        <span className="rounded-pill bg-accent-red/[0.14] px-1.5 py-0.5 text-4xs font-bold text-accent-red-ink">
                          <bdi dir="ltr">{warnings} ⚠</bdi>
                        </span>
                      ) : (
                        <Check className="h-3.5 w-3.5 text-accent-600" />
                      )}
                      {/* The tick above answers "any findings?", this answers
                          "is it out?" — so the count carries its own colour;
                          a green tick over a grey 0/3 was being read as sent. */}
                      <span
                        className={cn(
                          'mt-1 block text-4xs',
                          done === 3 ? 'text-accent-600' : 'text-ink-400',
                        )}
                      >
                        <bdi dir="ltr">{done}/3</bdi>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* ═══ main: the open session ═══ */}
        <main className="min-w-0">
          {!workout ? (
            <p className="py-10 text-center text-sm text-ink-400">{t('noSession')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-ink-900">
                    <span>{dayNames[workout.dayOfWeek]}</span>
                    {kindLabel(workout) && <span className="text-ink-400">· {kindLabel(workout)}</span>}
                    <span
                      className="rounded-pill px-2 py-0.5 text-4xs font-bold"
                      style={{
                        background: `${WORKOUT_TYPE_COLORS[classifyWorkout(workout)]}22`,
                        color: WORKOUT_TYPE_TEXT_COLORS[classifyWorkout(workout)],
                      }}
                    >
                      {typeLabel(workout)}
                    </span>
                    {workout.optional && (
                      <span className="rounded-pill bg-ink-900/[0.06] px-2 py-0.5 text-4xs font-bold text-ink-500">
                        {tp('sessionOptional')}
                      </span>
                    )}
                  </h3>
                  <p className="mt-1 text-2xs text-ink-400">
                    <bdi dir={textDir(workout.name)}>{workout.name}</bdi>
                    {sessionHeadline(workout.steps, units) && (
                      <> · <bdi dir="ltr">{sessionHeadline(workout.steps, units)}</bdi></>
                    )}
                  </p>
                </div>
                {/* The editor writes to ONE group's already-split steps by
                    design (see `handleClipboardWorkoutChange`), so the button
                    names that group — the table above shows all three, and
                    without the mark it isn't obvious which one an edit lands on. */}
                <Button variant="secondary" size="sm" onClick={props.onEditSteps}>
                  <Edit3 className="h-4 w-4" />
                  {tp('editSteps')}
                  {/* ❶❷❸ are a digit inside a filled circle, so they need a size
                      up from the text around them to read as anything but a dot. */}
                  <span className={cn('text-base leading-none', GROUP_TEXT[group - 1])}>
                    {GROUP_MARKS[group - 1]}
                  </span>
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-start gap-y-2 [&>*+*]:border-s [&>*+*]:border-page [&>*+*]:ps-4">
                <Fact
                  label={t('factDistance')}
                  value={
                    distanceOf(workout).text
                      ? (
                        <bdi dir="ltr">
                          {distanceOf(workout).approx ? '~' : ''}{distanceOf(workout).text} {units.km}
                        </bdi>
                      )
                      : <span className="text-ink-400">{t('noValue')}</span>
                  }
                />
                <Fact
                  label={t('factDuration')}
                  value={
                    durationOf(workout)
                      ? <bdi dir="ltr">{durationOf(workout)} {units.min}</bdi>
                      : <span className="text-ink-400">{t('noValue')}</span>
                  }
                />
                <Fact label={t('factSteps')} value={<bdi dir="ltr">{workout.steps.length}</bdi>} />
                <Fact
                  label={t('factBoards')}
                  value={<bdi dir="ltr">{sessionBoardsPublished(grouped, index)}/3</bdi>}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <SegmentedControl<View>
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'steps', label: t('viewSteps') },
                    { value: 'image', label: t('viewImage') },
                    { value: 'text', label: t('viewText') },
                    { value: 'source', label: t('viewSource') },
                  ]}
                  // `w-fit` sizes a control whose segments are `flex-1` down to
                  // min-content, which breaks every label onto two lines;
                  // white-space inherits, so this holds them on one.
                  className="w-fit whitespace-nowrap"
                />
                {(view === 'image' || view === 'text') && (
                  <div className="flex items-center gap-1 rounded-pill bg-card/70 p-1">
                    {GROUPS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => onGroup(g)}
                        className={cn(
                          'flex items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-1 text-2xs font-bold',
                          g === group ? 'bg-brand-600 text-white' : GROUP_TEXT[g - 1],
                        )}
                      >
                        <span className="text-sm leading-none">{GROUP_MARKS[g - 1]}</span>
                        {tp('groupLabel', { n: g })}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {view === 'steps' && (
                <StepTables workout={workout} units={units} estimateOptions={estimateOptions} />
              )}

              {view === 'image' && (
                <div className="mt-3 rounded-card bg-card p-4">
                  <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-2xl bg-page/60 p-3">
                    {props.loading && !props.preview ? (
                      <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
                    ) : props.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={props.preview}
                        alt={workout.name}
                        className="max-h-[520px] max-w-full rounded-xl object-contain"
                      />
                    ) : (
                      <p className="text-sm text-ink-400">{t('previewUnavailable')}</p>
                    )}
                  </div>
                  <p className="mt-3 text-2xs text-ink-400">{t('imageNote')}</p>
                </div>
              )}

              {view === 'text' && (
                <div className="mt-3 rounded-card bg-card p-4">
                  <pre
                    dir="ltr"
                    className="max-h-[470px] overflow-auto whitespace-pre-wrap text-start font-mono text-2xs leading-[1.85] text-ink-500"
                  >
                    {props.previewText
                      || grouped[`group${group}`].workouts[index]?.clipboardText
                      || t('rendering')}
                  </pre>
                  <p className="mt-3 text-2xs text-ink-400">{t('textNote')}</p>
                </div>
              )}

              {view === 'source' && (
                <div className="mt-3 rounded-card bg-card p-4">
                  {props.programPdfUrl ? (
                    <div className="flex flex-col items-center gap-3 rounded-2xl bg-page/60 px-4 py-10 text-center">
                      <FileText className="h-8 w-8 text-ink-400" />
                      <p className="text-2xs text-ink-400">{t('sourceNote')}</p>
                      <Button variant="secondary" size="sm" onClick={props.onOpenPdf}>
                        {t('openSource')}
                      </Button>
                    </div>
                  ) : (
                    <p className="py-10 text-center text-sm text-ink-400">{t('noSource')}</p>
                  )}
                </div>
              )}

              {(view === 'image' || view === 'text') && (
                <div className="mt-3 rounded-card bg-card/40 p-4">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-ink-900">
                    <Sparkles className="h-4 w-4 text-brand-600" />
                    {t('refineTitle')}
                  </h4>
                  <textarea
                    value={props.instruction}
                    onChange={(event) => props.onInstruction(event.target.value)}
                    placeholder={t('refinePlaceholder')}
                    className="mt-3 min-h-20 w-full rounded-2xl border border-ink-300 bg-page px-3 py-2 text-sm text-ink-700 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <SegmentedControl<'current' | 'all'>
                      value={props.refineScope}
                      onChange={props.onRefineScope}
                      options={[
                        { value: 'all', label: tp('allGroups') },
                        { value: 'current', label: tp('currentGroupOnly') },
                      ]}
                      className="w-fit whitespace-nowrap"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={props.onRefine}
                      disabled={props.loading || !props.instruction.trim()}
                    >
                      {props.loading
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Sparkles className="h-4 w-4" />}
                      {t('refine')}
                    </Button>
                  </div>
                </div>
              )}

              <Findings findings={findings} onFix={props.onEditSteps} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** A hero number over its caption; the parent draws the hairline between them. */
function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="pe-4">
      <p className="text-xl font-bold leading-tight text-ink-900">{value}</p>
      <p className="mt-0.5 text-2xs text-ink-400">{label}</p>
    </div>
  );
}

/** The same, one size down, for the open session's facts. */
function Fact({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="pe-4">
      <p className="text-sm font-bold text-ink-900">{value}</p>
      <p className="text-3xs text-ink-400">{label}</p>
    </div>
  );
}

/**
 * The session as an aligned table, a section at a time: what the step is, how
 * long it is, and the three groups' paces in three columns.
 *
 * Three columns rather than the club's inline "3:30 (3:40) ((3:50))" because the
 * question the coach is here to answer is whether ❶ really is faster than ❸ on
 * every row, and a column of numbers answers it by eye. Where a step has one pace
 * for everyone the three cells collapse into one: twenty rows of the same number
 * printed three times is how a real difference goes unnoticed.
 */
function StepTables({
  workout, units, estimateOptions,
}: {
  workout: ParsedWorkout;
  units: StepUnits;
  estimateOptions: EstimateOptions;
}) {
  const t = useTranslations('publishReview');
  const tp = useTranslations('planner');
  const te = useTranslations('workoutEditor');

  const sectionName = (kind: string) =>
    kind === 'warmup' ? tp('sectionWarmup')
    : kind === 'cooldown' ? tp('sectionCooldown')
    : tp('sectionMain');

  const stepTypeName = (step: WorkoutStep) => {
    const key = STEP_TYPE_KEYS[step.type];
    return key ? te(key as 'stepActive') : step.type;
  };

  return (
    <>
      {workoutSections(workout.steps).map((section) => {
        const rows = tableRows(section.steps);
        const range = workoutDistanceEstimate(
          { dayOfWeek: workout.dayOfWeek, name: '', steps: section.steps },
          { assumeOpenBlocks: true, ...estimateOptions },
        ).range;
        const km = roundKm((range.min + range.max) / 2);

        return (
          <div key={section.kind} className="mt-3 overflow-hidden rounded-card bg-card">
            <div className="flex items-center gap-2 bg-page/50 px-4 py-2">
              <span className="text-3xs font-bold uppercase tracking-[0.1em] text-ink-500">
                {sectionName(section.kind)}
              </span>
              {km > 0 && (
                <span className="ms-auto text-3xs text-ink-400">
                  <bdi dir="ltr">{km} {units.km}</bdi>
                </span>
              )}
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border-b border-page px-2.5 py-1.5 text-start text-4xs font-bold uppercase tracking-[0.07em] text-ink-400">
                    {t('colStep')}
                  </th>
                  <th className="border-b border-page px-2.5 py-1.5 text-start text-4xs font-bold uppercase tracking-[0.07em] text-ink-400">
                    {t('colMetric')}
                  </th>
                  {GROUPS.map((g) => (
                    <th
                      key={g}
                      className={cn(
                        'w-[74px] border-b border-page px-2.5 py-1 text-center text-base leading-none',
                        GROUP_TEXT[g - 1],
                      )}
                    >
                      {GROUP_MARKS[g - 1]}
                    </th>
                  ))}
                  <th className="border-b border-page px-2.5 py-1.5 text-start text-4xs font-bold uppercase tracking-[0.07em] text-ink-400">
                    {t('colNote')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  if (row.kind === 'repeat') {
                    return (
                      <tr key={i} className="bg-brand-600/[0.045]">
                        <td colSpan={6} className="px-2.5 pb-1.5 pt-2">
                          <span className="text-xs font-bold text-brand-600">
                            <bdi dir="ltr">{row.count} ×</bdi>
                          </span>
                          <span className="ms-2 text-3xs text-ink-400">{t('repeatSet')}</span>
                        </td>
                      </tr>
                    );
                  }

                  const step = row.step;
                  const [pace1, pace2, pace3] = stepPaceTokens(step);
                  // An empty ❷ or ❸ token means that group runs ❶'s pace, not
                  // that it has none — so the cell shows ❶'s number rather than
                  // a blank the coach would read as missing data.
                  const tokens = [pace1, pace2 || pace1, pace3 || pace1];
                  const differ = new Set(tokens.filter(Boolean)).size > 1;
                  // `stepQualifier` is what the note cell prints; when it comes
                  // back empty, the note said nothing the pace column doesn't.
                  const note = stepQualifier(step);

                  return (
                    <tr key={i} className="border-b border-page/70 last:border-b-0">
                      <td
                        className={cn(
                          'whitespace-nowrap px-2.5 py-1.5 text-xs',
                          isRestStep(step) ? 'text-ink-400' : 'text-ink-700',
                        )}
                      >
                        {row.kind === 'leg' && <span className="me-1.5 text-ink-300">└</span>}
                        {stepTypeName(step)}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-13 font-bold text-ink-900">
                        <bdi dir="ltr">{stepMetric(step, units) || te('stepOpen')}</bdi>
                      </td>
                      {!pace1 ? (
                        <td colSpan={3} className="px-2.5 py-1.5 text-center text-3xs text-ink-300">—</td>
                      ) : differ ? (
                        tokens.map((token, groupIndex) => (
                          <td
                            key={groupIndex}
                            className={cn(
                              'px-2.5 py-1.5 text-center text-13 font-bold tabular-nums',
                              GROUP_TEXT[groupIndex],
                              GROUP_CELL[groupIndex],
                            )}
                          >
                            <bdi dir="ltr">{token}</bdi>
                          </td>
                        ))
                      ) : (
                        <td colSpan={3} className="px-2.5 py-1.5 text-center text-2xs font-light text-ink-400">
                          <b className="font-bold text-ink-700"><bdi dir="ltr">{pace1}</bdi></b>
                          {' · '}{t('allGroupsSame')}
                        </td>
                      )}
                      <td className="px-2.5 py-1.5 text-2xs text-ink-400">
                        <bdi dir={textDir(note)}>{note}</bdi>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

/**
 * What the screen found in this session, in words the coach can act on — and
 * nothing that stops them publishing anyway. The audit is a second pair of eyes,
 * not a gate: the coach knows things about the week that the PDF never said.
 */
function Findings({ findings, onFix }: { findings: AuditFinding[]; onFix: () => void }) {
  const t = useTranslations('publishReview');

  return (
    <div className="mt-3 rounded-card bg-card px-4 py-3">
      <h4 className="mb-2 text-3xs font-bold uppercase tracking-[0.1em] text-ink-400">
        {t('auditTitle')}
      </h4>
      {findings.length === 0 ? (
        <p className="flex items-center gap-2 py-1 text-xs text-ink-500">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-accent-500">
            <Check className="h-3.5 w-3.5 text-white" />
          </span>
          {t('auditOk')}
        </p>
      ) : (
        findings.map((finding) => (
          <div
            key={finding.code}
            className="flex items-start gap-2.5 py-1.5 text-xs [&+&]:border-t [&+&]:border-page/70"
          >
            <span
              className={cn(
                'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full',
                finding.level === 'warn' ? 'bg-accent-red' : 'bg-ink-300',
              )}
            >
              {finding.level === 'warn'
                ? <AlertTriangle className="h-3 w-3 text-white" />
                : <Info className="h-3.5 w-3.5 text-white" />}
            </span>
            <span className="min-w-0 flex-1 text-ink-700">
              <b className="font-bold text-ink-900">
                {t(`audit_${finding.code}_title` as 'audit_noDistance_title', { count: finding.count })}
              </b>
              <i className="mt-0.5 block text-2xs not-italic text-ink-400">
                {t(`audit_${finding.code}_detail` as 'audit_noDistance_detail', { count: finding.count })}
              </i>
            </span>
            {finding.level === 'warn' && (
              <button
                type="button"
                onClick={onFix}
                className="shrink-0 text-2xs font-bold text-brand-600"
              >
                {t('fix')}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
