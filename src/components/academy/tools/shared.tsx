'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { COMPLIANCE_HEX, type ComplianceColor } from '@/lib/academy/compliance';
import type { StepChange } from '@/lib/academy/coach-tools';
import { RICH, kmText } from '../book/ui';
import { WEEKDAY_KEYS } from '../book/WeekBoard';

// ── The coach tools' shared pieces (mockup academy-coach-tools.html) ──────────────────────

/**
 * A number for a plain string: wrapped in LRI…PDI, the text form of `<bdi dir="ltr">`. The
 * home's waiting rows are strings (lib/academy/home.ts), and "4 מ־5" inside RTL text must
 * not be reordered.
 */
export const iso = (v: string | number) => `\u2066${v}\u2069`;

/** `−7` with a real minus sign (U+2212): a hyphen beside Hebrew is read as punctuation. */
export function signed(n: number, plusSign = true): string {
  if (n === 0) return '0';
  return n > 0 ? `${plusSign ? '+' : ''}${n}` : `−${Math.abs(n)}`;
}

/** `4–10.10`, or `28.9–4.10` across a month. */
export function weekRange(weekStart: string): string {
  const s = new Date(`${weekStart}T12:00:00Z`);
  const e = new Date(s); e.setUTCDate(e.getUTCDate() + 6);
  const sd = s.getUTCDate(), sm = s.getUTCMonth() + 1, ed = e.getUTCDate(), em = e.getUTCMonth() + 1;
  return sm === em ? `${sd}–${ed}.${em}` : `${sd}.${sm}–${ed}.${em}`;
}

/** `2026-10-08` → `8.10`. */
export function dayMonth(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}`;
}

const HEBREW = /[֐-׿]/;

export interface Square {
  dayOfWeek: number;
  label: string | null;
  color: ComplianceColor | 'planned' | 'empty';
}

/**
 * The week as seven squares, Sunday first (on the right): a coloured top edge per session
 * (the compliance colours, or brand blue for a planned week being copied), the day, and the
 * session's shape — `6×800`, `5×1K`, `טמפו`, `16K` — or `–` on a day off.
 */
export function WeekSquares({ squares, label }: { squares: Square[]; label?: string }) {
  const t = useTranslations('workoutBook');
  const byDay = new Map(squares.map(s => [s.dayOfWeek, s]));
  return (
    <div className="grid grid-cols-7 gap-1.5" role="list" aria-label={label}>
      {WEEKDAY_KEYS.map((key, d) => {
        const s = byDay.get(d);
        const top = !s || s.color === 'empty' ? '#D5D6DE' : s.color === 'planned' ? '#1525FF' : COMPLIANCE_HEX[s.color];
        const text = s?.label ?? null;
        return (
          <div key={key} role="listitem" className="overflow-hidden rounded-xl bg-white text-center shadow-[0_1px_2px_rgba(20,22,40,.04),0_4px_12px_rgba(20,22,40,.05)]">
            <i aria-hidden className="block h-[4px]" style={{ background: top }} />
            <small className="mt-1 block text-[11px] font-bold leading-none text-ink-400">{t(`dayShort.${key}`).replace('׳', '')}</small>
            <b className="mb-1.5 mt-1 block truncate px-0.5 text-[12.5px] font-black leading-tight text-ink-900">
              {text ? <bdi dir={HEBREW.test(text) ? 'rtl' : 'ltr'}>{text}</bdi> : '–'}
            </b>
          </div>
        );
      })}
    </div>
  );
}

/** One session's change in words: "7 חזרות במקום 6". Null = no change. */
export function ChangeWords({ changes }: { changes: StepChange[] }) {
  const t = useTranslations('academyTools.copy');
  if (!changes.length) return <>{t('noChange')}</>;
  return (
    <>
      {changes.map((c, i) => {
        const key = `${c.type}-${i}`;
        const sep = i > 0 ? ' · ' : '';
        const len = (v: number, measure: 'distance' | 'time') => (measure === 'distance' ? kmText(v) : String(Math.round(v / 60)));
        if (c.type === 'count') return <span key={key}>{sep}{t.rich('countChange', { ...RICH, to: c.to, from: c.from })}</span>;
        if (c.type === 'repLength') {
          if (c.measure === 'time') {
            const whole = c.from % 60 === 0 && c.to % 60 === 0;
            return <span key={key}>{sep}{t.rich(whole ? 'repMin' : 'repSec', { ...RICH, to: whole ? c.to / 60 : c.to, from: whole ? c.from / 60 : c.from })}</span>;
          }
          const km = c.from >= 1000 && c.to >= 1000;
          return <span key={key}>{sep}{t.rich(km ? 'repKm' : 'repM', { ...RICH, to: km ? kmText(c.to) : c.to, from: km ? kmText(c.from) : c.from })}</span>;
        }
        if (c.type === 'length') {
          return <span key={key}>{sep}{t.rich(c.measure === 'time' ? 'lenMin' : 'lenKm', { ...RICH, to: len(c.to, c.measure), from: len(c.from, c.measure) })}</span>;
        }
        return <span key={key}>{sep}{t.rich(c.measure === 'time' ? 'easyMin' : 'easyKm', { ...RICH, to: len(c.to, c.measure) })}</span>;
      })}
    </>
  );
}

/** A two-or-four-way segmented control, 44px tall, the mockup's `לשבוע הבא | לעוד שבועות`. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ value: T; label: React.ReactNode }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex rounded-[14px] bg-[#E6E6EC] p-[3px]" role="radiogroup" aria-label={label}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-[44px] flex-1 whitespace-nowrap rounded-[11px] px-1 text-[14.5px] font-extrabold transition-colors',
              on ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
