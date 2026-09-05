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
                <span className={cn('font-bold tabular-nums', isFastest ? 'text-accent-600' : isSlowest ? 'text-accent-red' : 'text-ink-700')}>
                  {formatPace(split.averagePace)}
                </span>
              </div>
              <span className="col-span-3 text-ink-500 tabular-nums">{formatDuration(split.duration)}</span>
              <span className="col-span-2 text-ink-400 tabular-nums">{split.averageHR || '—'}</span>
              <span className="col-span-2 text-ink-400 tabular-nums">
                {split.elevationGain != null ? <><span className="text-accent-600">+{Math.round(split.elevationGain)}</span>{split.elevationLoss ? <span className="text-accent-red ms-1">-{Math.round(split.elevationLoss)}</span> : null}</> : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
