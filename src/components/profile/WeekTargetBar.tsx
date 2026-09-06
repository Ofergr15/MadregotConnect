'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  weekTargetState,
  weekTargetProgressPct,
  weekTargetFloorPct,
  type WeekTarget,
} from '@/lib/plans/week-target';

/**
 * This week's kilometres against the plan's target RANGE.
 *
 * One component for both profile surfaces — the owner's own screen and a
 * teammate's — because the two sit on the same page in the same club week and
 * must not draw the same athlete's week two different ways.
 *
 * The track runs 0 → the range's ceiling. A shaded band marks the floor onwards,
 * so "am I in the band yet" is answerable at a glance rather than by comparing
 * the fill against a number: reach the shaded part and you are on plan.
 */
export function WeekTargetBar({
  title,
  doneKm,
  target,
  badge,
}: {
  title: string;
  doneKm: number;
  target: WeekTarget;
  /** The like-for-like trend pill, when the caller has one to show. */
  badge?: React.ReactNode;
}) {
  const t = useTranslations('profile');
  const state = weekTargetState(doneKm, target);
  const fillPct = weekTargetProgressPct(doneKm, target);
  const floorPct = weekTargetFloorPct(target);

  const tone =
    state === 'below'
      ? { fill: 'bg-brand-600', pill: null as string | null, label: '' }
      : state === 'in'
        ? { fill: 'bg-accent-600', pill: 'bg-accent-600/10 text-accent-900', label: t('weekOnPlan') }
        : { fill: 'bg-band-3', pill: 'bg-band-3/10 text-band-3-ink', label: t('weekAbovePlan') };

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-2">
        <h2 className="text-xl font-bold text-ink-700">{title}</h2>
        <div className="flex shrink-0 items-baseline gap-2">
          {badge}
          <p className="text-2xl font-bold text-brand-600 tabular-nums">
            {Math.round(doneKm * 10) / 10}
            <span className="text-ink-400">/</span>
            {/* dir="ltr" on the range: in Hebrew flow bidi reverses the two ends
                and "100–146" renders as "146–100", i.e. a target that counts
                down. The whole span is one atom, so it goes in a single bdi. */}
            <bdi dir="ltr" className="text-ink-700">
              {Math.round(target.min)}–{Math.round(target.max)}
            </bdi>
          </p>
        </div>
      </div>

      {/* Logical inset, not `left`: the fill has to grow from the right in
          Hebrew and the left in English, and the band has to follow it. */}
      <div className="relative h-3 w-full overflow-hidden rounded-pill bg-card">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 bg-ink-300/35"
          style={{ insetInlineStart: `${floorPct}%`, width: `${100 - floorPct}%` }}
        />
        <div
          className={cn('absolute inset-y-0 rounded-pill transition-[width] duration-500', tone.fill)}
          style={{ insetInlineStart: 0, width: `${fillPct}%` }}
        />
        {/* The floor, drawn ON TOP of the fill. Behind it the shading disappeared
            the moment the fill passed it, which is exactly when knowing where the
            band starts matters most. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 bg-ink-700/40"
          style={{ insetInlineStart: `calc(${floorPct}% - 1px)` }}
        />
      </div>

      {tone.pill && (
        <p className="mt-1.5 flex justify-end">
          <span className={cn('rounded-md px-1.5 py-0.5 text-3xs font-bold', tone.pill)}>{tone.label}</span>
        </p>
      )}
    </div>
  );
}
