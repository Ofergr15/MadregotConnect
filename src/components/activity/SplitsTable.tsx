'use client';

import { useTranslations } from 'next-intl';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration, formatPace } from './format';
import type { Split } from './types';

// ─── Splits Table ──────────────────────────────────────────────────────────────

export function SplitsTable({ splits }: { splits: Split[] }) {
  const t = useTranslations('activities');

  if (splits.length === 0) return null;

  const fastest = splits.reduce((min, s) => s.averagePace < min.averagePace ? s : min, splits[0]);
  const slowest = splits.reduce((max, s) => s.averagePace > max.averagePace ? s : max, splits[0]);
  const paceRange = slowest.averagePace - fastest.averagePace || 1;

  return (
    <div>
      <h4 className="text-3xs font-bold uppercase text-ink-400 mb-2 flex items-center gap-1.5">
        <Timer className="h-3 w-3" /> {t('splits')}
      </h4>
      <div className="space-y-1">
        <div className="grid grid-cols-12 gap-2 text-3xs font-semibold uppercase text-ink-400 px-3 pb-1">
          <span className="col-span-1">{t('km')}</span>
          <span className="col-span-4">{t('pace')}</span>
          <span className="col-span-3">{t('duration')}</span>
          <span className="col-span-2">{t('hr')}</span>
          <span className="col-span-2">{t('elevShort')}</span>
        </div>
        {splits.map((split, i) => {
          const isFastest = split.averagePace === fastest.averagePace;
          const isSlowest = split.averagePace === slowest.averagePace;
          const pacePos = 1 - ((split.averagePace - fastest.averagePace) / paceRange);
          return (
            <div key={i} className={cn(
              'grid grid-cols-12 gap-2 items-center px-3 py-2 rounded-lg text-sm',
              isFastest ? 'bg-accent-600/10 border border-accent-600/20' :
              isSlowest ? 'bg-accent-red/5 border border-accent-red/10' : 'bg-page/30'
            )}>
              <span className="col-span-1 text-xs font-bold text-ink-400">{i + 1}</span>
              <div className="col-span-4 flex items-center gap-2">
                <div className="w-16 h-1.5 bg-page rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', isFastest ? 'bg-accent-600' : isSlowest ? 'bg-accent-red' : 'bg-brand-600')}
                    style={{ width: `${Math.max(20, pacePos * 100)}%` }}
                  />
                </div>
                {/* `accent-900`, not `accent-600`. The audit measured the fastest
                  split's pace at 2.47:1 as 14px text — #16a34a scores 3.30:1 on
                  white and this row is a 10% wash of the same green, which pulls it
                  lower still. `accent-900` is the palette's TEXT green and exists
                  for exactly this (see the note on it in tailwind.config.ts); the
                  wash behind it does not change. `accent-red` stays: #AD3838
                  measures 6.18:1 and was never the problem. */}
              <span className={cn('font-bold tabular-nums', isFastest ? 'text-accent-900' : isSlowest ? 'text-accent-red' : 'text-ink-700')}>
                  {formatPace(split.averagePace)}
                </span>
              </div>
              <span className="col-span-3 text-ink-500 tabular-nums">{formatDuration(split.duration)}</span>
              <span className="col-span-2 text-ink-400 tabular-nums">{split.averageHR || '—'}</span>
              {/*
                Climb red, descent green — deliberately the opposite of the
                usual up-is-good reading, so that green means one thing on this
                row and not two: the pace above already uses accent-600 for the
                fastest split and accent-red for the slowest. Both colours now
                say "easier / harder", never "more / less". Same flip lives in
                ElevationChart; change one and change the other.
              */}
              <span className="col-span-2 text-ink-400 tabular-nums">
                {split.elevationGain != null ? <><span className="text-accent-red">+{Math.round(split.elevationGain)}</span>{split.elevationLoss ? <span className="text-accent-900 ms-1">-{Math.round(split.elevationLoss)}</span> : null}</> : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
