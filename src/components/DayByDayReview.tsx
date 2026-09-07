'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Edit3, FileText, Loader2, Save, Search, Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GroupedWeeklyPlans, ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { mergeGroupsToUnified } from '@/lib/ai/splitGroups';
import { textDir } from '@/lib/bidi';
import { cn } from '@/lib/utils';
import {
  formatKm, reviewWeek, type DayCheck, type DayReview, type KmRange, type SessionReview,
} from '@/lib/plans/day-review';
import { formatPaceRange } from '@/lib/garmin/pace';
import { boardStates } from '@/lib/plans/publish-boards';
import { sessionKind } from '@/lib/plans/session-label';
import { classifyWorkout, sessionHeadline } from '@/lib/plans/session-summary';
import { type StepUnits } from '@/lib/plans/step-display';
import { planEstimateOptions } from '@/lib/plans/step-estimate';
import { WORKOUT_TYPE_COLORS, WORKOUT_TYPE_TEXT_COLORS } from '@/lib/plans/workout-parsing';
import { Button, SegmentedControl } from '@/components/ui';
import { Findings } from '@/components/publish/Findings';
import { StepTables } from '@/components/publish/StepTables';
import { GROUPS, GROUP_MARKS, GROUP_TEXT } from '@/components/publish/groups';

/**
 * The screen the coach stands on between parsing a PDF and sending the week to
 * sixty phones — as SEVEN screens and then one.
 *
 * ── WHY DAY BY DAY ──────────────────────────────────────────────────────────
 * What this replaced put the whole week on one screen and let the coach page
 * through it in any order, which meant the honest answer to "did you check this
 * week?" was always "some of it". Nine sessions × three groups is twenty-seven
 * boards; nobody audits twenty-seven of anything by scrolling. So the review is a
 * sequence with a position in it: one day per screen, the day's own decisions on
 * that screen, and a summary of all seven at the end that holds the ONLY publish
 * button. Nothing reaches an athlete until the eighth screen.
 *
 * ── WHAT EACH DAY ACTUALLY CHECKS ───────────────────────────────────────────
 * The day's kilometres, built from its STEPS (a time and a pace multiply into a
 * distance), held against the km the coach wrote in the document's own day
 * header. That comparison is the one thing the old screen could not do: its
 * distance figure WAS the day header — `workoutDistanceEstimate` returns
 * `distanceMinKm` whenever it exists — so it printed a ✓ on days whose steps had
 * been read wrong. `lib/plans/day-review.ts` does the other direction, and five
 * of the seven days on a typical week are checkable that way because the coach
 * writes them in minutes.
 *
 * ── WHY THE APPROVALS GATE PUBLISH ──────────────────────────────────────────
 * The seven approvals are not decoration: publish stays disabled until every day
 * carries one. A counter the coach can ignore is a counter that gets ignored on
 * the week it mattered, and "some of it" is exactly the answer this screen exists
 * to stop. Skipping a day is still allowed — the rail goes anywhere — it just has
 * to be approved before the week can go out, and the summary names the days that
 * are still missing so getting unblocked is one click, not a hunt.
 *
 * An approval is bound to what it approved. Each is stored with a fingerprint of
 * that day's sessions, so refining or editing a day AFTER approving it silently
 * takes the approval back rather than letting a coach's ✓ vouch for text they
 * never read. Approvals live in component state on purpose: they say "I read this
 * just now", which is not a fact worth surviving a reload.
 *
 * Every finding beside it comes out of `workout-audit`, carries the `step.order`s
 * it is about, and stripes those rows in the table above it — so the sentence and
 * the row are the same object.
 */

export interface DayByDayReviewProps {
  grouped: GroupedWeeklyPlans;
  /** Sunday ISO of the week being published — the rail's dates. */
  weekStartDate: string;
  /** Which session is open, as an index into a group's `workouts`. */
  index: number;
  onIndex: (index: number) => void;
  /** Which group's rendered artifacts the board tabs show. */
  group: 1 | 2 | 3;
  onGroup: (group: 1 | 2 | 3) => void;
  /** Live-rendered PNG of the open session for `group`, as a data URL. */
  preview: string | null;
  previewText: string;
  loading: boolean;
  publishing: boolean;
  saving: boolean;
  onEditSteps: () => void;
  programPdfUrl: string | null;
  onOpenPdf: () => void;
  instruction: string;
  onInstruction: (value: string) => void;
  refineScope: 'current' | 'all';
  onRefineScope: (scope: 'current' | 'all') => void;
  onRefine: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  onMatches: () => void;
  /**
   * Take back the import's repairs to one session, across all three groups — the
   * document gives the three of them the same shape, so a time range restored for
   * ❶ was restored for ❷ and ❸ too, and undoing it for one alone would leave the
   * groups disagreeing about how long the session is.
   */
  onUndoAutoFix?: (index: number) => void;
}

