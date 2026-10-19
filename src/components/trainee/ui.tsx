'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { wordFirstTitle } from '@/lib/academy/title-order';
import { cn } from '@/lib/utils';

// ── The trainee experience v2's shared pieces (mockup trainee-experience-v2.html) ──────
//
// The mockup is one visual system across its phones, so its atoms live here once: the
// card, the tag colours, the band colours, and the number helpers. Colours are the
// mockup's `:root` vars; secondary text uses the app's ink ramp, as the book does.

export const C = {
  brand: '#1525FF',
  brandL: '#EEF0FF',
  good: '#0E7A3C',
  goodM: '#1FA55B',
  goodBg: '#E5F6EC',
  warn: '#A8510A',
  warnBg: '#FDF0E2',
  org: '#E8890C',
  bad: '#BF2F2A',
  badBg: '#FDE7E5',
  sep: '#EFEFF4',
  /** The profile bar's tones (mockup `--easy/--tempo/--fast/--rest`). */
  easy: '#C9CDF6',
  tempo: '#8C94FF',
  fast: '#1525FF',
  rest: '#E6E7EE',
} as const;

export const SHADOW = 'shadow-[0_1px_2px_rgba(20,22,40,.04),0_6px_18px_rgba(20,22,40,.06)]';
export const CARD = cn('rounded-[20px] bg-white', SHADOW);
/**
 * A trainee screen's own top row, standing in for the folded app header (lib/shell-chrome):
 * the status-bar inset, then the mockup's 56px bar — the scroll box's own 20px top padding
 * taken back, so the first card starts where mockups 1–3 draw it. Phone only.
 */
export const TOP_BAR = 'safe-top -mt-5 min-h-[56px] md:mt-0 md:min-h-0 md:pt-0';

/** The number tile's tint per form band (mockup 1: `.num.g`). */
export const BAND_TILE: Record<string, { bg: string; ink: string }> = {
  veryTired: { bg: '#FDE7E5', ink: '#BF2F2A' },
  working: { bg: '#E5F6EC', ink: '#0E7A3C' },
  maintain: { bg: '#E5F6EC', ink: '#0E7A3C' },
  fresh: { bg: '#E7F0FD', ink: '#1F5FBF' },
  detraining: { bg: '#F0F0F4', ink: '#4A4B57' },
};

export type TagTone = 'b' | 'g' | 'w' | 'r' | 'n';
const TAG: Record<TagTone, string> = {
  b: 'bg-[#EEF0FF] text-brand-600',
  g: 'bg-[#E5F6EC] text-[#0E7A3C]',
  w: 'bg-[#FDF0E2] text-[#A8510A]',
  r: 'bg-[#FDE7E5] text-[#BF2F2A]',
  n: 'bg-[#F0F0F4] text-ink-500',
};

export function Tag({ tone, children, className }: { tone: TagTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-lg px-2 py-[3px] text-[11.5px] font-extrabold', TAG[tone], className)}>
      {children}
    </span>
  );
}

/** Tag map for `t.rich`: `<m>4:05</m>` isolated LTR, `<b>…</b>` bold, `<bdi>` a name. */
export const RICH = {
  m: (chunks: ReactNode) => <bdi dir="ltr">{chunks}</bdi>,
  b: (chunks: ReactNode) => <b className="font-extrabold text-ink-900">{chunks}</b>,
  bdi: (chunks: ReactNode) => <bdi>{chunks}</bdi>,
};

/** The small chevron that points "inward" in RTL (‹). */
export function Chevron({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 10 16" className={cn('inline-block h-[10px] w-[7px] align-[-1px]', className)}>
      <path d="M8 2L2 8l6 6" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Numbers (the words are in messages/*.json) ─────────────────────────────────────────

/** `245` → `4:05`; `3065` → `51:05`; `4000` → `1:06:40`. */
export function clock(seconds: number): string {
  const total = Math.round(Math.abs(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** `10240` → `10.2`, `2000` → `2`. */
export function km(metres: number): string {
  const v = Math.round(metres / 100) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** A signed figure with a real minus (U+2212): `+0.1`, `−0:43`, `+2`. */
export function signedText(n: number, format: (abs: number) => string = String): string {
  if (n === 0) return format(0);
  return `${n < 0 ? '−' : '+'}${format(Math.abs(n))}`;
}

/** `2026-12-06` → `6.12`. */
export function dm(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}`;
}

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function weekdayOf(date: string): (typeof WEEKDAY_KEYS)[number] {
  return WEEKDAY_KEYS[new Date(`${date.slice(0, 10)}T12:00:00Z`).getUTCDay()];
}

/** The month a date falls in, as a word: "ספטמבר". */
export function monthName(date: string, locale: string): string {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-US', { month: 'long', timeZone: 'UTC' });
}

/** A number, a pace or a structure: `5 × 1`, `4:01–4:09`, `10.3`, `3 × 2`. */
const STRUCTURE = /\d[\d.:,]*(?:\s*[×x–-]\s*\d[\d.:,]*)*/g;

/**
 * A session's name with every number run isolated LTR ("5 × 1 ק״מ" →
 * `<bdi dir="ltr">5 × 1</bdi> ק״מ`, the mockup's markup), so the count stays on the left of
 * the size whatever the paragraph direction. The names come from the book
 * (`structureName`) and from coaches, so they are split here rather than in messages.
 */
export function StructureText({ text: raw }: { text: string }) {
  return <NumberRuns text={wordFirstTitle(raw)} />;
}

/** The isolation alone, the words left in their order: any run's name ("5 × 1 ק״מ" reads five times one in a Hebrew line). */
export function NumberRuns({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(STRUCTURE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    // A repeat ("5 × 1") is two numbers in the sentence's own order, not one LTR run: isolated
    // as LTR inside a Hebrew line it reads "1 × 5" (WebKit, 2026-10-19 — the coach's screen,
    // plain text, read "5 × 1"). Each side stays LTR for its own digits, colons and ranges.
    const sides = m[0].split(/(\s*[×x]\s*)/);
    if (sides.length > 1) {
      sides.forEach((part, i) => out.push(i % 2 ? part : <bdi key={`${at}-${i}`} dir="ltr">{part}</bdi>));
    } else {
      out.push(<bdi key={at} dir="ltr">{m[0]}</bdi>);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <bdi>{out}</bdi>;
}

/**
 * A segmented control in the mockup's `.seg` look: equal cells, 44 px tall, the chosen one
 * white. `role="tablist"` like the board's week | month switch.
 */
export function Segmented<T extends string>({ value, options, onChange, label, className }: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex rounded-[13px] bg-[#E6E6EC] p-[3px]', className)}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => { if (value !== o.value) onChange(o.value); }}
          className={cn(
            'h-11 min-w-0 flex-1 truncate rounded-[10px] px-1 text-[13.5px] font-extrabold',
            value === o.value ? 'bg-white text-ink-900 shadow-[0_1px_3px_rgba(0,0,0,.08)]' : 'text-ink-400',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A box's measured inner width, so a chart is laid out at real pixels (no stretched rx). */
export function useMeasuredWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}
