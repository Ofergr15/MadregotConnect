'use client';

import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { BarSegment } from '@/lib/academy/book-steps';

// ── The workout book v3's shared pieces ──────────────────────────────────────────────────
//
// The mockup (workout-book-v3.html) is one visual system across seven phones, so its sizes
// live here once: the 103px top bar, the 56px buttons, the 22px cards, the profile bar.
// Colours are the mockup's where it names one the app has (brand #1525FF), and the app's
// ink ramp for secondary text — the mockup's #73747F is 4.4:1 on its own page tint, under
// AA, and the app has already paid for a grey that clears it (ink-400).

export const BOOK_PAGE = '#F4F4F8';

/** `bdi` in one place: every number on these screens is LTR inside RTL text. */
export function N({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi dir="ltr" className={className}>{children}</bdi>;
}

/** Tag map for `t.rich`: `<n>4:05</n>` isolated, `<b>…</b>` bold. */
export const RICH = {
  n: (chunks: ReactNode) => <bdi dir="ltr" className="font-black text-ink-900">{chunks}</bdi>,
  m: (chunks: ReactNode) => <bdi dir="ltr">{chunks}</bdi>,
  b: (chunks: ReactNode) => <b className="font-extrabold text-ink-900">{chunks}</b>,
  bdi: (chunks: ReactNode) => <bdi>{chunks}</bdi>,
};

const TONE_COLOR = { e: '#8FD3AA', t: '#F4B556', f: '#EF5B4C', r: '#E1E2E9' } as const;
const TONE_HEIGHT = { e: 0.42, t: 0.7, f: 1, r: 0.2 } as const;
export const TONE_STRIPE = TONE_COLOR;

/** The session drawn as blocks: width = time, height = effort. */
export function ProfileBar({ segments, size = 'md', height: forced, className }: {
  segments: BarSegment[];
  size?: 'sm' | 'md' | 'lg';
  /** Overrides the size's height, for the week card's 20px full-width bar. */
  height?: number;
  className?: string;
}) {
  const height = forced ?? (size === 'sm' ? 20 : size === 'lg' ? 44 : 34);
  return (
    <div
      aria-hidden
      className={cn('flex items-end', size === 'sm' ? 'w-24 shrink-0 gap-0.5' : 'gap-[3px]', className)}
      style={{ height }}
    >
      {segments.map((s, i) => (
        <i
          key={i}
          className={cn('block', size === 'sm' ? 'rounded-[3px]' : 'rounded-t-[6px] rounded-b-[3px]')}
          style={{ flex: s.weight, height: `${TONE_HEIGHT[s.tone] * 100}%`, background: TONE_COLOR[s.tone], minWidth: 2 }}
        />
      ))}
    </div>
  );
}

/**
 * A full-screen step of the flow: the 103px top bar (status-bar inset + 56px), a body that
 * does not scroll unless it has to, and a footer for the one primary action.
 *
 * Full screen rather than inside the app shell because the mockup draws these phones
 * without a tab bar: choosing and sending a workout is a task with a start and an end, and
 * a tab bar under it is four ways to abandon it half-sent.
 */
export function FlowScreen({ title, leading, trailing, children, footer, className }: {
  title: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" dir="rtl">
      <header
        className="book-top flex flex-none items-end justify-between border-b border-[#E9E9EF] bg-white/90 px-[18px] pb-[11px] backdrop-blur"
        style={{ paddingTop: 'env(safe-area-inset-top)', minHeight: 'calc(56px + env(safe-area-inset-top))' }}
      >
        <div className="flex min-w-[64px] justify-start">{leading}</div>
        <h1 className="truncate text-[17px] font-extrabold text-ink-900">{title}</h1>
        <div className="flex min-w-[64px] justify-end">{trailing}</div>
      </header>
      <main className={cn('flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] pt-[18px] pb-3 [&>*]:shrink-0', className)}>
        {children}
      </main>
      {footer && (
        <footer
          className="book-foot flex flex-none flex-col gap-2.5 px-[18px] pt-2"
          style={{ paddingBottom: 'max(30px, env(safe-area-inset-bottom))' }}
        >
          {footer}
        </footer>
      )}
    </div>
  );
}

/** The overlay that hosts a flow. Locks the page behind it while open. */
export function FlowOverlay({ children, label }: { children: ReactNode; label: string }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[290] flex flex-col" style={{ background: BOOK_PAGE }}>
      {children}
    </div>
  );
}

/** The top bar's text buttons: `‹ השבוע`, `ביטול`, `סיום`. 44px tall. */
export function BarButton({ children, onClick, strong, disabled, label }: {
  children: ReactNode;
  onClick?: () => void;
  strong?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        '-my-2.5 flex min-h-[44px] min-w-[44px] items-center text-[16px] text-brand-600 disabled:opacity-40',
        strong ? 'font-extrabold' : 'font-semibold',
      )}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({ children, onClick, disabled, secondary, className, busy }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  secondary?: boolean;
  className?: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        'flex h-14 items-center justify-center gap-2 rounded-2xl text-[17px] font-extrabold transition-transform active:scale-[0.99] disabled:opacity-50',
        secondary ? 'bg-white text-brand-600 shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]' : 'bg-brand-600 text-white',
        className,
      )}
    >
      {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : children}
    </button>
  );
}

export const CARD = 'rounded-[22px] bg-white shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]';

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="-mb-1.5 mt-0.5 px-1 text-sm font-extrabold text-ink-400">{children}</h2>;
}

export function Stripe({ tone }: { tone: keyof typeof TONE_COLOR }) {
  return <span aria-hidden className="w-1.5 shrink-0 self-stretch rounded" style={{ background: TONE_COLOR[tone] }} />;
}

// ── Number formatting (numbers only — the words are in messages/*.json) ─────────────────

/** `2000` → `2`, `1500` → `1.5`, `10240` → `10.2`. */
export function kmText(metres: number): string {
  const km = Math.round(metres / 100) / 10;
  return Number.isInteger(km) ? String(km) : km.toFixed(1);
}

/** `245` → `4:05`. */
export function clockText(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Hours:minutes of a week total — `2:05`. */
export function hoursText(seconds: number): string {
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}
