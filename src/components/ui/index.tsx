'use client';

// Shared UI primitives — the single source for cards, buttons, spinners, empty
// states, and skeletons. The app had a design system in globals.css that got
// abandoned (three card recipes, three spinner styles, near-dead .btn/.input);
// these consolidate them so every screen is cut from the same cloth. All brand
// color comes from the `primary` token (now the real #4338ff), never hardcoded.

import { cn } from '@/lib/utils';

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
