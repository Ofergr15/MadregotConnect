import { cn } from '@/lib/utils';

const R = 22;
const CIRCUMFERENCE = 2 * Math.PI * R; // 138.23

/**
 * The setup percentage as a 52px ring. Shared by the card on the profile landing
 * and the header of the checklist screen, so the same number never renders two
 * slightly different ways.
 *
 * `-rotate-90` starts the arc at 12 o'clock. It is NOT mirrored in RTL — a circle
 * has no reading direction, and flipping the sweep in Hebrew only looks like a
 * bug.
 */
export function ProgressRing({
  pct,
  className,
  label,
}: {
  pct: number;
  className?: string;
  /** Overrides the percentage in the middle. The nudge card shows "2/5" there
   *  instead, so the ring and the header pill say the same number — a card
   *  reading 40% beside a pill reading 2/5 makes the member do the arithmetic. */
  label?: string;
}) {
  return (
    <span className={cn('relative h-[52px] w-[52px] shrink-0', className)}>
      <svg viewBox="0 0 52 52" className="h-[52px] w-[52px] -rotate-90">
        <circle cx="26" cy="26" r={R} fill="none" strokeWidth="6" className="stroke-page" />
        <circle
          cx="26"
          cy="26"
          r={R}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          className="stroke-brand-600 transition-[stroke-dashoffset] duration-500"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, pct)) / 100)}
        />
      </svg>
      {/* dir="ltr" on the label: a fraction is a Latin-ordered run, and inside an
          RTL line "2/5" is the one shape that survives — see the bidi note in
          lib/email/template.ts for what happens when it doesn't. */}
      <span
        dir="ltr"
        className="absolute inset-0 flex items-center justify-center text-sm font-bold text-brand-600 tabular-nums"
      >
        {label ?? `${pct}%`}
      </span>
    </span>
  );
}
