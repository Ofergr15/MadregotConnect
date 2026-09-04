'use client';

// Shared UI primitives — the single source for cards, buttons, spinners, empty
// states, and skeletons. The app had a design system in globals.css that got
// abandoned (three card recipes, three spinner styles, near-dead .btn/.input);
// these consolidate them so every screen is cut from the same cloth. All brand
// color comes from the `primary` token (now the real #1525FF), never hardcoded.

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet } from './Sheet';

export { Sheet } from './Sheet';
export { InsetSection, InsetRow } from './InsetList';
export { BackNav } from './BackNav';

// ── Spinner ──────────────────────────────────────────────────────────────────
// One brand-colored ring, replacing the mix of border-b-2 half-circles and
// ad-hoc rings across the app.
//
// `tone="ink"` is for the app-open path only — the auth gate and the landing
// check that sit between the (monochrome) AppSplash and the first real screen.
// Those are the same moment as the splash, and a blue ring appearing a beat after
// a black-and-white splash is a colour arriving from nowhere. Everywhere else
// keeps the brand ring, so this stays an opt-in and not a repaint of every
// loading state in the app.
//
// It has to be a prop rather than a className: the colours are inline styles
// (they're derived from `size`), and inline styles beat any utility class, so
// `className="border-ink-900"` on this component silently does nothing.
type SpinnerTone = 'brand' | 'ink';

const SPINNER_TONES: Record<SpinnerTone, { track: string; head: string }> = {
  brand: { track: 'rgba(21,37,255,0.22)', head: '#1525FF' },
  ink: { track: 'rgba(29,30,38,0.18)', head: '#1D1E26' },
};

export function Spinner({
  size = 24,
  className,
  tone = 'brand',
}: {
  size?: number;
  className?: string;
  tone?: SpinnerTone;
}) {
  const { track, head } = SPINNER_TONES[tone];
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block rounded-full animate-spin', className)}
      style={{
        width: size,
        height: size,
        borderWidth: Math.max(2, Math.round(size / 12)),
        borderStyle: 'solid',
        borderColor: track,
        borderTopColor: head,
      }}
    />
  );
}

