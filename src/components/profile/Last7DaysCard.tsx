'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  formatReportHours, formatReportPace,
  type Last7Report,
} from '@/lib/reports/last-7-days';

/**
 * The seven-day report card — the screen behind the Saturday 18:00 push.
 *
 * Same numbers, same window, same builder as that push (`buildLast7Report`), which
 * is the point of it living on the profile: the notification is the headline and
 * this is where it lands. It is NOT the week view; the window rolls (see
 * lib/reports/last-7-days.ts), so it deliberately disagrees with "this week"
 * beside it and says which seven days it means in its own subtitle.
 *
 * `dir="ltr"` on the columns for the same reason TenWeekChart does it: the days
 * are oldest-first, and RTL flow would put the oldest day on the right and run
 * time backwards. A time axis reads left-to-right in Hebrew too.
 *
 * One colour for every day, on his call ("i want same color all days"): a
 * highlighted best day turns a plain record of the week into a verdict on it.
 */
export function Last7DaysCard({ report }: { report: Last7Report }) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const dayNames = tc.raw('dayNamesShort') as string[];

  const peak = Math.max(...report.days.map((d) => d.km), 1);
  const fd = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  return (
    <section className="rounded-card bg-card p-4">
      <div className="flex items-end justify-between gap-2">
        <h2 className="text-xl font-bold text-ink-700">{t('last7Title')}</h2>
        <p className="text-xs font-light text-ink-400 tabular-nums">
          <bdi dir="ltr">{fd(report.from)} – {fd(report.to)}</bdi>
        </p>
      </div>

      {report.runs === 0 ? (
        <p className="mt-3 text-sm font-light text-ink-400">{t('last7Empty')}</p>
      ) : (
        <>
          <div dir="ltr" className="mt-3 flex h-[104px] items-end justify-center gap-1.5">
            {report.days.map((d) => (
              <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-end justify-end">
                <span className="mb-1 w-full text-center text-4xs font-bold tabular-nums text-ink-400">
                  {d.km > 0 ? Math.round(d.km) : ''}
                </span>
                <div
                  className={cn('w-full rounded-t-[3px]', d.km > 0 ? 'bg-brand-600' : 'bg-ink-300/40')}
                  // Floor of 3px so a rest day is a baseline tick, not a hole that
                  // reads as missing data — the same floor as the ten-week chart.
                  style={{ height: `${Math.max(3, Math.round((d.km / peak) * 68))}px` }}
                />
                <span className="mt-1 w-full text-center text-4xs font-light text-ink-400">
                  {dayNames[d.weekday]}
                </span>
              </div>
            ))}
          </div>

          {/* The four totals the push also quotes, in the push's own order. */}
          <div className="mt-3 grid grid-cols-4 gap-1 border-t border-page pt-3">
            <Total value={String(Math.round(report.km * 10) / 10)} label={t('last7Km')} />
            <Total value={formatReportHours(report.seconds)} label={t('last7Hours')} />
            <Total
              value={report.paceSeconds ? formatReportPace(report.paceSeconds) : '–'}
              label={t('last7Pace')}
            />
            <Total value={String(report.runs)} label={t('last7Runs')} />
          </div>
        </>
      )}
    </section>
  );
}

function Total({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      {/* bdi so a pace's colon and an hours value keep their digits in order
          inside an RTL paragraph — same reason as everywhere else in the app. */}
      <span className="block text-lg font-bold tabular-nums text-ink-700">
        <bdi dir="ltr">{value}</bdi>
      </span>
      <span className="block text-4xs font-light text-ink-400">{label}</span>
    </div>
  );
}
