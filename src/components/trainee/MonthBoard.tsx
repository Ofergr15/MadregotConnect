'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { COMPLIANCE_HEX } from '@/lib/academy/compliance';
import { leadingDays, shiftMonth, summaryParts, type MonthBoardPayload } from '@/lib/academy/board';
import type { BoardView } from '@/lib/academy/deep-links';
import type { LoadPayload } from '@/lib/academy/load-payload';
import type { TraineeHome } from '@/lib/academy/trainee-home';
import { N } from '@/components/academy/book/ui';
import { BoardViewSwitch } from './WeekRows';
import { WeeklyLoadChart } from './WeeklyLoadChart';
import { KmCard } from './KmCard';
import { CARD, WEEKDAY_KEYS } from './ui';

// ── החודש (trainee-experience-v2 screen 3) ───────────────────────────────────────────────
//
// The month as a board, not a chart: seven columns Sunday-first, so in this RTL page the
// first column (א׳) is on the RIGHT; each day its number and the colour bar of its session
// (the week board's strip colours, graded by the same lib/academy/board.ts `boardRow`);
// today outlined; 🏁 only on the real race day; the previous month's days dimmed. Tapping
// a day with a session opens it (on the week board, which owns the workout screen).
//
// Under it the weekly ⚡ bars — a chart, so time runs left to right there — or, while the
// load is still being learned, the kilometres card (never an empty chart). Last, the line
// that counts the grid: lib/academy/board.ts `monthSummary`, from the very days drawn.

function monthWord(month: string, locale: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-US', { month: 'long', timeZone: 'UTC' });
}

export function MonthBoard({ athleteId, initialMonth, onView, onOpenDay }: {
  athleteId: string;
  initialMonth?: string | null;
  onView: (view: BoardView) => void;
  /** A day with a session was tapped. */
  onOpenDay: (date: string) => void;
}) {
  const t = useTranslations('trainee.month');
  const locale = useLocale();
  const [month, setMonth] = useState<string | null>(initialMonth ?? null);
  const q = `athleteId=${encodeURIComponent(athleteId)}`;
  const { data, error } = useApi<MonthBoardPayload>(`/api/academy/month?${q}${month ? `&month=${month}` : ''}`, { keepPreviousData: true });
  const { data: load } = useApi<LoadPayload>(`/api/academy/load?${q}&range=6w`);
  const loadOk = load?.status.kind === 'ok' && load.weekly.length >= 2;
  // The km card is the fallback, so its (heavier) source is read only when it is needed.
  const { data: home } = useApi<TraineeHome>(load && !loadOk ? `/api/academy/me?${q}` : null);

  if (!data) {
    return <p className="py-10 text-center text-sm text-ink-400">{error ? t('error') : '…'}</p>;
  }

  const shown = data.month;
  const [year] = shown.split('-');
  const word = monthWord(shown, locale);
  const lead = leadingDays(shown);
  const prevDays = new Date(Date.UTC(Number(year), Number(shown.slice(5, 7)) - 1, 0)).getUTCDate();
  const isCurrent = data.today.startsWith(shown);
  const s = data.summary;
  const parts = summaryParts(s);
  const m = (c: ReactNode) => <N>{c}</N>;

  return (
    <div className="space-y-2.5" dir="rtl">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setMonth(shiftMonth(shown, -1))} aria-label={t('prev')}
          className="grid h-11 w-11 place-items-center rounded-full text-brand-600">
          <ChevronRight className="h-6 w-6" />
        </button>
        <h2 className="text-[17px] font-extrabold text-ink-900">{t.rich('title', { m, month: word, year })}</h2>
        <button type="button" onClick={() => setMonth(shiftMonth(shown, 1))} aria-label={t('next')}
          className="grid h-11 w-11 place-items-center rounded-full text-brand-600">
          <ChevronLeft className="h-6 w-6" />
        </button>
      </div>

      <BoardViewSwitch view="month" onChange={onView} />

      {/* Sunday first; the page is RTL, so the first column is the rightmost. */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_KEYS.map(k => <div key={k} className="text-[11px] font-extrabold text-ink-400">{t(`weekdays.${k}`)}</div>)}
        {Array.from({ length: lead }, (_, i) => prevDays - lead + 1 + i).map(d => (
          <div key={`o${d}`} aria-hidden className="h-11 rounded-[10px] bg-white pt-[5px] text-[12.5px] font-bold opacity-[.38] shadow-[0_1px_2px_rgba(20,22,40,.04),0_6px_18px_rgba(20,22,40,.06)]">
            <N>{d}</N>
          </div>
        ))}
        {data.days.map((d) => {
          const n = Number(d.date.slice(8, 10));
          const label = [
            t(`day.${d.color ?? 'none'}`, { day: n }),
            d.today ? t('day.today') : null,
            d.race ? t('day.race') : null,
          ].filter(Boolean).join(' · ');
          const cell = cn(
            'relative h-11 rounded-[10px] bg-white pt-[5px] text-[12.5px] font-bold text-ink-900 shadow-[0_1px_2px_rgba(20,22,40,.04),0_6px_18px_rgba(20,22,40,.06)]',
            d.today && 'outline outline-2 outline-brand-600',
          );
          const inner = (
            <>
              <N>{n}</N>
              {d.race && <span aria-hidden className="absolute end-[3px] top-0.5 text-[10px] leading-none">🏁</span>}
              {d.color && (
                <i aria-hidden className="absolute bottom-1.5 left-1/2 h-[5px] w-5 -translate-x-1/2 rounded-[3px]" style={{ background: COMPLIANCE_HEX[d.color] }} />
              )}
            </>
          );
          return d.color ? (
            <button key={d.date} type="button" aria-label={label} onClick={() => onOpenDay(d.date)} className={cell}>{inner}</button>
          ) : (
            <div key={d.date} aria-label={label} className={cell}>{inner}</div>
          );
        })}
      </div>

      {loadOk ? (
        <WeeklyLoadChart weekly={load!.weekly} />
      ) : home?.km && home.week ? (
        <KmCard
          weeks={home.km.weeks}
          plannedKm={home.km.plannedKm}
          avgKm={home.km.avgKm}
          doneKm={Math.round(home.week.workouts.reduce((sum, w) => sum + (w.actualM ?? 0), 0) / 100) / 10}
          isCurrentWeek
          completed={home.week.completedCount}
          planned={home.week.plannedCount}
        />
      ) : null}

      {s.planned > 0 && (
        <div className={cn(CARD, 'flex min-h-14 items-center gap-[11px] px-3.5')}>
          <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">📅</span>
          <div className="min-w-0 flex-1 py-[9px]">
            <b className="block text-[14.5px] font-extrabold text-ink-900">
              {t.rich(isCurrent ? 'summarySoFar' : 'summaryWhole', { m, month: word, done: s.done, planned: s.planned })}
            </b>
            <small className="mt-px block text-[12.5px] leading-snug text-ink-400">
              {t.rich('summaryKm', { m, km: s.km })}
              {parts.length > 0 && ' · '}
              {parts.map((p, i) => <span key={p.key}>{i > 0 && ', '}{t.rich(`part.${p.key}`, { m, n: p.n })}</span>)}
            </small>
          </div>
        </div>
      )}
    </div>
  );
}
