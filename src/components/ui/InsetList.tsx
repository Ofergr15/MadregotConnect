'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

// iOS Settings-style inset-grouped list (Phase 6 / panel 18). A rounded grouped
// section with hairline dividers, colored glyph tiles, optional chevron/value/
// toggle, and an optional uppercase section header. RTL-safe: the chevron points
// inline-end (ChevronLeft, which visually points to the row's trailing edge in
// RTL). Purely presentational — logic stays in the caller.

export function InsetSection({ header, children, className }: { header?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-5', className)}>
      {header && (
        <p className="px-4 mb-1.5 text-2xs font-bold uppercase tracking-wider text-slate-500">{header}</p>
      )}
      <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 overflow-hidden divide-y divide-slate-700/50">
        {children}
      </div>
    </div>
  );
}

interface RowProps {
  icon?: React.ComponentType<{ className?: string }>;
  iconBg?: string;      // tailwind bg for the glyph tile, e.g. 'bg-primary-600'
  label: string;
  sublabel?: string;
  value?: string;       // trailing muted value (e.g. "08:00")
  href?: string;        // renders as a Link with a chevron
  onClick?: () => void; // renders as a button with a chevron
  trailing?: React.ReactNode; // custom trailing (e.g. a toggle) — suppresses chevron
  danger?: boolean;
}

// One row. If href/onClick given → navigable (chevron). If `trailing` given
// (e.g. a toggle) → no chevron. Otherwise a static info row.
export function InsetRow({ icon: Icon, iconBg = 'bg-slate-600', label, sublabel, value, href, onClick, trailing, danger }: RowProps) {
  const interactive = !!href || !!onClick;
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
      {Icon && (
        <span className={cn('shrink-0 w-7 h-7 rounded-md flex items-center justify-center', iconBg)}>
          <Icon className="h-4 w-4 text-white" />
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className={cn('block text-[15px] font-medium truncate', danger ? 'text-red-400' : 'text-white')} dir="auto">{label}</span>
        {sublabel && <span className="block text-xs text-slate-400 truncate" dir="auto">{sublabel}</span>}
      </span>
      {value && <span className="text-[15px] text-slate-400 shrink-0 tabular-nums">{value}</span>}
      {trailing ? trailing : interactive && <ChevronLeft className="h-4 w-4 text-slate-500 shrink-0" />}
    </div>
  );

  if (href) return <Link href={href} onClick={onClick} className="block active:bg-slate-700/40 transition-colors">{inner}</Link>;
  if (onClick) return <button onClick={onClick} className="w-full text-start active:bg-slate-700/40 transition-colors">{inner}</button>;
  return inner;
}
