'use client';

/**
 * The accuracy ring as it appears under a run in a list.
 *
 * Deliberately silent on anything but a real grade: an unplanned easy run gets
 * nothing here, not an empty ring and not "outside the plan". Most runs in a feed
 * are exactly that, and a row of grey dashes would train everyone to ignore the
 * one card that does have something to say.
 *
 * Whether it renders at all is the caller's call — `useExecutionSummary(id, mine
 * || staff)` — because only the caller knows whose card this is.
 */

import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DIRECTION_COLOR, type ExecutionSummary } from '@/lib/plan-execution/verdict';
import { ExecutionRing } from './ExecutionRing';

export function ExecutionBadge({
  summary,
  className,
  showChevron = false,
}: {
  summary: ExecutionSummary | null | undefined;
  className?: string;
  /** Set when the badge sits inside a tap target that opens the full breakdown. */
  showChevron?: boolean;
}) {
  const t = useTranslations('execution');
  if (!summary || summary.status !== 'graded' || summary.score == null) return null;

  const color = DIRECTION_COLOR[summary.direction];

  return (
    <div
      className={cn(
        'mb-3 flex items-center gap-3 rounded-2xl px-3 py-2',
        className,
      )}
      // A tint of the verdict's own colour, so the card reads as "too fast" at a
      // glance from a scroll — the number is for whoever stops.
      style={{ background: `${color}0F` }}
    >
      {/* The label is not optional: `role="img"` prunes the ring's own digits from
          the accessibility tree, so without it the one number this badge exists
          for is announced as nothing at all. */}
      <ExecutionRing
        score={summary.score}
        direction={summary.direction}
        size={44}
        ariaLabel={t('ringLabel', { score: summary.score })}
      />
      <div className="min-w-0 flex-1">
        <p className="text-3xs font-bold uppercase tracking-wide text-ink-400">{t('feedLabel')}</p>
        <p className="truncate text-sm font-bold leading-tight" style={{ color }}>
          {t(`dir_${summary.direction}` as 'dir_on_target')}
        </p>
        {summary.workoutName && (
          <p className="truncate text-3xs text-ink-400">{summary.workoutName}</p>
        )}
      </div>
      {showChevron && <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 rtl:rotate-180" />}
    </div>
  );
}
