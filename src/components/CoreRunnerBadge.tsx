import { cn } from '@/lib/utils';
import { CORE_RUNNER_LABEL, CORE_RUNNER_MARK } from '@/lib/core-runner';

/**
 * The 🌰 mark for a member of the גרעין. Ofer picked the emoji himself — it is
 * literally a גרעין, which is why it beats the abstract ⭐/💎 alternatives.
 *
 * TWO SHAPES, one component, because it appears at two very different densities:
 *
 *   'mark'  — the emoji alone, next to a name in a list or a header. No text: at
 *             13px a "רץ גרעין" chip next to every name is longer than most names.
 *   'chip'  — mark + label, for a profile or a detail screen, where there is room
 *             to say what the emoji means. A badge nobody can decode is decoration.
 *
 * Always rendered from isCoreRunner() (src/lib/core-runner.ts), never from a role
 * comparison — a coach in the גרעין must get the badge too.
 *
 * NOT a <span> with an aria-hidden emoji: the mark IS the information here, so it
 * carries a title/aria-label. A screen reader announcing "🌰" alone is useless.
 */
export default function CoreRunnerBadge({
  variant = 'mark',
  className,
}: {
  variant?: 'mark' | 'chip';
  className?: string;
}) {
  if (variant === 'mark') {
    return (
      <span
        role="img"
        aria-label={CORE_RUNNER_LABEL}
        title={CORE_RUNNER_LABEL}
        // leading-none: the emoji's own line box is taller than the Latin/Hebrew
        // text it sits beside, and without this it pushes the whole row down.
        className={cn('shrink-0 leading-none select-none', className)}
      >
        {CORE_RUNNER_MARK}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 shrink-0 whitespace-nowrap rounded-md border px-2 py-0.5 text-3xs font-bold',
        // Neutral ink rather than one of the three band colours: those mean
        // "which דבוקה", and a fourth saturated hue next to them would read as a
        // fourth squad. The emoji supplies the colour.
        'bg-page text-ink-700 border-ink-300/50',
        className,
      )}
    >
      <span role="img" aria-hidden="true" className="leading-none">{CORE_RUNNER_MARK}</span>
      {CORE_RUNNER_LABEL}
    </span>
  );
}