// A full-area centered spinner for page/section loading.
export function LoadingBlock({
  className,
  size = 28,
  tone,
}: {
  className?: string;
  size?: number;
  tone?: SpinnerTone;
}) {
  return (
    <div className={cn('flex items-center justify-center py-16', className)}>
      <Spinner size={size} tone={tone} />
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
// variant: 'solid' (default) | 'muted' | 'plain'. The designer's card is a plain
// white 25px surface with no border at all — the page grey behind it is what
// separates it — so all three variants collapse to one shape; `muted` keeps a
// hint of recession via opacity.
export function Card({
  variant = 'solid',
  className,
  children,
  ...rest
}: {
  variant?: 'solid' | 'muted' | 'plain';
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const variants = { solid: 'bg-card', muted: 'bg-card/70', plain: 'bg-card' };
  return (
    <div className={cn('rounded-card', variants[variant], 'p-4 sm:p-5', className)} {...rest}>
      {children}
    </div>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // The frames' buttons are 50px pills at weight 700.
  const base = 'inline-flex items-center justify-center gap-2 rounded-pill font-bold transition-colors active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none';
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-brand-600 hover:bg-brand-700 text-white',
    // The frames' secondary is an outline pill, not a grey fill.
    secondary: 'bg-card border border-brand-600 text-brand-600 hover:bg-brand-600/5',
    ghost: 'text-ink-500 hover:text-ink-900 hover:bg-card',
    danger: 'bg-accent-red hover:opacity-90 text-white',
  };
  const sizes: Record<ButtonSize, string> = {
    sm: 'text-xs px-3 py-2 min-h-[36px]',
    md: 'text-sm px-4 py-2.5 min-h-[44px]',
    lg: 'text-base px-5 py-3 min-h-[48px]',
  };
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {children}
    </button>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────
// One consistent empty state — icon + title + optional description + optional
// action — replacing the bare centered gray strings scattered around.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-12 px-6', className)}>
      {Icon && (
        <div className="w-14 h-14 flex items-center justify-center mb-4 rounded-card bg-card">
          <Icon className="h-6 w-6 text-ink-400" />
        </div>
      )}
      <p className="text-base font-bold text-ink-700">{title}</p>
      {description && <p className="mt-1.5 text-sm max-w-[280px] text-ink-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-ink-300/50', className)} />;
}

// A card-shaped skeleton for list/stat loading.
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <Card variant="muted" className={cn('space-y-3', className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </Card>
  );
}

// One list-row skeleton: avatar/glyph tile + two text lines (matches the app's
// roster / feedback / inbox / volume rows). RTL-agnostic.
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 p-3.5 rounded-card bg-card', className)}>
      <Skeleton className="h-9 w-9 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

// A stack of row skeletons for list screens. Count defaults to 4.
export function SkeletonList({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-2.5', className)}>
      {Array.from({ length: count }, (_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}

// ── Switch ────────────────────────────────────────────────────────────────────
// iOS-style toggle — was hand-copied identically (bar + sliding thumb) across
// NotificationPrefs/ReminderConfig/MaintenanceToggle at one size/color and
// BadgeManager/StoreManager/ChallengeManager/AcademySettings at another;
// promoted here so neither variant gets re-copied again.
export function Switch({
  checked,
  onChange,
  disabled,
  loading,
  size = 'md',
  activeColor = 'bg-brand-600',
  ariaLabel,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Shows a spinner in place of the thumb while an async save is in flight. */
  loading?: boolean;
  /** 'sm' matches the old BadgeManager/StoreManager/ChallengeManager/AcademySettings size; 'md' matches NotificationPrefs/ReminderConfig/MaintenanceToggle. */
  size?: 'sm' | 'md';
  /** Track color when checked — most callers use the default; NotificationPrefs/MaintenanceToggle used green instead. */
  activeColor?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const track = size === 'sm' ? 'w-11 h-6' : 'w-12 h-7';
  const thumb = size === 'sm' ? 'top-0.5 h-5 w-5' : 'top-1 h-5 w-5';
  // Rest position (unchecked) is a fixed inset — sliding "on" is a transform
  // on top of that, not a second inset value. Both sizes happen to have the
  // same 20px on/off delta (sm: 2px→22px, md: 4px→24px), so one translate-x
  // covers both. transform is GPU-composited and direction-explicit; the
  // previous version animated the logical `start` inset (effectively
  // left/right under RTL) via `transition-all`, which is layout-triggering
  // and — combined with RTL logical properties, a newer/less battle-tested
  // Safari feature — is a plausible source of the "flips then snaps back"
  // glitches reported on real iOS despite zero corresponding network
  // activity (i.e. a paint glitch, not a data bug).
  const restPos = size === 'sm' ? 'start-0.5' : 'start-1';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative rounded-full transition-colors shrink-0 disabled:opacity-50 transform-gpu',
        track,
        checked ? activeColor : 'bg-ink-300',
        className,
      )}
    >
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin text-white absolute inset-0 m-auto" />
        : <span
            className={cn(
              'absolute rounded-full bg-white transition-transform transform-gpu',
              thumb,
              restPos,
              checked && 'translate-x-5 rtl:-translate-x-5',
            )}
          />}
    </button>
  );
}

// ── ConfirmSheet ──────────────────────────────────────────────────────────────
// Native destructive-confirmation pattern: one full-width verb row (red when
// `danger`) + a plain Cancel row below it, in a bottom sheet — replacing every
// `window.confirm()` in the app (no native iOS equivalent of a browser confirm
// dialog exists, and it can't be styled/localized/RTL-fixed).
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      {description && <p className="text-sm text-center px-2 pb-4 text-ink-400">{description}</p>}
      <div className="space-y-2">
        <button
          onClick={() => { onOpenChange(false); onConfirm(); }}
          className={cn(
            'w-full min-h-[48px] rounded-pill font-bold text-base text-white transition-colors active:scale-[0.98]',
            danger ? 'bg-accent-red hover:opacity-90' : 'bg-brand-600 hover:bg-brand-700',
          )}
        >
          {confirmLabel}
        </button>
        <button
          onClick={() => onOpenChange(false)}
          className={cn(
            'w-full min-h-[48px] rounded-pill bg-page text-ink-700 font-semibold text-base transition-colors hover:bg-page/70 active:scale-[0.98]',
          )}
        >
          {cancelLabel}
        </button>
      </div>
    </Sheet>
  );
}

// ── BigStat ──────────────────────────────────────────────────────────────────
// The hero-number pattern already hand-copied across StatTiles/MomentumCard
// (text-3xl font-black tabular-nums) — promoted here so every future stat
// surface (Statistics screen, leaderboards, analytics) inherits one look.
export function BigStat({
  value,
  label,
  className,
  valueClassName,
}: {
  value: React.ReactNode;
  label: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <span className={cn('text-3xl font-black tabular-nums leading-none text-brand-600', valueClassName)}>{value}</span>
      <span className="mt-1.5 text-xs font-medium text-ink-400">{label}</span>
    </div>
  );
}

// ── SegmentedControl ──────────────────────────────────────────────────────────
// iOS-style segmented control: a track with equal segments and a highlighted
// selected pill. Replaces the ad-hoc `flex bg-… rounded-xl p-1` toggles.
// RTL-safe (uses flex order, no absolute thumb math). Generic over the value.
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  // `null` means "nothing selected yet" — distinct from defaulting to one of
  // the real options, which would make that option look pre-selected while
  // tapping it does nothing (its onClick short-circuits on already-active).
  value: T | null;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ComponentType<{ className?: string }>; activeBg?: string }>;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-0.5 p-1 rounded-pill bg-card', className)}>
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value !== null && opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => { if (!active) { try { navigator.vibrate?.(6); } catch { /* no-op */ } onChange(opt.value); } }}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-pill px-2 py-2 text-sm font-bold transition-colors min-h-[40px]',
              active
                ? cn(opt.activeBg || 'bg-brand-600', 'text-white shadow-sm')
                : 'text-ink-400 hover:text-ink-700',
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
