'use client';

import { useTranslations } from 'next-intl';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { textDir } from '@/lib/bidi';
import { cn } from '@/lib/utils';
import { stepPaceTokens } from '@/lib/garmin/pace';
import { isRestStep, stepMetric, stepQualifier, type StepUnits } from '@/lib/plans/step-display';
import { workoutDistanceEstimate, type EstimateOptions } from '@/lib/plans/step-estimate';
import { tableRows, workoutSections } from '@/lib/plans/workout-shape';
import { GROUPS, GROUP_CELL, GROUP_MARKS, GROUP_TEXT, roundKm } from './groups';

/**
 * The session as an aligned table, a section at a time: what the step is, how
 * long it is, and the three groups' paces in three columns.
 *
 * Three columns rather than the club's inline "3:30 (3:40) ((3:50))" because the
 * question the coach is here to answer is whether ❶ really is faster than ❸ on
 * every row, and a column of numbers answers it by eye. Where a step has one pace
 * for everyone the three cells collapse into one: twenty rows of the same number
 * printed three times is how a real difference goes unnoticed.
 *
 * `flagged` is the set of steps the day's findings point at (the step objects
 * themselves — see AuditFinding.refs), so the row the warning is ABOUT is marked
 * on the row rather than described in a sentence underneath the table.
 */

const STEP_TYPE_KEYS: Record<string, string> = {
  warmup: 'stepWarmup', cooldown: 'stepCooldown', interval: 'stepInterval',
  active: 'stepActive', rest: 'stepRest', recovery: 'stepRecovery',
};

export function StepTables({
  workout, units, estimateOptions, flagged,
}: {
  workout: ParsedWorkout;
  units: StepUnits;
  estimateOptions: EstimateOptions;
  flagged?: Set<WorkoutStep>;
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
                  // By identity: `order` restarts inside a repeat block, so a set
                  // of numbers stripes a top-level row because a 200 m leg
                  // shares its number.
                  const isFlagged = !!flagged?.has(step);

                  return (
                    <tr
                      key={i}
                      className={cn(
                        'border-b border-page/70 last:border-b-0',
                        isFlagged && 'bg-accent-red/[0.05]',
                      )}
                    >
                      <td
                        className={cn(
                          'whitespace-nowrap px-2.5 py-1.5 text-xs',
                          isRestStep(step) ? 'text-ink-400' : 'text-ink-700',
                          // The stripe, rather than a badge in a sixth column:
                          // it points at the row from the edge the eye starts on.
                          isFlagged && 'shadow-[inset_3px_0_0_#AD3838]',
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
                        // One pace across all three cells. On a flagged row that
                        // is the finding itself — the coach is looking at one
                        // column of the document handed to everybody — so it is
                        // spelled out in three cells instead of collapsed into a
                        // reassuring "all groups".
                        isFlagged ? (
                          tokens.map((token, groupIndex) => (
                            <td
                              key={groupIndex}
                              className="px-2.5 py-1.5 text-center text-13 font-bold tabular-nums text-accent-red-ink"
                            >
                              <bdi dir="ltr">{token}</bdi>
                            </td>
                          ))
                        ) : (
                          <td colSpan={3} className="px-2.5 py-1.5 text-center text-2xs font-light text-ink-400">
                            <b className="font-bold text-ink-700"><bdi dir="ltr">{pace1}</bdi></b>
                            {' · '}{t('allGroupsSame')}
                          </td>
                        )
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
