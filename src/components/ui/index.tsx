'use client';

// Shared UI primitives — the single source for cards, buttons, spinners, empty
// states, and skeletons. The app had a design system in globals.css that got
// abandoned (three card recipes, three spinner styles, near-dead .btn/.input);
// these consolidate them so every screen is cut from the same cloth. All brand
// color comes from the `primary` token (now the real #4338ff), never hardcoded.

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet } from './Sheet';

export { Sheet } from './Sheet';
export { InsetSection, InsetRow } from './InsetList';
export { BackNav } from './BackNav';

// ── Spinner ──────────────────────────────────────────────────────────────────
// One brand-colored ring, replacing the mix of border-b-2 half-circles and
// ad-hoc rings across the app.
export function Spinner({ size = 24, className }: { size?: number; className?: string }) {
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
        borderColor: 'rgba(67,56,255,0.25)',
        borderTopColor: '#4338ff',
      }}
    />
  );
}

// A full-area centered spinner for page/section loading.
export function LoadingBlock({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <div className={cn('flex items-center justify-center py-16', className)}>
      <Spinner size={size} />
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
// variant: 'solid' (default) | 'muted' | 'plain'. Radius 2xl, consistent border
// and padding — replaces the xl/2xl + /30 /50 opacity drift.
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
  const base = 'rounded-2xl border';
  const variants = {
    solid: 'bg-slate-800/60 border-slate-700/60',
    muted: 'bg-slate-800/30 border-slate-700/30',
    plain: 'bg-slate-800 border-slate-700',
  };
  return (
    <div className={cn(base, variants[variant], 'p-4 sm:p-5', className)} {...rest}>
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
  const base =
    'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-colors active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none';
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-primary-600 hover:bg-primary-700 text-white',
    secondary: 'bg-slate-700 hover:bg-slate-600 text-white',
    ghost: 'text-slate-300 hover:text-white hover:bg-slate-800',
    danger: 'bg-red-600 hover:bg-red-500 text-white',
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
        <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center mb-4">
          <Icon className="h-6 w-6 text-slate-400" />
        </div>
      )}
      <p className="text-base font-bold text-white">{title}</p>
      {description && <p className="mt-1.5 text-sm text-slate-400 max-w-[280px]">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-slate-700/40', className)} />;
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
    <div className={cn('flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-800/50 p-3.5', className)}>
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
  activeColor = 'bg-primary-600',
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
  const onPos = size === 'sm' ? 'start-[22px]' : 'start-6';
  const offPos = size === 'sm' ? 'start-0.5' : 'start-1';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative rounded-full transition-colors shrink-0 disabled:opacity-50',
        track,
        checked ? activeColor : 'bg-slate-600',
        className,
      )}
    >
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin text-white absolute inset-0 m-auto" />
        : <span className={cn('absolute rounded-full bg-white transition-all', thumb, checked ? onPos : offPos)} />}
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
      {description && <p className="text-sm text-slate-400 text-center px-2 pb-4">{description}</p>}
      <div className="space-y-2">
        <button
          onClick={() => { onOpenChange(false); onConfirm(); }}
          className={cn(
            'w-full min-h-[48px] rounded-xl font-bold text-base transition-colors active:scale-[0.98]',
            danger ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-primary-600 hover:bg-primary-700 text-white'
          )}
        >
          {confirmLabel}
        </button>
        <button
          onClick={() => onOpenChange(false)}
          className="w-full min-h-[48px] rounded-xl font-semibold text-base bg-slate-700 hover:bg-slate-600 text-white transition-colors active:scale-[0.98]"
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
      <span className={cn('text-3xl font-black tabular-nums text-primary-400 leading-none', valueClassName)}>{value}</span>
      <span className="mt-1.5 text-xs font-medium text-slate-400">{label}</span>
    </div>
  );
}

// ── SegmentedControl ──────────────────────────────────────────────────────────
// iOS-style segmented control: a track with equal segments and a highlighted
// selected pill. Replaces the ad-hoc `flex bg-slate-800 rounded-xl p-1` toggles.
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
    <div className={cn('flex gap-0.5 rounded-xl bg-slate-800 p-1 border border-slate-700', className)}>
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value !== null && opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => { if (!active) { try { navigator.vibrate?.(6); } catch { /* no-op */ } onChange(opt.value); } }}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition-colors min-h-[40px]',
              active ? cn(opt.activeBg || 'bg-primary-600', 'text-white shadow-sm') : 'text-slate-400 hover:text-white'
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
