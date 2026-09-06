import { cn } from '@/lib/utils';
import { stepPaceTokens, type PacedStep } from '@/lib/garmin/pace';

/**
 * A step's pace in the club's notation — ❶ plain, (❷) single brackets,
 * ((❸)) double brackets — as ONE unbreakable inline unit that sits at the end of
 * the step's row, opposite the distance.
 *
 * The layout is deliberate. The planner's week cards used to push a three-group
 * pace onto a second line at 10px in `ink-400`, the faintest text in the card,
 * which turned the single number a runner actually needs into a footnote. Here
 * the leading group carries the same size and weight as the distance it answers
 * ("8 ק״מ … 4:30") and only ❷/❸ stay secondary, so the row reads as one fact
 * instead of two. `whitespace-nowrap` keeps the trio together: in the 7-column
 * desktop week the whole unit wraps to its own line rather than splitting a
 * pace across two.
 */

const SIZES = {
  /** Week cards and other dense grids. */
  xs: { lead: 'text-[11px]', other: 'text-[10px]', gap: 'gap-1' },
  /** Detail sheets, where the pace is the reason the sheet is open. */
  sm: { lead: 'text-sm', other: 'text-xs', gap: 'gap-1' },
} as const;

export function PaceTokens({
  tokens,
  highlight,
  size = 'xs',
  className,
}: {
  tokens: [string, string, string];
  /**
   * 0-based group to call out in brand blue — the viewer's own squad. Omit it
   * (the coach's planner, where all three groups matter equally) and ❶ simply
   * gets the neutral prominent treatment instead.
   */
  highlight?: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (!tokens.some(Boolean)) return null;
  const s = SIZES[size];

  // A plan can carry a pace for ❶ only while the viewer sits in ❸. Highlighting
  // an empty token would leave the row with nothing prominent on it, so fall
  // back to the first group that actually has a pace.
  const highlighted = highlight !== undefined && !!tokens[highlight];
  const lead = highlighted ? highlight! : tokens.findIndex(Boolean);

  return (
    <span
      dir="ltr"
      className={cn('inline-flex items-baseline whitespace-nowrap tabular-nums', s.gap, className)}
    >
      {tokens.map((tok, g) => {
        if (!tok) return null;
        const text = g === 0 ? tok : g === 1 ? `(${tok})` : `((${tok}))`;
        return (
          <span
            key={g}
            className={cn(
              g === lead
                ? cn(s.lead, highlighted ? 'font-bold text-brand-600' : 'font-semibold text-ink-700')
                : cn(s.other, 'text-ink-400'),
            )}
          >
            {text}
          </span>
        );
      })}
    </span>
  );
}

/** `PaceTokens` for a parsed workout step, whose ❶ pace lives on the step itself. */
export function StepPace({
  step,
  highlight,
  size,
  className,
}: {
  step: PacedStep;
  highlight?: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <PaceTokens tokens={stepPaceTokens(step)} highlight={highlight} size={size} className={className} />
  );
}
