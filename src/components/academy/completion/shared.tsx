'use client';

import type { ReactNode } from 'react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CARD } from '../book/ui';

// ── The existing-trainees screens' shared pieces (mockup academy-existing-trainees.html) ──
//
// One visual system with the workout book (FlowScreen, the 22px cards, the 56px buttons),
// so the atoms here are only what that set lacks: the form's label/value row, the green
// threshold box, the chips of phone 1 and the avatar.

/** A JSON request with the session's bearer. Throws with the server's error on a non-2xx. */
export async function sendJson<T = Record<string, unknown>>(method: 'POST' | 'PUT' | 'PATCH', url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: await apiHeaders(true), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(String((data as { error?: string })?.error || res.status)) as Error & { status?: number; data?: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

/** `2026-09-14` → `14.09`. */
export function shortDay(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

/** A label on the right, its value on the left, 52px — one row of the form's card (phone 2). */
export function FieldRow({ label, children, htmlFor }: { label: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 border-b border-[#EFEFF4] px-4 last:border-0">
      <label htmlFor={htmlFor} className="min-w-0 flex-1 text-[16px] font-bold text-ink-900">{label}</label>
      <div className="flex shrink-0 items-center justify-end">{children}</div>
    </div>
  );
}

/** The value side as a button (band, goal, coach): brand blue when set, grey when not. */
export function ValueButton({ children, empty, onClick, disabled, label }: {
  children: ReactNode; empty?: boolean; onClick?: () => void; disabled?: boolean; label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn('-my-1 min-h-[44px] max-w-[190px] truncate text-[16px] font-extrabold disabled:cursor-default',
        empty ? 'text-ink-300' : disabled ? 'text-ink-700' : 'text-brand-600')}
    >
      {children}
    </button>
  );
}

/** The input inside a FieldRow: a number typed LTR, aligned to the value side. */
export const FIELD_INPUT = 'h-11 w-[120px] bg-transparent text-left text-[16px] font-extrabold text-brand-600 placeholder:font-semibold placeholder:text-ink-300 focus:outline-none';

/** "4:13 · קצב הסף של Shahar": the green box (phones 2 and 4). */
export function ThresholdBox({ pace, title, sub, tone = 'good' }: { pace: string | null; title: ReactNode; sub: ReactNode; tone?: 'good' | 'warn' | 'muted' }) {
  return (
    <div className={cn('flex items-center gap-3.5 rounded-[22px] px-4 py-3',
      tone === 'good' ? 'bg-[#E5F6EC]' : tone === 'warn' ? 'bg-[#FDF0E2]' : 'bg-[#F0F0F4]')}
    >
      <b className={cn('shrink-0 text-[38px] font-black leading-none tabular-nums',
        tone === 'good' ? 'text-[#0E7A3C]' : tone === 'warn' ? 'text-[#A8510A]' : 'text-ink-400')}
      >
        <bdi dir="ltr">{pace ?? '—'}</bdi>
      </b>
      <span className="min-w-0 flex-1">
        <b className={cn('block text-[16px] font-extrabold leading-tight', tone === 'good' ? 'text-[#0E7A3C]' : tone === 'warn' ? 'text-[#A8510A]' : 'text-ink-700')}>{title}</b>
        <small className={cn('mt-0.5 block text-[13px] font-semibold leading-snug', tone === 'good' ? 'text-[#0E7A3C]' : 'text-ink-500')}>{sub}</small>
      </span>
    </div>
  );
}

export const CHIP_TONE = {
  missing: 'bg-[#FDF0E2] text-[#A8510A]',
  pending: 'bg-[#EEF0FF] text-brand-600',
  have: 'bg-[#E5F6EC] text-[#0E7A3C]',
} as const;

export function ChipPill({ tone, children }: { tone: keyof typeof CHIP_TONE; children: ReactNode }) {
  return <span className={cn('inline-block whitespace-nowrap rounded-lg px-2 py-[3px] text-[12.5px] font-extrabold', CHIP_TONE[tone])}>{children}</span>;
}

export function Avatar({ text }: { text: string }) {
  return (
    <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#E3E6FF] text-[14px] font-black text-brand-600" dir="ltr">
      {text}
    </span>
  );
}

/** The white "⌚ למשוך מהשעון" button, 56px. */
export function WatchButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn(CARD, 'flex h-14 w-full items-center justify-center gap-2 text-[16.5px] font-extrabold text-brand-600 disabled:opacity-50')}>
      {children}
    </button>
  );
}
