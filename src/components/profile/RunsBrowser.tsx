'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Route } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn, israelToday } from '@/lib/utils';
import { SegmentedControl } from '@/components/ui';
import { formatPace } from '@/components/activity/format';
import { RouteMinimap } from '@/components/RouteMinimap';
import { PrBadge, usePrRuns } from '@/components/PrBadge';
import { addDays, calendarCells, monthRange, type RangeRun } from '@/lib/athletes/runs-range';

/**
 * AN ATHLETE'S RUNS, TWO WAYS, LIKE STRAVA'S PROFILE. For the super user until rollout.
 *
 *  · Weeks — the ten-week chart, where a bar is a button: tap a week and its runs
 *    list under it, each one a door into the run.
 *  · Calendar — a month, a circle per day sized by the kilometres run on it; tap a
 *    day and its runs list under the grid the same way.
 *
 * The switch between them is the filter. Both read one window at a time from
 * /api/athletes/[id]/runs, so a month is one small request however long the
 * athlete's history is.
 */

export interface BrowserWeek {
  weekStart: string;
  km: number;
  runs: number;
  isCurrent: boolean;
}

type View = 'weeks' | 'calendar';

export function RunsBrowser({ athleteId, weeks }: { athleteId: string; weeks: BrowserWeek[] }) {
  const t = useTranslations('profile');
  const [view, setView] = useState<View>('weeks');
  return (
    <section className="rounded-card bg-card p-4">
      <SegmentedControl<View>
        value={view}
        onChange={setView}
        options={[
          { value: 'weeks', label: t('runsViewWeeks'), icon: BarChart3 },
          { value: 'calendar', label: t('runsViewCalendar'), icon: CalendarDays },
        ]}
      />
      {view === 'weeks' ? <WeeksView athleteId={athleteId} weeks={weeks} /> : <CalendarView athleteId={athleteId} />}
    </section>
  );
}

function useRangeRuns(athleteId: string, from: string | null, to: string | null) {
  const { data, isLoading } = useApi<{ runs: RangeRun[] }>(
    from && to ? `/api/athletes/${athleteId}/runs?from=${from}&to=${to}` : null,
  );
  return { runs: data?.runs ?? [], loading: isLoading && !data };
}

function WeeksView({ athleteId, weeks }: { athleteId: string; weeks: BrowserWeek[] }) {
  const t = useTranslations('profile');
  const [picked, setPicked] = useState<string | null>(null);
  const selected = weeks.find((w) => w.weekStart === picked) ?? weeks[weeks.length - 1] ?? null;
  const { runs, loading } = useRangeRuns(athleteId, selected?.weekStart ?? null, selected ? addDays(selected.weekStart, 7) : null);
  const peak = Math.max(...weeks.map((w) => w.km), 1);

  if (!selected) return <p className="mt-3 text-sm font-light text-ink-400">{t('noKmHistory')}</p>;

  return (
    <>
      <div dir="ltr" className="mt-4 flex h-[104px] items-end justify-center gap-1">
        {weeks.map((w) => {
          const on = w.weekStart === selected.weekStart;
          return (
            <button
              key={w.weekStart}
              type="button"
              onClick={() => setPicked(w.weekStart)}
              aria-pressed={on}
              aria-label={t('runsWeekOf', { date: dm(w.weekStart) })}
              className="flex h-full min-w-0 flex-1 flex-col items-end justify-end"
            >
              <span className={cn('mb-1 w-full text-center text-2xs font-bold tabular-nums', on ? 'text-brand-600' : 'text-ink-400')}>
                {w.km}
              </span>
              <span
                className={cn('block w-full rounded-t-[3px]', on ? 'bg-brand-600' : 'bg-brand-600/35')}
                style={{ height: `${Math.max(3, Math.round((w.km / peak) * 68))}px` }}
              />
              <span className={cn('mt-1 w-full text-center text-2xs tabular-nums', on ? 'font-bold text-brand-600' : 'font-light text-ink-400')}>
                {dm(w.weekStart)}
              </span>
            </button>
          );
        })}
      </div>
      <ListHead
        title={selected.isCurrent ? t('runsThisWeek') : t('runsWeekOf', { date: dm(selected.weekStart) })}
        km={selected.km}
        count={selected.runs}
      />
      <RunRows runs={runs} loading={loading} empty={t('runsNoneInWeek')} />
    </>
  );
}

