'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn, GROUP_HEX } from '@/lib/utils';
import { reasonText } from '@/lib/day-session/watch-status';
import { Avatar } from '@/components/day-session/WatchSend';
import type { DayCell, PlanWatchStatus, RunnerWeekState } from '@/lib/plans/watch-status';

// The planner's tracking of a week's send (mockup watch-send-next, C3): one bar for the
// week, filters, and per runner a square per day — green on the watch, red not, blue on the
// way. Polls while anyone is still on the way (or while the send itself is running).

/** Numbers inside a Hebrew sentence stay LTR. */
const n = (chunks: ReactNode) => <bdi dir="ltr">{chunks}</bdi>;

const CELL: Record<DayCell, string> = {
  ok: 'bg-[#12A150]', failed: 'bg-[#E5383B]', sending: 'bg-brand-600', waiting: 'bg-[#C27803]', none: 'border-[1.5px] border-dashed border-[#E5E5EB]',
};
const TAG: Record<RunnerWeekState, { text: 'sending' | 'waiting' | 'failed' | null; cls: string }> = {
  ok: { text: null, cls: 'bg-[#E3F6EA] text-[#12A150]' },
  sending: { text: 'sending', cls: 'bg-brand-600/10 text-brand-600' },
  waiting: { text: 'waiting', cls: 'bg-[#FFF4DB] text-[#C27803]' },
  failed: { text: 'failed', cls: 'bg-[#FDEBEB] text-[#E5383B]' },
};

type Filter = 'all' | 'ok' | 'failed' | 'way';

export function usePlanWatch(planId: string | null, weekStart: string, pushing: boolean) {
  const [live, setLive] = useState(true);
  const res = useApi<PlanWatchStatus>(planId ? `/api/plans/watch-status?planId=${planId}&weekStart=${weekStart}` : null, { refreshInterval: live || pushing ? 2000 : 0 });
  const way = (res.data?.runners || []).some((r) => r.state === 'sending');
  useEffect(() => { if (res.data) setLive(way); }, [res.data, way]);
  return { ...res, onTheWay: way || pushing };
}

export function PlanWatchTrack({ data, pushing, busy, onRetry }: { data: PlanWatchStatus; pushing: boolean; busy: boolean; onRetry: (ids: string[]) => void }) {
  const t = useTranslations('planWatch');
  const DAY = t.raw('dayLetters') as string[];
  const [filter, setFilter] = useState<Filter>('all');
  const r = data.runners;
  const full = r.filter((x) => x.state === 'ok' && x.total > 0 && x.ok === x.total).length;
  const failed = r.filter((x) => x.state === 'failed');
  const way = r.filter((x) => x.state === 'sending' || x.state === 'waiting').length;
  const sessionsOk = r.reduce((a, x) => a + x.ok, 0);
  const sessionsAll = r.reduce((a, x) => a + x.total, 0);
  const pct = (n: number) => `${r.length ? (n / r.length) * 100 : 0}%`;
  const rows = r.filter((x) => filter === 'all' || (filter === 'ok' ? x.state === 'ok' : filter === 'failed' ? x.state === 'failed' : x.state === 'sending' || x.state === 'waiting'));

  return (
    <div className="space-y-3" dir="rtl">
      <div className="rounded-2xl bg-page px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <b className="text-[18px] text-ink-900">{t.rich('fullWeek', { full, total: r.length, n })}</b>
          {(pushing || way > 0) && <span className="text-13 text-ink-400">{t('sending')}</span>}
        </div>
        <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-[#E7E7EE]" aria-hidden>
          <span style={{ width: pct(full), background: '#12A150' }} />
          <span style={{ width: pct(failed.length), background: '#E5383B' }} />
        </div>
        <p className="mt-2 text-13 text-ink-500">{t.rich('sessionsOnWatches', { ok: sessionsOk, all: sessionsAll, n })}</p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto" role="tablist">
        {([['all', t('filterAll'), r.length], ['ok', t('filterOk'), r.filter((x) => x.state === 'ok').length], ['failed', t('filterFailed'), failed.length], ['way', t('filterWay'), way]] as const).map(([f, label, count]) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={cn('inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold', filter === f ? 'bg-ink-900 text-white' : 'bg-page text-ink-500')}>
            {label}<span className="text-xs opacity-75"><bdi dir="ltr">{count}</bdi></span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl bg-page">
        {rows.length === 0 && <p className="px-4 py-4 text-center text-sm text-ink-400">{pushing ? t('sending') : t('nobody')}</p>}
        {rows.map((x) => (
          <div key={x.athleteId} className="flex min-h-[66px] items-center gap-3 border-b border-card px-3.5 py-2 last:border-0">
            <Avatar name={x.name} pack={x.pack} />
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[15px] font-semibold text-ink-900">{x.name}</b>
              <span className="mt-1 flex gap-1" aria-label={x.days.map((c, d) => `${DAY[d]}: ${c}`).join(', ')}>
                {x.days.map((c, d) => (
                  <i key={d} className={cn('grid h-5 w-5 place-items-center rounded-md text-2xs font-extrabold not-italic text-white', CELL[c])}>{c === 'none' ? '' : DAY[d]}</i>
                ))}
              </span>
              {x.state === 'failed' && <small className="mt-1 block text-xs text-[#E5383B]">{reasonText(x.error)}</small>}
            </span>
            {x.state === 'ok' && x.total > 0
              ? <span className={cn('whitespace-nowrap rounded-lg px-2 py-1 text-xs font-bold', TAG.ok.cls)}>✓ <bdi dir="ltr">{x.ok}/{x.total}</bdi></span>
              : <span className={cn('whitespace-nowrap rounded-lg px-2 py-1 text-xs font-bold', TAG[x.state].cls)}>{TAG[x.state].text ? t(TAG[x.state].text!) : '✓'}</span>}
            {x.state === 'failed' && (
              <button type="button" disabled={busy} onClick={() => onRetry([x.athleteId])} className="min-h-[44px] px-1 text-sm font-bold text-brand-600">{t('retryOne')}</button>
            )}
          </div>
        ))}
      </div>

      {data.noWatch.length > 0 && (
        <p className="px-1 text-13 leading-normal text-ink-400">{t('noWatch', { names: data.noWatch.map((p) => p.name).join(', ') })}</p>
      )}
      {failed.length > 0 && !pushing && (
        <button type="button" disabled={busy} onClick={() => onRetry(failed.map((x) => x.athleteId))}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-page text-base font-extrabold text-ink-900">
          {t.rich('retryFailed', { count: failed.length, n })}
        </button>
      )}
    </div>
  );
}
