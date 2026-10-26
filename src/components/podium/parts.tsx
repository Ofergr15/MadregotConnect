'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { englishName, hebrewName, type PodiumProduct } from '@/lib/podium/model';

/** ₪8 · ₪12.5 — whole shekels stay whole. */
export const shekel = (n: number) => `₪${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, '')}`;
export const shekelRound = (n: number) => `₪${Math.round(n).toLocaleString('he-IL')}`;

export const whenIL = (iso: string) => new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));

export function Stepper({ qty, onChange, disabled, size = 'md', floating }: {
  qty: number; onChange: (q: number) => void; disabled?: boolean; size?: 'md' | 'sm'; floating?: boolean;
}) {
  const btn = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  if (disabled && qty === 0) return null;
  return (
    <div
      className={cn('flex items-center rounded-pill', floating ? 'bg-white shadow-[0_4px_14px_rgb(0_0_0/0.16)]' : 'bg-page', disabled && 'opacity-70')}
      onClick={(e) => e.stopPropagation()}
    >
      {qty > 0 && (
        <>
          <button type="button" aria-label="פחות" disabled={disabled} onClick={() => onChange(qty - 1)} className={cn(btn, 'grid place-items-center rounded-pill text-ink-900 active:scale-90 transition-transform')}>
            <Minus className="h-4 w-4" strokeWidth={3} />
          </button>
          <bdi className="min-w-[22px] text-center text-[15px] font-black tabular-nums text-ink-900">{qty}</bdi>
        </>
      )}
      {!disabled && (
        <button type="button" aria-label="עוד אחד" onClick={() => onChange(Math.min(99, qty + 1))}
          className={cn(btn, 'grid place-items-center rounded-pill text-white active:scale-90 transition-transform', qty > 0 ? 'bg-brand-600' : 'bg-ink-900')}>
          <Plus className="h-4 w-4" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

export function Price({ p, big }: { p: PodiumProduct; big?: boolean }) {
  if (p.price == null) return <span className="text-13 font-bold text-ink-400">אין מחיר באתר</span>;
  return (
    <span className="flex items-baseline gap-1.5">
      <b className={cn('font-black tabular-nums text-ink-900', big ? 'text-[28px]' : 'text-[17px]')}>{shekel(p.price)}</b>
      {p.regularPrice && p.regularPrice > p.price && <s className={cn('tabular-nums text-ink-400', big ? 'text-base' : 'text-xs')}>{shekel(p.regularPrice)}</s>}
    </span>
  );
}

export function ProductImage({ p, className }: { p: PodiumProduct; className?: string }) {
  return p.imageUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={p.imageUrl} alt="" loading="lazy" className={cn('h-full w-full object-contain', className)} />
    : <div className="grid h-full w-full place-items-center text-xs text-ink-300">אין תמונה</div>;
}

export function ProductCard({ p, qty, onQty, onOpen, locked }: {
  p: PodiumProduct; qty: number; onQty: (q: number) => void; onOpen: () => void; locked?: boolean;
}) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      className={cn('overflow-hidden rounded-[20px] bg-card text-start transition-shadow', qty > 0 ? 'ring-2 ring-brand-600' : 'ring-1 ring-black/[0.04]')}>
      <div className="relative aspect-square bg-white p-3">
        <ProductImage p={p} />
        {p.deal && (
          <span className="absolute top-2 end-2 max-w-[80%] rounded-lg bg-[#FF5A1F] px-1.5 py-0.5 text-[10.5px] font-extrabold leading-tight text-white">{p.deal}</span>
        )}
        <div className="absolute bottom-2 start-2">
          <Stepper qty={qty} onChange={onQty} disabled={locked} floating />
        </div>
      </div>
      <div className="px-3 pb-3 pt-2">
        <span dir="ltr" className="block h-[32px] overflow-hidden text-left text-[12.5px] font-bold leading-tight text-ink-700">{englishName(p.name)}</span>
        <div className="mt-1.5"><Price p={p} /></div>
      </div>
    </div>
  );
}

export function ProductLine({ p, qty, onQty, locked, right }: {
  p: PodiumProduct; qty: number; onQty?: (q: number) => void; locked?: boolean; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white p-1 ring-1 ring-black/5"><ProductImage p={p} /></div>
      <div className="min-w-0 flex-1">
        <span dir="ltr" className="block truncate text-left text-13 font-bold text-ink-900">{englishName(p.name)}</span>
        <span className="block truncate text-2xs text-ink-400">{p.price != null ? `${shekel(p.price)} ליחידה` : 'אין מחיר'}{hebrewName(p.name) ? ` · ${hebrewName(p.name)}` : ''}</span>
      </div>
      {onQty ? <Stepper qty={qty} onChange={onQty} disabled={locked} size="sm" /> : <bdi className="text-base font-black tabular-nums">×{qty}</bdi>}
      {right}
    </div>
  );
}
