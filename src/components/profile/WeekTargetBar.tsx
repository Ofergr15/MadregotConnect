'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { weekTargetState, weekTargetSegments, type WeekTarget } from '@/lib/plans/week-target';

/**
 * This week's kilometres against the plan's target RANGE.
 *
 * One component for both profile surfaces — the owner's own screen and a
 * teammate's — because the two sit on the same page in the same club week and
 * must not draw the same athlete's week two different ways.
 *
 * The track runs 0 → the range's ceiling, and the floor onwards is a GREEN zone:
 * reach the green and you are on plan. Green rather than the grey wash it used to
 * be, because grey is the app's colour for the part of a track that has not
 * happened yet — the zone read as the leftover, when it is the target. The whole
 * question the bar answers is "have I got into the band", and the answer should
 * be a colour, not a comparison of the fill against the number in the header.
 *
 * So the fill is CUT AT THE BAND'S EDGES rather than drawn in one colour: the
 * kilometres inside the band get the bright green, the ones before it the dark
 * green (or blue, while the week is still short of the floor), the ones past the
 * ceiling the orange. A single-coloured fill hid the band in exactly the two
 * states worth reading — a week landing on the ceiling covered it end to end,
 * and a week past it covered it and kept going.
 *
 * `optionalKm` is spelled out underneath for the same reason: a band this wide
 * looks arbitrary until you know the top of it is the offered evening sessions.
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
  const { fillPct, floorPct, ceilingPct, inEndPct, inBand, showFloorTick } =
    weekTargetSegments(doneKm, target);

  const tone =
    state === 'below'
      ? { pill: null as string | null, label: '' }
      : state === 'in'
        ? { pill: 'bg-accent-600/10 text-accent-900', label: t('weekOnPlan') }
        : { pill: 'bg-band-3/10 text-band-3-ink', label: t('weekAbovePlan') };

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
      {/* THREE SEGMENTS, one meaning each, so the band is a visible stretch of
          the bar in every state — including the two where a single-coloured fill
          used to swallow it whole (landing exactly on the ceiling, and running
          past it):
            before the floor  — kilometres that have not reached the target yet
            floor → ceiling   — the kilometres that landed INSIDE the band
            past the ceiling  — the overshoot
          The pale wash behind them is the rest of the band, i.e. what is still
          on offer this week. */}
      <div className="relative h-3 w-full overflow-hidden rounded-pill bg-card">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 bg-accent-500/25"
          style={{ insetInlineStart: `${floorPct}%`, width: `${ceilingPct - floorPct}%` }}
        />
        {/* Everything run so far. Blue while the week is still short of the
            band; the app's darkest green once it is inside, so the bright green
            on top of it reads as the part that counts. */}
        <div
          className={cn(
            'absolute inset-y-0 rounded-pill transition-[width] duration-500',
            state === 'below' ? 'bg-brand-600' : 'bg-accent-900',
          )}
          style={{ insetInlineStart: 0, width: `${fillPct}%` }}
        />
        {inBand && (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 bg-accent-600 transition-[width] duration-500"
            style={{ insetInlineStart: `${floorPct}%`, width: `${inEndPct - floorPct}%` }}
          />
        )}
        {state === 'above' && (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 rounded-e-pill bg-band-3"
            style={{ insetInlineStart: `${ceilingPct}%`, width: `${fillPct - ceilingPct}%` }}
          />
        )}
        {/* The floor, only while nothing has crossed it. Past that the colour
            change marks the same line, and a second marker on top of it is
            noise. */}
        {showFloorTick && (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5 bg-accent-900"
            style={{ insetInlineStart: `calc(${floorPct}% - 1px)` }}
          />
        )}
      </div>

      <p className="mt-1.5 flex items-center gap-1.5 text-3xs text-ink-400">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-tile bg-accent-500/25 ring-1 ring-accent-900/25" />
        <span>
          {t('weekTargetLegend')}
          {/* Only when the plan really has offered sessions. On a week where
              everything is prescribed the sentence would claim a nuance that
              isn't there, and on an older plan the split is unknowable. */}
          {target.optionalKm > 0 && ` · ${t('weekTargetOptional', { km: target.optionalKm })}`}
        </span>
        {tone.pill && (
          <span className={cn('ms-auto shrink-0 rounded-md px-1.5 py-0.5 font-bold', tone.pill)}>{tone.label}</span>
        )}
      </p>
    </div>
  );
}
