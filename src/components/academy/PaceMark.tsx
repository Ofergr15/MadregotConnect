'use client';

import { cn } from '@/lib/utils';
import {
  PACE_INK, PACE_TINT, fmtPace, pacePillText, type PaceKind, type PaceVerdict,
} from '@/lib/academy/pace-verdict';

// The pace rule, drawn. Two shapes — an inline pace ("▲4:06") and a delta pill
// ("▼ 9 שנ׳ לאט") — and nothing else on the trainee's screens colours a pace by
// hand. The decision is lib/academy/pace-verdict.ts; this file only paints it.
//
// The arrows are SVG paths, never ▲/▼ glyphs: a glyph is read aloud as "black
// up-pointing triangle", inherits whatever the font does with it, and next to
// Hebrew it is a bidi-neutral that can end up on the wrong side of the number.

export function ArrowUp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={cn('shrink-0', className)} aria-hidden>
      <path d="M6 1.5 L10.5 7.5 H7.6 V10.5 H4.4 V7.5 H1.5 Z" fill="currentColor" />
    </svg>
  );
}

export function ArrowDown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={cn('shrink-0', className)} aria-hidden>
      <path d="M6 10.5 L1.5 4.5 H4.4 V1.5 H7.6 V4.5 H10.5 Z" fill="currentColor" />
    </svg>
  );
}

export function CheckMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={cn('shrink-0', className)} aria-hidden>
      <path d="M2 6.4 L4.8 9 L10 3.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SPOKEN: Record<PaceKind, string> = { on: 'בתוכנית', fast: 'מהר מהתוכנית', slow: 'איטי מהתוכנית' };

/**
 * A pace inline in a line of Hebrew: green when on plan, green ▲ when faster,
 * orange ▼ when slower, ink when there was no target to judge it by. Isolated
 * LTR, so "5:31" is never reordered by the sentence around it.
 */
export function PaceText({
  pace, verdict, className,
}: {
  pace: number;
  verdict: PaceVerdict | null | undefined;
  className?: string;
}) {
  const kind = verdict?.kind;
  return (
    <bdi
      dir="ltr"
      className={cn('inline-flex items-center gap-0.5 font-black tabular-nums whitespace-nowrap', !kind && 'text-ink-500 font-bold', className)}
      style={kind ? { color: PACE_INK[kind] } : undefined}
      aria-label={kind ? `${fmtPace(pace)} ${SPOKEN[kind]}` : undefined}
    >
      {kind === 'fast' && <ArrowUp className="h-[11px] w-[11px]" />}
      {kind === 'slow' && <ArrowDown className="h-[11px] w-[11px]" />}
      {fmtPace(pace)}
    </bdi>
  );
}

/** The delta pill: symbol + words + colour together. `look` is the pace rule's three looks. */
export function DeltaPill({
  look, text, className,
}: {
  look: PaceKind;
  text: string;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-2xs font-extrabold whitespace-nowrap', className)}
      style={{ background: PACE_TINT[look], color: PACE_INK[look] }}
    >
      {look === 'on' ? <CheckMark className="h-3 w-3" /> : look === 'fast' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {text}
    </span>
  );
}

/** A pace verdict as a pill. */
export function PacePill({ verdict, short, className }: { verdict: PaceVerdict; short?: boolean; className?: string }) {
  return <DeltaPill look={verdict.kind} text={pacePillText(verdict, short)} className={className} />;
}
