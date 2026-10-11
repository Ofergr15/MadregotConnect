'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { olderTests, type FinderResult, type TestCandidate } from '@/lib/academy/test-finder';
import { Sheet } from '@/components/ui';
import { clock, km } from '@/components/trainee/ui';
import { CARD, PrimaryButton } from '../book/ui';
import { shortDay } from './shared';

// ── "למשוך מהשעון" (mockup academy-existing-trainees, phone 3) ──────────────────────────
//
// The runs of the last six months that look like a test (lib/academy/test-finder.ts), up to
// three, the likeliest first and preselected. Choosing one fills the form; the older ones of
// the same protocol can ride along as past tests, so the improvement graph has a history from
// the first day. Nothing is saved here — the form's own save posts them.

type WatchResponse = FinderResult & { windowDays: number; recorded: string[] };

export function WatchTestSheet({ athleteId, open, onOpenChange, onPick }: {
  athleteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (chosen: TestCandidate, older: TestCandidate[]) => void;
}) {
  const t = useTranslations('completion.watch');
  const { data, error } = useApi<WatchResponse>(open ? `/api/academy/tests/watch?athleteId=${encodeURIComponent(athleteId)}` : null);
  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [keepOlder, setKeepOlder] = useState(true);
  useEffect(() => { if (candidates.length && !chosen) setChosen(candidates[0].activityId); }, [candidates, chosen]);
  useEffect(() => { if (!open) setChosen(null); }, [open]);

  const pick = candidates.find(c => c.activityId === chosen) ?? null;
  const older = pick ? olderTests(candidates, pick.activityId) : [];

  const sub = (c: TestCandidate) => {
    const m = (x: React.ReactNode) => <bdi dir="ltr">{x}</bdi>;
    if (c.protocol === '2000m') return t.rich('sub2000', { time: clock(c.durationSec), m });
    if (c.insideLonger) return t.rich('subInside', { km: km(c.runDistanceM), m });
    return c.avgHr
      ? t.rich('subHr', { time: '30:00', km: (c.distanceM / 1000).toFixed(2), hr: c.avgHr, m })
      : t.rich('sub', { time: '30:00', km: (c.distanceM / 1000).toFixed(2), m });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      titleClassName="text-start text-[22px] font-black"
      footer={pick ? (
        <div className="px-4 pb-3 pt-1">
          <PrimaryButton className="w-full" onClick={() => { onPick(pick, keepOlder ? older : []); onOpenChange(false); }}>
            {t.rich('take', { date: shortDay(pick.date), pace: clock(pick.paceSec), m: (c) => <bdi dir="ltr">{c}</bdi> })}
          </PrimaryButton>
        </div>
      ) : undefined}
    >
      <div className="space-y-3" dir="rtl">
        <p className="text-[14.5px] leading-snug text-ink-500">{t.rich('intro', { n: Math.round((data?.windowDays ?? 183) / 30.5), m: (c) => <bdi dir="ltr">{c}</bdi> })}</p>

        {!data && !error && <div className="h-[180px] animate-pulse rounded-[22px] bg-page/60" aria-busy="true" />}
        {error && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">{t('error')}</p>}

        {data && candidates.length === 0 && (
          <p className={cn(CARD, 'px-4 py-4 text-[15px] leading-snug text-ink-700')}>
            {t(`empty.${data.emptyReason ?? 'none'}`)}
          </p>
        )}

        {candidates.length > 0 && (
          <div className={cn(CARD, 'overflow-hidden')} role="radiogroup" aria-label={t('title')}>
            {candidates.map((c) => {
              const on = chosen === c.activityId;
              const saved = data?.recorded.includes(`${c.date}:${c.protocol}`);
              return (
                <button key={c.activityId} type="button" role="radio" aria-checked={on} onClick={() => setChosen(c.activityId)}
                  className="flex min-h-[64px] w-full items-center gap-3 border-b border-[#EFEFF4] px-4 py-2.5 text-start last:border-0">
                  <span aria-hidden className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2', on ? 'border-brand-600 bg-brand-600' : 'border-ink-300')}>
                    {on && <i className="block h-2.5 w-2.5 rounded-full bg-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[16px] font-extrabold text-ink-900">
                      <bdi dir="ltr">{shortDay(c.date)}</bdi> · {c.kind !== 'segment' ? <bdi>&quot;{c.name}&quot;</bdi> : c.name ? <bdi>{c.name}</bdi> : t('unnamed')}
                    </b>
                    <small className="mt-0.5 block truncate text-[13.5px] text-ink-400">
                      {sub(c)}{saved && <> · {t('saved')}</>}
                    </small>
                  </span>
                  <b className="shrink-0 text-[18px] font-black tabular-nums text-ink-900"><bdi dir="ltr">{clock(c.paceSec)}</bdi></b>
                </button>
              );
            })}
          </div>
        )}

        {older.length > 0 && (
          <label className="flex min-h-[44px] items-start gap-2.5 px-1 text-[14px] leading-snug text-ink-500">
            <input type="checkbox" checked={keepOlder} onChange={(e) => setKeepOlder(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" />
            <span>{t.rich('older', { n: older.length, m: (c) => <bdi dir="ltr">{c}</bdi> })}</span>
          </label>
        )}

        {!!data?.noLaps && candidates.length > 0 && (
          <p className="px-1 text-[13px] leading-snug text-ink-400">
            {t.rich(data.stravaNoLaps ? 'noLapsStrava' : 'noLaps', { n: data.noLaps, m: (c) => <bdi dir="ltr">{c}</bdi> })}
          </p>
        )}
      </div>
    </Sheet>
  );
}
