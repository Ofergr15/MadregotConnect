'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

// iOS Settings-style inset-grouped list (Phase 6 / panel 18). A rounded grouped
// section with hairline dividers, colored glyph tiles, optional chevron/value/
// toggle, and an optional uppercase section header. RTL-safe: the chevron points
// inline-end (ChevronLeft, which visually points to the row's trailing edge in
// RTL). Purely presentational — logic stays in the caller.
//
// It used to carry a dark/light `variant` (plus an InsetTheme context to set it
// once per screen) while the app ran two palettes side by side. Every screen is
// on the designer's light system now, so there's one look: a white 25px card on
// the page grey, page-grey hairlines, ink text.

export function InsetSection({ header, children, className }: { header?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-5', className)}>
      {header && (
        <p className="px-4 mb-1.5 text-2xs font-bold uppercase tracking-wider text-ink-400">{header}</p>
      )}
      <div className="overflow-hidden rounded-card bg-card divide-y divide-page">
        {children}
      </div>
    </div>
  );
}

interface RowProps {
  icon?: React.ComponentType<{ className?: string }>;
  iconBg?: string;      // tailwind bg for the glyph tile, e.g. 'bg-brand-600'
  avatarUrl?: string;   // a person's photo instead of an icon tile (e.g. who liked/followed/replied) — takes precedence over icon when set
  label: string;
  sublabel?: string;
  value?: string;       // trailing muted value (e.g. "08:00")
  valueMuted?: boolean; // dims + italicizes `value` — an unset-field placeholder (e.g. "Not set") rather than real data
  valueSuccess?: boolean; // shows `value` in green — a field the user has actually filled in
  href?: string;        // renders as a Link with a chevron
  onClick?: () => void; // renders as a button with a chevron
  trailing?: React.ReactNode; // custom trailing (e.g. a toggle) — suppresses chevron
  danger?: boolean;
}

// One row. If href/onClick given → navigable (chevron). If `trailing` given
// (e.g. a toggle) → no chevron. Otherwise a static info row.
export function InsetRow({ icon: Icon, iconBg = 'bg-brand-600', avatarUrl, label, sublabel, value, valueMuted, valueSuccess, href, onClick, trailing, danger }: RowProps) {
  const press = 'active:bg-page/60';
  const interactive = !!href || !!onClick;
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="shrink-0 w-7 h-7 rounded-full object-cover" />
      ) : Icon && (
        <span className={cn('shrink-0 w-7 h-7 rounded-md flex items-center justify-center', iconBg)}>
          <Icon className="h-4 w-4 text-white" />
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className={cn('block text-[15px] font-medium truncate', danger ? 'text-accent-red' : 'text-ink-700')} dir="auto">{label}</span>
        {sublabel && <span className="block text-xs truncate text-ink-400" dir="auto">{sublabel}</span>}
      </span>
      {/* dir="auto" so a value made only of digits and punctuation isn't
          bidi-reordered by the RTL page around it. A date range ("06.09 –
          12.09") has no strongly-directional character at all, so the two number
          runs and the dash between them were being laid out right-to-left —
          rendering this week as "12.09 – 06.09". Hebrew values still resolve to
          RTL, since dir="auto" reads the first strong character. */}
      {value && (
        <span dir="auto" className={cn(
          'text-[15px] shrink-0 tabular-nums',
          // A muted value ("not set yet") is carried by the italic alone. It used
          // to also be a lighter grey, but that grey is a border value at 1.92:1
          // and this is real text the athlete has to read to know a field is empty.
          valueMuted ? 'italic text-ink-400' : valueSuccess ? 'font-medium text-accent-600' : 'text-ink-400',
        )}>{value}</span>
      )}
      {trailing ? trailing : interactive && <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />}
    </div>
  );

  if (href) return <Link href={href} onClick={onClick} className={cn('block transition-colors', press)}>{inner}</Link>;
  if (onClick) {
    // A real <button> here is invalid HTML whenever `trailing` also contains
    // its own interactive control (e.g. a KudosButton/RSVP toggle) — buttons
    // can't nest, and React logs a hydration-mismatch error for it. A div with
    // button semantics gets the same click/keyboard affordance without that
    // restriction; stopPropagation on the nested control (already used by
    // every trailing action) keeps its own click from re-triggering this one.
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
        className={cn('w-full text-start transition-colors cursor-pointer', press)}
      >
        {inner}
      </div>
    );
  }
  return inner;
}