/** Seven days, then the week. The eighth step is the only one that can publish. */
const SUMMARY = 7;

type Evidence = 'image' | 'text';

/** d/M — a day's date beside its name, short enough for a rail cell. */
function formatDayDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${Number(day)}/${Number(month)}`;
}

/** The steps this session's warnings point at — the rows to stripe. */
function flaggedSteps(session: SessionReview): Set<WorkoutStep> {
  return new Set(
    session.findings.filter((f) => f.level === 'warn').flatMap((f) => f.refs),
  );
}

export function DayByDayReview(props: DayByDayReviewProps) {
  const { grouped, weekStartDate, index, onIndex, group, onGroup } = props;
  const t = useTranslations('publishReview');
  const tp = useTranslations('planner');
  const tc = useTranslations('common');
  const ta = useTranslations('activities');

  const dayNames = tc.raw('dayNames') as string[];
  const units: StepUnits = { km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes') };

  // Rebuilt here rather than read off the page's `parsedPlan`, which two of its
  // own code paths overwrite with a bare `group1` — losing ❷/❸ at exactly the
  // moment the coach has just refined or published something.
  const unified = useMemo(() => mergeGroupsToUnified(grouped).workouts, [grouped]);
  const estimateOptions = useMemo(() => planEstimateOptions(unified), [unified]);
  const review = useMemo(
    () => reviewWeek(unified, weekStartDate, estimateOptions),
    [unified, weekStartDate, estimateOptions],
  );
  const boards = useMemo(() => boardStates(grouped), [grouped]);
  const publishedBoards = boards.filter((b) => b.published).length;

  const [step, setStep] = useState(0);
  /** dayOfWeek → the fingerprint of the day AS APPROVED. */
  const [approved, setApproved] = useState<Record<number, string>>({});
  const [evidence, setEvidence] = useState<Evidence>('image');

  const day = step < SUMMARY ? review.days[step] : null;

  // What each day's ✓ is a ✓ of. Cheap (seven days of small objects) and it makes
  // an approval expire the moment the day it approved changes.
  const fingerprints = useMemo(
    () => new Map(review.days.map((d) => [d.dayOfWeek, JSON.stringify(d.sessions.map((s) => s.workout))])),
    [review.days],
  );
  const isApproved = (dayOfWeek: number) =>
    approved[dayOfWeek] !== undefined && approved[dayOfWeek] === fingerprints.get(dayOfWeek);
  const pendingDays = review.days.filter((d) => !isApproved(d.dayOfWeek));
  const approvedCount = review.days.length - pendingDays.length;
  const canPublish = pendingDays.length === 0;

  /** Moving to a day also moves the board preview and the editor onto it. */
  const goTo = (next: number) => {
    setStep(next);
    const first = review.days[next]?.sessions[0];
    if (first) onIndex(first.index);
  };

  const approveDay = () => {
    if (day) {
      const mark = fingerprints.get(day.dayOfWeek) ?? '';
      setApproved((prev) => ({ ...prev, [day.dayOfWeek]: mark }));
    }
    goTo(Math.min(step + 1, SUMMARY));
  };

  const openDecisions = pendingDays.reduce((n, d) => n + d.warnings, 0);

  const typeLabel = (w: ParsedWorkout) => ta(`runType_${classifyWorkout(w)}` as 'runType_easy');

  const kindLabel = (w: ParsedWorkout) => {
    const kind = sessionKind(w);
    if (kind === 'morning') return tp('sessionMorning');
    if (kind === 'evening') return tp('sessionEvening');
    if (kind === 'part') return tp('partLabel', { index: w.partIndex ?? 1, count: w.partCount ?? 1 });
    return '';
  };

  return (
    <div>
      {/* ═══ the rail: the spine of the flow, and the only navigation ═══ */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-page bg-card px-4 pb-2.5 pt-1">
        <div className="flex gap-1.5">
          {review.days.map((d, i) => (
            <RailCell
              key={d.dayOfWeek}
              label={dayNames[d.dayOfWeek]}
              km={d.headerKm}
              unit={units.km}
              state={
                step === i ? 'now'
                : isApproved(d.dayOfWeek) ? 'done'
                : d.sessions.length === 0 ? 'rest'
                : d.warnings > 0 ? 'flag'
                : 'todo'
              }
              note={
                isApproved(d.dayOfWeek) ? t('dayApproved')
                : step === i ? t('dayNow')
                : d.sessions.length === 0 ? t('dayRest')
                : d.warnings > 0 ? t('dayToReview', { count: d.warnings })
                : t('dayClean')
              }
              onClick={() => goTo(i)}
            />
          ))}
          <RailCell
            label={t('railSummary')}
            state={step === SUMMARY ? 'now' : canPublish ? 'done' : 'todo'}
            note={t('daysApprovedShort', { count: approvedCount })}
            onClick={() => setStep(SUMMARY)}
          />
        </div>
      </div>

      {day ? (
        <DayScreen
          {...props}
          day={day}
          dayName={dayNames[day.dayOfWeek]}
          units={units}
          estimateOptions={estimateOptions}
          evidence={evidence}
          onEvidence={setEvidence}
          typeLabel={typeLabel}
          kindLabel={kindLabel}
        />
      ) : (
        <WeekScreen
          review={review}
          grouped={grouped}
          dayNames={dayNames}
          units={units}
          isApproved={isApproved}
          approvedCount={approvedCount}
          pendingDays={pendingDays}
          publishedBoards={publishedBoards}
          totalBoards={boards.length}
          onOpenDay={goTo}
        />
      )}

      {/* ═══ the step bar ═══ */}
      <div className="sticky bottom-0 -mx-4 mt-4 flex flex-wrap items-center gap-3 border-t border-page bg-card px-4 py-3">
        <span className="text-xs font-bold text-ink-900">
          {day
            ? t('flowStep', { n: step + 1 })
            : t('flowSummaryStep')}
        </span>
        <span className="text-2xs text-ink-400">
          {t('flowProgress', { approved: approvedCount, warnings: openDecisions })}
        </span>

        <div className="ms-auto flex items-center gap-2">
          {step > 0 && (
            <Button variant="secondary" size="sm" onClick={() => goTo(step - 1)}>
              <ArrowRight className="h-4 w-4 rtl:hidden" />
              <ArrowLeft className="hidden h-4 w-4 rtl:block" />
              {t('flowBack')}
            </Button>
          )}
          {day ? (
            <Button size="sm" onClick={approveDay}>
              <Check className="h-4 w-4" />
              {step === SUMMARY - 1
                ? t('approveAndFinish', { day: dayNames[day.dayOfWeek] })
                : t('approveAndNext', { day: dayNames[day.dayOfWeek] })}
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={props.onMatches} disabled={props.loading}>
                <Search className="h-4 w-4" />
                {tp('activityMatches')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={props.onSaveDraft}
                disabled={props.saving || props.loading}
              >
                {props.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {tp('saveDraft')}
              </Button>
              {/* Blocked until all seven are approved — with the reason next to
                  the button, since a disabled button that doesn't say why reads
                  as a broken screen. */}
              {!canPublish && (
                <span className="text-2xs font-bold text-accent-red-ink">
                  {t('publishBlocked', { count: pendingDays.length })}
                </span>
              )}
              <Button
                onClick={props.onPublish}
                disabled={!canPublish || props.loading || props.publishing}
                title={canPublish ? undefined : t('publishBlocked', { count: pendingDays.length })}
                className="px-5"
              >
                {props.loading || props.publishing
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <CheckCircle2 className="h-4 w-4" />}
                {tp('publishAllClipboards')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

type RailState = 'done' | 'now' | 'todo' | 'flag' | 'rest';

/**
 * One day in the rail. The top hairline carries the state, not the text colour:
 * seven cells of coloured words is a rail nobody can read at a glance, and the
 * one thing it has to answer is "where am I and what is left".
 */
function RailCell({
  label, km, unit, state, note, onClick,
}: {
  label: string;
  km?: KmRange | null;
  unit?: string;
  state: RailState;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex-1 overflow-hidden rounded-2xl px-2 pb-2 pt-2.5 text-start',
        state === 'now' ? 'bg-card ring-2 ring-brand-600' : 'bg-card/60 hover:bg-card',
      )}
    >
      <span
        className={cn(
          'absolute inset-x-0 top-0 h-[3px]',
          state === 'now' ? 'bg-brand-600'
            : state === 'done' ? 'bg-accent-500'
            : state === 'flag' ? 'bg-accent-red'
            : 'bg-transparent',
        )}
      />
      <span className={cn('block truncate text-xs font-bold', state === 'rest' || state === 'todo' ? 'text-ink-500' : 'text-ink-900')}>
        {label}
      </span>
      {km && unit && (
        <span className="block truncate text-3xs text-ink-400">
          <bdi dir="ltr">{formatKm(km)} {unit}</bdi>
        </span>
      )}
      <span
        className={cn(
          'mt-0.5 block truncate text-4xs font-bold',
          state === 'now' ? 'text-brand-600'
            : state === 'done' ? 'text-accent-600'
            : state === 'flag' ? 'text-accent-red-ink'
            : 'text-ink-400',
        )}
      >
        {note}
      </span>
    </button>
  );
}

/** The day's own verdict, as a chip that says which way it is wrong. */
function CheckChip({ check, gap }: { check: DayCheck; gap: string }) {
  const t = useTranslations('publishReview');
  const label = check === 'match' ? t('checkMatch')
    : check === 'below' ? t('checkBelow')
    : check === 'above' ? t('checkAbove')
    : check === 'rest' ? t('dayRest')
    : t('checkUnchecked');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-2xs font-bold',
        check === 'match' ? 'bg-accent-500/[0.16] text-accent-900'
          : check === 'below' || check === 'above' ? 'bg-accent-red/[0.12] text-accent-red-ink'
          : 'bg-ink-900/[0.05] text-ink-500',
      )}
    >
      {check === 'match' && <Check className="h-3 w-3" />}
      {label}
      {gap && <bdi dir="ltr" className="font-light">{gap}</bdi>}
    </span>
  );
}

/** "חסרים 4.8 ק״מ" — how far off the header the steps came out, if they did. */
function kmGap(day: DayReview, unit: string): string {
  if (!day.headerKm || !day.derivedKm) return '';
  if (day.check === 'below') return `· ${(Math.round((day.headerKm.min - day.derivedKm.max) * 10) / 10)} ${unit}`;
  if (day.check === 'above') return `· ${(Math.round((day.derivedKm.min - day.headerKm.max) * 10) / 10)} ${unit}`;
  return '';
}

function Ledger({ label, value, tone }: { label: string; value: ReactNode; tone?: 'quiet' }) {
  return (
    <div className="rounded-2xl bg-card px-3.5 py-2.5">
      <p className="text-3xs text-ink-400">{label}</p>
      <p className={cn('text-base font-bold leading-tight', tone === 'quiet' ? 'text-ink-500' : 'text-ink-900')}>
        {value}
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

interface DayScreenProps extends DayByDayReviewProps {
  day: DayReview;
  dayName: string;
  units: StepUnits;
  estimateOptions: ReturnType<typeof planEstimateOptions>;
  evidence: Evidence;
  onEvidence: (view: Evidence) => void;
  typeLabel: (w: ParsedWorkout) => string;
  kindLabel: (w: ParsedWorkout) => string;
}

function DayScreen(props: DayScreenProps) {
  const { day, dayName, units, estimateOptions, grouped, index, onIndex, group, onGroup } = props;
  const t = useTranslations('publishReview');
  const tp = useTranslations('planner');

  return (
    <div>
      {/* ═══ the day's ledger: what the coach wrote, what will be sent ═══ */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="me-1 text-base font-bold text-ink-900">
          {dayName}
          <span className="ms-2 text-2xs font-light text-ink-400">
            <bdi dir="ltr">{formatDayDate(day.dateKey)}</bdi>
          </span>
        </h3>
        <CheckChip check={day.check} gap={kmGap(day, units.km)} />
        <span className="rounded-pill bg-ink-900/[0.05] px-2.5 py-1 text-2xs text-ink-500">
          {day.publishFrom === 'header' ? t('fromHeader')
            : day.publishFrom === 'derived' ? t('fromDerived')
            : t('noHeaderKm')}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Ledger
          label={t('ledgerHeader')}
          value={day.headerKm
            ? <bdi dir="ltr">{formatKm(day.headerKm)} {units.km}</bdi>
            : <span className="text-ink-400">{t('noValue')}</span>}
        />
        <Ledger
          label={t('ledgerDerived')}
          value={day.derivedKm
            ? <bdi dir="ltr">{formatKm(day.derivedKm)} {units.km}</bdi>
            : <span className="text-ink-400">{t('noValue')}</span>}
        />
        <Ledger
          label={t('ledgerPublish')}
          value={day.publishKm
            ? <bdi dir="ltr">{formatKm(day.publishKm)} {units.km}</bdi>
            : <span className="text-ink-400">{t('noValue')}</span>}
        />
        <Ledger
          label={t('ledgerOptional')}
          tone={day.optionalKm ? undefined : 'quiet'}
          value={day.optionalKm
            ? <bdi dir="ltr">+{formatKm(day.optionalKm)} {units.km}</bdi>
            : <span className="text-ink-400">—</span>}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        {/* ═══ what was read ═══ */}
        <div className="min-w-0">
          {day.sessions.length === 0 ? (
            <p className="rounded-card bg-card px-4 py-10 text-center text-sm text-ink-400">
              {t('restDayNothing')}
            </p>
          ) : (
            day.sessions.map((session, position) => {
              const open = session.index === index;
              const w = session.workout;
              return (
                <section
                  key={session.key}
                  className={cn(
                    'mb-4 rounded-card p-0.5',
                    open ? 'ring-2 ring-brand-600/25' : '',
                  )}
                >
                  <header className="flex flex-wrap items-start justify-between gap-2 px-3 pb-1 pt-2">
                    <button
                      type="button"
                      onClick={() => onIndex(session.index)}
                      className="min-w-0 text-start"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        {day.sessions.length > 1 && (
                          <span className="text-3xs font-bold text-ink-400">
                            {t('sessionOf', { n: position + 1, count: day.sessions.length })}
                          </span>
                        )}
                        <span
                          className="rounded-pill px-2 py-0.5 text-4xs font-bold"
                          style={{
                            background: `${WORKOUT_TYPE_COLORS[classifyWorkout(w)]}22`,
                            color: WORKOUT_TYPE_TEXT_COLORS[classifyWorkout(w)],
                          }}
                        >
                          {props.typeLabel(w)}
                        </span>
                        {props.kindLabel(w) && (
                          <span className="text-4xs font-bold text-ink-400">{props.kindLabel(w)}</span>
                        )}
                        {w.optional && (
                          <span className="rounded-pill bg-ink-900/[0.06] px-2 py-0.5 text-4xs font-bold text-ink-500">
                            {tp('sessionOptional')}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-13 text-ink-700">
                        <bdi dir={textDir(w.name)}>{w.name}</bdi>
                        {sessionHeadline(w.steps, units) && (
                          <> · <bdi dir="ltr">{sessionHeadline(w.steps, units)}</bdi></>
                        )}
                      </span>
                    </button>
                    {/* The editor writes to ONE group's already-split steps by
                        design, so the button names that group — the table shows
                        all three, and without the mark it isn't obvious which
                        one an edit lands on. */}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { onIndex(session.index); props.onEditSteps(); }}
                    >
                      <Edit3 className="h-4 w-4" />
                      {tp('editSteps')}
                      <span className={cn('text-base leading-none', GROUP_TEXT[group - 1])}>
                        {GROUP_MARKS[group - 1]}
                      </span>
                    </Button>
                  </header>

                  <StepTables
                    workout={w}
                    units={units}
                    estimateOptions={estimateOptions}
                    flagged={flaggedSteps(session)}
                  />
                  <Findings
                    findings={session.findings}
                    onFix={() => { onIndex(session.index); props.onEditSteps(); }}
                    onUndoAutoFix={
                      props.onUndoAutoFix
                        ? () => props.onUndoAutoFix?.(session.index)
                        : undefined
                    }
                  />
                </section>
              );
            })
          )}
        </div>

        {/* ═══ the source, and the board the athlete will get ═══ */}
        <aside className="min-w-0">
          <div className="rounded-card bg-card p-3.5">
            <h4 className="mb-2 text-3xs font-bold uppercase tracking-[0.1em] text-ink-400">
              {t('evidenceTitle')}
            </h4>
            {props.programPdfUrl ? (
              <>
                <p className="text-2xs leading-relaxed text-ink-400">{t('sourceNote')}</p>
                <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={props.onOpenPdf}>
                  <FileText className="h-4 w-4" />
                  {t('openSource')}
                </Button>
              </>
            ) : (
              <p className="py-3 text-2xs text-ink-400">{t('noSource')}</p>
            )}
          </div>

          <div className="mt-3 rounded-card bg-card p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl<Evidence>
                value={props.evidence}
                onChange={props.onEvidence}
                options={[
                  { value: 'image', label: t('viewImage') },
                  { value: 'text', label: t('viewText') },
                ]}
                className="w-fit whitespace-nowrap"
              />
              <div className="ms-auto flex items-center gap-1 rounded-pill bg-page/70 p-0.5">
                {GROUPS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => onGroup(g)}
                    className={cn(
                      'rounded-pill px-2 py-1 text-sm leading-none',
                      g === group ? 'bg-brand-600 text-white' : GROUP_TEXT[g - 1],
                    )}
                    title={tp('groupLabel', { n: g })}
                  >
                    {GROUP_MARKS[g - 1]}
                  </button>
                ))}
              </div>
            </div>

            {props.evidence === 'image' ? (
              <>
                <div className="mt-3 flex min-h-[220px] items-center justify-center overflow-hidden rounded-2xl bg-page/60 p-2">
                  {props.loading && !props.preview ? (
                    <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
                  ) : props.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={props.preview}
                      alt={day.sessions.find((s) => s.index === index)?.workout.name || ''}
                      className="max-h-[380px] max-w-full rounded-xl object-contain"
                    />
                  ) : (
                    <p className="text-2xs text-ink-400">{t('previewUnavailable')}</p>
                  )}
                </div>
                <p className="mt-2 text-3xs text-ink-400">{t('imageNote')}</p>
              </>
            ) : (
              <>
                <pre
                  dir="ltr"
                  className="mt-3 max-h-[380px] overflow-auto whitespace-pre-wrap rounded-2xl bg-page/60 p-3 text-start font-mono text-3xs leading-[1.8] text-ink-500"
                >
                  {props.previewText
                    || grouped[`group${group}`].workouts[index]?.clipboardText
                    || t('rendering')}
                </pre>
                <p className="mt-2 text-3xs text-ink-400">{t('textNote')}</p>
              </>
            )}
          </div>

          <div className="mt-3 rounded-card bg-card/45 p-3.5">
            <h4 className="flex items-center gap-2 text-xs font-bold text-ink-900">
              <Sparkles className="h-4 w-4 text-brand-600" />
              {t('refineTitle')}
            </h4>
            <textarea
              value={props.instruction}
              onChange={(event) => props.onInstruction(event.target.value)}
              placeholder={t('refinePlaceholder')}
              className="mt-2 min-h-16 w-full rounded-2xl border border-ink-300 bg-page px-3 py-2 text-13 text-ink-700 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
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
        </aside>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

/** The span of target paces in one group's copy of a session, slowest to fastest. */
function paceSpan(workout: ParsedWorkout | undefined): string {
  if (!workout) return '';
  let min: number | null = null;
  let max: number | null = null;
  const walk = (steps: WorkoutStep[]) => {
    for (const step of steps) {
      if (step.repeatSteps?.length) walk(step.repeatSteps);
      const lo = step.targetPaceMinPerKm;
      if (!lo) continue;
      const hi = step.targetPaceMaxPerKm || lo;
      min = min == null ? lo : Math.min(min, lo);
      max = max == null ? hi : Math.max(max, hi);
    }
  };
  walk(workout.steps || []);
  return formatPaceRange(min, max);
}

/**
 * What each group actually gets on this day — its PACES, because that is the only
 * thing the three boards differ in. The shape ("6 km", "50 min") is one column of
 * the document handed to all three by definition, and printing it three times is
 * how a week in which ❷ and ❸ were quietly given ❶'s numbers looks correct on
 * the last screen before it goes out. Identical spans collapse into one cell that
 * SAYS they are identical, which is the same idiom as the day's step tables.
 */
function GroupCells({ day, grouped }: { day: DayReview; grouped: GroupedWeeklyPlans }) {
  const t = useTranslations('publishReview');

  if (day.sessions.length === 0) {
    return <div className="col-span-3 border-s border-page/70 px-3 py-2.5 text-3xs text-ink-300">—</div>;
  }

  const columns = GROUPS.map((g) => day.sessions
    .map((s) => paceSpan(grouped[`group${g}`].workouts[s.index]))
    .filter(Boolean)
    .join(' · '));

  if (new Set(columns).size === 1) {
    return (
      <div className="col-span-3 border-s border-page/70 px-3 py-2.5 text-3xs text-ink-500">
        {columns[0] ? (
          <>
            <b className="font-bold tabular-nums text-ink-700"><bdi dir="ltr">{columns[0]}</bdi></b>
            {' · '}{t('allGroupsSame')}
          </>
        ) : (
          <span className="text-ink-300">{t('noPaceOnDay')}</span>
        )}
      </div>
    );
  }

  return (
    <>
      {columns.map((span, i) => (
        <div
          key={i}
          className={cn(
            'border-s border-page/70 px-3 py-2.5 text-3xs font-bold tabular-nums',
            GROUP_TEXT[i],
          )}
        >
          <bdi dir="ltr">{span || '—'}</bdi>
        </div>
      ))}
    </>
  );
}

/**
 * The eighth screen: seven days × three groups at once, the week's own total
 * against the coach's, and the only publish button in the flow.
 */
function WeekScreen({
  review, grouped, dayNames, units, isApproved, approvedCount, pendingDays,
  publishedBoards, totalBoards, onOpenDay,
}: {
  review: ReturnType<typeof reviewWeek>;
  grouped: GroupedWeeklyPlans;
  dayNames: string[];
  units: StepUnits;
  isApproved: (dayOfWeek: number) => boolean;
  approvedCount: number;
  /** The days still holding publish back, in week order. */
  pendingDays: DayReview[];
  publishedBoards: number;
  totalBoards: number;
  onOpenDay: (day: number) => void;
}) {
  const t = useTranslations('publishReview');
  const tp = useTranslations('planner');

  const weekGap = review.headerKm && review.derivedKm
    ? review.check === 'below'
      ? `· ${Math.round((review.headerKm.min - review.derivedKm.max) * 10) / 10} ${units.km}`
      : review.check === 'above'
        ? `· ${Math.round((review.derivedKm.min - review.headerKm.max) * 10) / 10} ${units.km}`
        : ''
    : '';

  const daysOff = review.days.filter((d) => d.check === 'below' || d.check === 'above').length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="me-1 text-base font-bold text-ink-900">{t('summaryTitle')}</h3>
        <CheckChip check={review.check} gap={weekGap} />
        {/* A weekly total can agree while two of its days are wrong in opposite
            directions, and the total is the number this screen shows biggest —
            so the days that failed are named beside it, not left to the rail. */}
        {daysOff > 0 && (
          <span className="rounded-pill bg-accent-red/[0.12] px-2.5 py-1 text-2xs font-bold text-accent-red-ink">
            {t('weekDaysOff', { count: daysOff })}
          </span>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Ledger
          label={t('weekHeaderTotal')}
          value={review.headerKm
            ? <bdi dir="ltr">{formatKm(review.headerKm)} {units.km}</bdi>
            : <span className="text-ink-400">{t('noValue')}</span>}
        />
        <Ledger
          label={t('weekDerivedTotal')}
          value={review.derivedKm
            ? <bdi dir="ltr">{formatKm(review.derivedKm)} {units.km}</bdi>
            : <span className="text-ink-400">{t('noValue')}</span>}
        />
        <Ledger
          label={t('weekPublishTotal')}
          value={review.publishKm
            ? <bdi dir="ltr">{formatKm(review.publishKm)} {units.km}</bdi>
            : <span className="text-ink-400">{t('noValue')}</span>}
        />
        <Ledger
          label={t('statBoards')}
          value={<bdi dir="ltr">{publishedBoards}/{totalBoards}</bdi>}
        />
      </div>

      <p className="mb-3 rounded-2xl bg-card/45 px-3.5 py-2.5 text-2xs leading-relaxed text-ink-500">
        {t('weekCheckedDays', { count: review.checkedDays, days: review.trainingDays })}
        {review.derivedDays > 0 && <> {t('weekDerivedDays', { count: review.derivedDays })}</>}
      </p>

      {/* seven days × three groups — the shape the program is written in */}
      <div className="overflow-hidden rounded-card bg-card">
        <div className="grid grid-cols-[minmax(150px,1fr)_1fr_1fr_1fr] items-center border-b border-page bg-page/50">
          <span className="px-3 py-2 text-4xs font-bold uppercase tracking-[0.08em] text-ink-400">
            {t('colDay')}
          </span>
          {GROUPS.map((g) => (
            <span key={g} className="flex items-center gap-1.5 px-3 py-2 text-3xs text-ink-500">
              <span className={cn('text-base leading-none', GROUP_TEXT[g - 1])}>{GROUP_MARKS[g - 1]}</span>
              {tp('groupLabel', { n: g })}
            </span>
          ))}
        </div>

        {review.days.map((day) => (
          <div
            key={day.dayOfWeek}
            className="grid grid-cols-[minmax(150px,1fr)_1fr_1fr_1fr] items-stretch border-b border-page/70 last:border-b-0"
          >
            <button
              type="button"
              onClick={() => onOpenDay(day.dayOfWeek)}
              className="bg-page/45 px-3 py-2.5 text-start hover:bg-page/70"
            >
              <span className="flex items-center gap-1.5 text-13 font-bold text-ink-900">
                {dayNames[day.dayOfWeek]}
                {isApproved(day.dayOfWeek) && (
                  <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-accent-600">
                    <Check className="h-2.5 w-2.5 text-white" />
                  </span>
                )}
              </span>
              {day.sessions.length === 0 ? (
                <span className="block text-3xs text-ink-400">{t('dayRest')}</span>
              ) : (
                <>
                  <span className="block truncate text-3xs text-ink-500">
                    <bdi dir="ltr">
                      {day.sessions.map((s) => sessionHeadline(s.workout.steps, units)).filter(Boolean).join(' + ')}
                    </bdi>
                    {day.sessions.some((s) => s.workout.optional) && (
                      <span className="ms-1 rounded-pill bg-card px-1.5 py-0.5 text-4xs text-ink-400">
                        {tp('sessionOptional')}
                      </span>
                    )}
                  </span>
                  {/* One figure, not two: on a day whose header carries km the
                      published number IS the header, and printing it twice reads
                      as a check having been done. The label says which it is. */}
                  <span className="block text-3xs tabular-nums text-ink-500">
                    {day.publishFrom === 'derived' ? t('fromDerived') : t('ledgerHeader')}{' '}
                    <b className="font-bold text-ink-900">
                      <bdi dir="ltr">{formatKm(day.publishKm) || '—'} {units.km}</bdi>
                    </b>
                  </span>
                  <span
                    className={cn(
                      'mt-1 inline-block rounded-pill px-1.5 py-0.5 text-4xs font-bold',
                      day.check === 'match' ? 'bg-accent-500/[0.16] text-accent-900'
                        : day.check === 'unchecked' ? 'bg-ink-900/[0.05] text-ink-500'
                        : 'bg-accent-red/[0.12] text-accent-red-ink',
                    )}
                  >
                    {day.check === 'match' ? t('checkMatch')
                      : day.check === 'below' ? t('checkBelow')
                      : day.check === 'above' ? t('checkAbove')
                      : t('checkUnchecked')}
                  </span>
                </>
              )}
            </button>

            <GroupCells day={day} grouped={grouped} />
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-card bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-2xs leading-relaxed text-ink-500">{t('publishNote')}</p>
          <span
            className={cn(
              'ms-auto rounded-pill px-3 py-1.5 text-2xs font-bold',
              pendingDays.length === 0
                ? 'bg-accent-500/[0.16] text-accent-900'
                : 'bg-accent-red/[0.12] text-accent-red-ink',
            )}
          >
            {t('daysApproved', { count: approvedCount })}
          </span>
        </div>
        {/* The days holding publish back, as the way to go read them. Named here
            rather than left to the rail: on the screen where the coach is trying
            to publish, "which day am I missing" has to be answerable without
            scanning seven cells. */}
        {pendingDays.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-page pt-2.5">
            <span className="text-2xs text-ink-500">{t('publishRemaining')}</span>
            {pendingDays.map((day) => (
              <button
                key={day.dayOfWeek}
                type="button"
                onClick={() => onOpenDay(day.dayOfWeek)}
                className="rounded-pill bg-page px-2.5 py-1 text-2xs font-bold text-ink-700 hover:bg-page/60"
              >
                {dayNames[day.dayOfWeek]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
