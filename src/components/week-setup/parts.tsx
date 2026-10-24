'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The small pieces every "תחילת שבוע" card is made of (mockup ~/.cache/madregot/week-setup.html). */

export type Tone = 'ok' | 'warn' | 'todo' | 'pause' | 'auto';
const TONES: Record<Tone, string> = {
  ok: 'text-[#15803d] bg-[#E8F6EE]',
  warn: 'text-[#B45309] bg-[#FFF3E0]',
  todo: 'text-[#AD3838] bg-[#FCEBEB]',
  pause: 'text-ink-500 bg-[#EEEFF2]',
  auto: 'text-brand-600 bg-brand-600/[0.07]',
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn('shrink-0 whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11.5px] font-extrabold', TONES[tone])}>{children}</span>;
}

export function Tile({ icon: Icon, color, size = 38 }: { icon: LucideIcon; color: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[11px]" style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 12%, #fff)`, color }}>
      <Icon style={{ width: size / 2, height: size / 2 }} />
    </span>
  );
}

export function OwnerChip({ name, initials, color, me }: { name: string; initials: string; color: string; me?: string }) {
  return (
    <span className="inline-flex items-center gap-[5px] text-xs font-bold text-ink-500">
      <i className="grid h-[18px] w-[18px] place-items-center rounded-full text-[8px] font-extrabold not-italic text-white" style={{ background: color }}>{initials}</i>
      {name}{me ? ` · ${me}` : ''}
    </span>
  );
}

export function WeekCard({ icon, color, title, owner, status, children, actions, step, trail, next }: {
  icon: LucideIcon; color: string; title: string; owner: ReactNode; status?: ReactNode; children?: ReactNode; actions?: ReactNode;
  /** Its place in the Saturday's order (1–7). */
  step?: number;
  /** Who did it last, and when (lib/week-setup/log) — "✓ Yair · שבת 21:17 · התכנית עלתה". */
  trail?: ReactNode;
  /** It is "הבא בתור": framed, so the eye goes there first. */
  next?: boolean;
}) {
  return (
    <section className={cn('mx-4 mb-2.5 rounded-[22px] bg-card p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]', next && 'shadow-[0_0_0_2px_#1525FF]')}>
      <div className="flex items-center gap-[11px]">
        <span className="relative">
          <Tile icon={icon} color={color} />
          {step != null && <i className="absolute -end-1 -top-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-ink-900 text-[10px] font-extrabold not-italic text-white">{step}</i>}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <b className="text-base font-extrabold text-ink-900">{title}</b>
          {owner}
        </div>
        {status}
      </div>
      {trail}
      {children}
      {actions && <div className="mt-3 flex gap-2">{actions}</div>}
    </section>
  );
}

export function Btn({ kind = 'pri', icon: Icon, children, onClick, href, disabled, className }: {
  kind?: 'pri' | 'sec'; icon?: LucideIcon; children: ReactNode; onClick?: () => void; href?: string; disabled?: boolean; className?: string;
}) {
  const cls = cn(
    'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[14px] text-sm font-bold disabled:opacity-50',
    kind === 'pri' ? 'bg-ink-900 text-white' : 'bg-[#F2F3F6] text-ink-900',
    className,
  );
  const body = <>{Icon && <Icon className="h-[17px] w-[17px]" />}{children}</>;
  if (href) return <a href={href} className={cls}>{body}</a>;
  return <button type="button" onClick={onClick} disabled={disabled} className={cls}>{body}</button>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mt-2.5 block">
      <span className="text-xs font-bold text-ink-400">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <em className="mt-[3px] block text-[11.5px] not-italic text-ink-400">{hint}</em>}
    </label>
  );
}

export const inputCls = 'w-full rounded-xl bg-[#F4F5F8] px-3 py-[11px] text-[14.5px] font-semibold text-ink-900 shadow-[inset_0_0_0_1px_#E6E7EB] outline-none focus:shadow-[inset_0_0_0_1.5px_#1525FF]';

export function Chips<T extends string | number>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" onClick={() => onChange(o.value)}
          className={cn('min-h-[40px] flex-1 rounded-xl text-[13.5px] font-bold', o.value === value ? 'bg-ink-900 text-white' : 'bg-[#F2F3F6] text-ink-500')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Sunday-first short day names. */
export const DAY_SHORT: Record<'he' | 'en', string[]> = {
  he: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
export const DAY_LONG: Record<'he' | 'en', string[]> = {
  he: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
export const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
export const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
export const dowOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** The line under a step's title: who did it last and when. */
export function Trail({ done, name, when, what }: { done: boolean; name: string; when: string; what: string }) {
  return (
    <p className={cn('mt-2 flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12.5px] font-bold', done ? 'bg-[#E8F6EE] text-[#15803d]' : 'bg-[#F2F3F6] text-ink-500')}>
      <span aria-hidden>{done ? '✓' : '•'}</span>
      <span className="min-w-0 truncate"><bdi>{name}</bdi> · <bdi dir="ltr">{when}</bdi> · {what}</span>
    </p>
  );
}
