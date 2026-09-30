'use client';

import { cn } from '@/lib/utils';
import type { ShareBrand } from '@/lib/feed/share-image';

/**
 * THE PIECES BOTH SHARE EDITORS ARE BUILT FROM: the workout's
 * (`WorkoutShareEditor.tsx`) and the week's (`WeekShareEditor.tsx`). The two
 * editors are one flow, card first, parts labelled on it, so what a toggle or a
 * label looks like is decided here once.
 */

export const BRAND_SRC: Record<ShareBrand, string> = {
  badge: '/images/logo-white.png',
  wordmark: '/images/wordmark-white.png',
  stairs: '/images/stairs-white.png',
};

/** The labels over the card: one line of 10px type in a pill. */
export const LABEL_H = 20;
/** How far, in card pixels, an outline stands off the part it rings. */
export const OUTLINE_PAD = 14;
export function labelWidth(text: string): number {
  return Math.round(text.length * 6.4 + 18);
}

export function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="mb-2 flex min-h-[44px] w-full items-center justify-between rounded-xl bg-white/[0.08] px-3 text-sm font-bold text-white"
    >
      {label}
      <span className={cn('relative h-6 w-10 rounded-full transition-colors', on ? 'bg-[#FF5315]' : 'bg-white/25')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'end-0.5' : 'start-0.5')} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ items, value, onChange }: {
  items: Array<[T, string]>; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="mb-2 flex rounded-full bg-white/[0.08] p-0.5">
      {items.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={cn(
            'min-h-[40px] flex-1 rounded-full px-3 text-xs font-bold transition-colors',
            value === k ? 'bg-white text-ink-900' : 'text-white/60',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