function CalendarView({ athleteId }: { athleteId: string }) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const locale = useLocale();
  const today = israelToday();
  const [month, setMonth] = useState(() => monthRange(today).from);
  const { from, to } = monthRange(month);
  const { runs, loading } = useRangeRuns(athleteId, from, to);
  const cells = useMemo(() => calendarCells(from, runs), [from, runs]);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  // The day under the grid: the one tapped, else the latest this month with a run.
  const withRuns = cells.filter((c) => c && c.runs.length > 0);
  const day = cells.find((c) => c?.day === pickedDay) ?? withRuns[withRuns.length - 1] ?? null;
  const monthKm = Math.round(runs.reduce((s, r) => s + r.km, 0) * 10) / 10;
  const peak = Math.max(...cells.map((c) => c?.km ?? 0), 1);
  const heads = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
    // 2026-09-27 is a Sunday: seven days from it are the heads in order.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(`${addDays('2026-09-27', i)}T12:00:00`)));
  }, [locale]);
  const isThisMonth = from === monthRange(today).from;
  const go = (n: number) => {
    const d = new Date(`${from}T12:00:00`);
    d.setMonth(d.getMonth() + n);
    setMonth(monthRange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`).from);
    setPickedDay(null);
  };
  const Prev = locale === 'he' ? ChevronRight : ChevronLeft;
  const Next = locale === 'he' ? ChevronLeft : ChevronRight;

  return (
    <>
      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={() => go(-1)} aria-label={t('runsPrevMonth')} className="-m-2 p-2 text-ink-500">
          <Prev className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="text-base font-bold text-ink-700">
            {new Date(`${from}T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
          </p>
          <p className="text-xs font-light text-ink-400">
            <bdi dir="ltr" className="tabular-nums">{monthKm}</bdi> {tc('km')} · {t('runsCount', { count: runs.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={isThisMonth}
          aria-label={t('runsNextMonth')}
          className="-m-2 p-2 text-ink-500 disabled:opacity-30"
        >
          <Next className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1">
        {heads.map((h, i) => (
          <span key={i} className="text-center text-2xs font-bold text-ink-400">{h}</span>
        ))}
        {cells.map((c, i) => {
          if (!c) return <span key={`b${i}`} />;
          const size = c.km > 0 ? Math.round(18 + (c.km / peak) * 18) : 0;
          const on = day?.day === c.day;
          return (
            <button
              key={c.day}
              type="button"
              disabled={c.runs.length === 0}
              onClick={() => setPickedDay(c.day)}
              aria-pressed={on}
              aria-label={c.km > 0 ? `${Number(c.day.slice(8))} · ${c.km} ${tc('km')}` : String(Number(c.day.slice(8)))}
              className={cn('flex aspect-square items-center justify-center rounded-lg', c.day === today && 'ring-1 ring-ink-700')}
            >
              {c.km > 0 ? (
                <span
                  className={cn(
                    'flex items-center justify-center rounded-full text-3xs font-bold tabular-nums text-white',
                    on ? 'bg-ink-900' : 'bg-brand-600',
                  )}
                  style={{ width: size, height: size }}
                >
                  {size >= 26 ? Math.round(c.km) : ''}
                </span>
              ) : (
                <span className="text-2xs font-light text-ink-300 tabular-nums">{Number(c.day.slice(8))}</span>
              )}
            </button>
          );
        })}
      </div>

      {day && (
        <ListHead
          title={new Date(`${day.day}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' })}
          km={day.km}
          count={day.runs.length}
        />
      )}
      <RunRows runs={day?.runs.slice().reverse() ?? []} loading={loading} empty={t('runsNoneInMonth')} />
    </>
  );
}

function ListHead({ title, km, count }: { title: string; km: number; count: number }) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  return (
    <div className="mt-4 mb-1 flex items-baseline justify-between">
      <h3 className="text-base font-bold text-ink-700">{title}</h3>
      <p className="text-xs font-light text-ink-400">
        <bdi dir="ltr" className="tabular-nums">{km}</bdi> {tc('km')} · {t('runsCount', { count })}
      </p>
    </div>
  );
}

function RunRows({ runs, loading, empty }: { runs: RangeRun[]; loading: boolean; empty: string }) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const locale = useLocale();
  const prRuns = usePrRuns();
  if (loading) return <p className="py-4 text-center text-sm font-light text-ink-400">…</p>;
  if (runs.length === 0) return <p className="py-3 text-sm font-light text-ink-400">{empty}</p>;
  return (
    <ul className="divide-y divide-page">
      {runs.map((r) => {
        const body = (
          <>
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-page">
              {r.routePreview && r.routePreview.length > 2 ? (
                <RouteMinimap points={r.routePreview} width={56} height={56} className="h-full w-full" />
              ) : (
                <Route className="absolute inset-0 m-auto h-5 w-5 text-ink-300" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink-700" dir="auto">{r.name || t('tabRuns')}</p>
              <p className="text-xs font-light text-ink-400">
                {new Date(r.startTime).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                {r.paceSecPerKm != null && (
                  <>
                    {' · '}
                    <bdi dir="ltr" className="tabular-nums">{formatPace(r.paceSecPerKm)}</bdi>
                  </>
                )}
              </p>
              {r.id && prRuns.get(r.id) && <div className="mt-1"><PrBadge buckets={prRuns.get(r.id)} /></div>}
            </div>
            <p className="shrink-0 text-sm font-bold tabular-nums text-brand-600">
              <bdi dir="ltr">{r.km}</bdi> <span className="text-xs font-light text-ink-400">{tc('km')}</span>
            </p>
          </>
        );
        return (
          <li key={r.id ?? r.startTime}>
            {r.id ? (
              <Link href={`/dashboard/activities/${r.id}`} className="flex items-center gap-3 py-2.5">{body}</Link>
            ) : (
              <div className="flex items-center gap-3 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function dm(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}
