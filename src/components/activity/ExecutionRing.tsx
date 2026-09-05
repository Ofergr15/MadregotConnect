'use client';

/**
 * The accuracy ring — "how much of this workout did you actually run".
 *
 * One component for every surface: a 44px ring under a feed card, a 112px ring at
 * the top of a run's detail screen. The fill colour is the DIRECTION, not the
 * score, because two runs can score the same 62% by being too fast and too slow,
 * and those are opposite things to tell a runner.
 *
 * `direction="ltr"` on the <svg> is not cosmetic: the document is RTL, SVG
 * inherits it, and an inherited rtl direction flips `text-anchor`, which silently
 * moves the centred percentage off the middle of the ring.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  DIRECTION_COLOR,
  NEUTRAL_RING_COLOR,
  type ExecutionDirection,
} from '@/lib/plan-execution/verdict';

const TRACK_COLOR = '#E4E4E4';

export function ExecutionRing({
  score,
  direction,
  size = 44,
  stroke,
  /** Rendered under the number inside the ring — only worth it at lg. */
  caption,
  className,
  ariaLabel,
}: {
  /** 0..100, or null for a run there was nothing to grade against. */
  score: number | null;
  direction: ExecutionDirection;
  size?: number;
  stroke?: number;
  caption?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const width = stroke ?? Math.max(3, Math.round(size * 0.1));
  const radius = (size - width) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = score == null ? NEUTRAL_RING_COLOR : DIRECTION_COLOR[direction];

  // Draws itself in on mount: the arc IS the number, so animating it makes the
  // score legible as a proportion before anyone reads the digits.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const offset = circumference * (1 - (drawn ? pct : 0));
  const fontSize = Math.round(size * (score != null && score === 100 ? 0.27 : 0.3));

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} direction="ltr" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={TRACK_COLOR}
          strokeWidth={width}
          // A run with nothing to grade gets a dashed track and no fill — visibly
          // "no answer" rather than a real 0%.
          strokeDasharray={score == null ? '3 5' : undefined}
        />
        {score != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        {score == null ? (
          <span className="font-bold text-ink-400" style={{ fontSize }}>—</span>
        ) : (
          <span className="font-bold tabular-nums" style={{ fontSize, color }}>
            {score}
            <span style={{ fontSize: Math.round(fontSize * 0.5) }}>%</span>
          </span>
        )}
        {caption && (
          <span
            className="mt-0.5 font-bold uppercase tracking-wide text-ink-400"
            style={{ fontSize: Math.max(8, Math.round(size * 0.09)) }}
          >
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
