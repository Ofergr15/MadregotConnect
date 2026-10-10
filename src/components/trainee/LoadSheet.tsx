'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Sheet } from '@/components/ui/Sheet';
import { useApi } from '@/lib/api';
import type { LoadPart, LoadSource } from '@/lib/academy/load';
import { C, RICH, Tag, clock, dm, km, monthName } from './ui';

// ── 5ב: what ⚡ means, for THIS number (mockup trainee-experience-v2, phone 5ב) ─────────
//
// One sentence what it is, one line how it is computed, what this number was made of, and
// which test the threshold came from. The same sheet opens from every ⚡ in the app: a run
// that happened (`activityId` — /api/academy/activity-load prices it, with the parts that
// sum to the number) or a workout still ahead (`planned`, the parts of the plan).

/** One hour at threshold = 100, so a load is this many minutes at threshold. */
export const MINUTES_PER_LOAD = 0.6;

const PART_COLOR: Record<string, string> = { warmup: C.easy, cooldown: C.easy, work: C.fast, jog: C.rest, run: C.tempo };

export interface PlannedLoad {
  load: number;
  parts: LoadPart[];
  thresholdSec: number | null;
  basisTestDate: string | null;
}

interface ActivityLoad {
  load: number | null;
  source: LoadSource;
  thresholdSec: number | null;
  basisTestDate: string | null;
  parts: LoadPart[];
}

export function LoadSheet({ open, onOpenChange, athleteId, activityId, planned }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  athleteId: string;
  /** A run that happened. */
  activityId?: string | null;
  /** A workout still ahead. */
  planned?: PlannedLoad | null;
}) {
  const t = useTranslations('trainee.loadSheetUi');
  const tp = useTranslations('trainee.loadSheet');
  const locale = useLocale();
  const { data, error } = useApi<ActivityLoad>(
    open && activityId ? `/api/academy/activity-load?athleteId=${encodeURIComponent(athleteId)}&activityId=${encodeURIComponent(activityId)}` : null,
  );
  const info: ActivityLoad | null = planned
    ? { load: planned.load, source: 'pace', thresholdSec: planned.thresholdSec, basisTestDate: planned.basisTestDate, parts: planned.parts }
    : data ?? null;
  const isPlanned = !!planned;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      bodyClassName="px-[18px] pb-2 pt-1"
      footer={(
        <div className="px-[18px] pb-[max(18px,env(safe-area-inset-bottom))] pt-1">
          <button type="button" onClick={() => onOpenChange(false)} className="flex h-[52px] w-full items-center justify-center rounded-[15px] bg-brand-600 text-[16px] font-extrabold text-white">
            {t('ok')}
          </button>
        </div>
      )}
    >
      <div dir="rtl">
        {!info ? (
          <p className="py-6 text-center text-sm text-ink-400">{error ? t('none') : t('loading')}</p>
        ) : info.load == null ? (
          <p className="py-6 text-center text-sm text-ink-500">{t('none')}</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[20px] font-black text-ink-900">
                {t.rich(isPlanned ? 'titlePlanned' : 'title', { ...RICH, load: info.load })}
              </h2>
              <Tag tone="b">{t.rich('like', { ...RICH, min: Math.round(info.load * MINUTES_PER_LOAD) })}</Tag>
            </div>
            <p className="mt-1.5 text-[14px] leading-normal text-ink-500">{t.rich('what', RICH)}</p>
            <p className="mt-1 text-[14px] leading-normal text-ink-500">{t.rich('how', RICH)}</p>

            {info.parts.length > 0 && (
              <ul className="mt-2.5 flex flex-col gap-0.5">
                {info.parts.map((p, i) => {
                  const kind = p.labelKey.split('.').pop() || 'run';
                  const work = kind === 'work';
                  return (
                    <li key={i} className={`flex min-h-[44px] items-center gap-2.5 rounded-xl px-2.5 ${work ? 'bg-[#F5F6FF]' : ''}`}>
                      <i aria-hidden className="h-3 w-3 shrink-0 rounded" style={{ background: PART_COLOR[kind] ?? C.tempo }} />
                      <b className="w-24 shrink-0 text-[14px] font-extrabold text-ink-900">{t(`word.${kind}` as never)}</b>
                      <span className="min-w-0 truncate text-[12.5px] text-ink-400">
                        {t.rich(`detail.${kind}` as never, {
                          ...RICH,
                          km: km(p.params.km * 1000),
                          pace: clock(p.params.paceSec),
                          count: p.params.count,
                          // A GPS lap reads 1003 m; the plan said 1000.
                          dist: String(Math.round(p.params.distM / 10) * 10),
                          time: clock(p.params.sec),
                        } as never)}
                      </span>
                      <em className="ms-auto whitespace-nowrap text-[12.5px] font-bold not-italic" style={{ color: work ? C.brand : undefined }}>
                        <bdi dir="ltr">{p.load}</bdi>
                      </em>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-2.5 flex min-h-[56px] items-center gap-2.5 rounded-2xl bg-[#F7F7FA] px-3.5">
              <span aria-hidden className="w-6 text-center text-[19px]">🎯</span>
              <div className="min-w-0 flex-1 py-2">
                {info.source === 'hr' ? (
                  <>
                    <b className="block text-[14.5px] font-extrabold text-ink-900">{t('hrTitle')}</b>
                    <small className="mt-px block text-[12.5px] leading-snug text-ink-400">{t('hrSub')}</small>
                  </>
                ) : info.thresholdSec ? (
                  <>
                    <b className="block text-[14.5px] font-extrabold text-ink-900">{t.rich('threshold', { ...RICH, pace: clock(info.thresholdSec) })}</b>
                    <small className="mt-px block text-[12.5px] leading-snug text-ink-400">
                      {info.source === 'pace_avg'
                        ? t('avgSub')
                        : info.basisTestDate
                          ? t.rich(isPlanned ? 'fromTestPlanned' : 'fromTest', { ...RICH, month: monthName(info.basisTestDate, locale), date: dm(info.basisTestDate) })
                          : tp('source.pace')}
                    </small>
                  </>
                ) : (
                  <b className="block text-[14.5px] font-extrabold text-ink-900">{tp(`source.${info.source}` as never)}</b>
                )}
              </div>
            </div>
            {info.source !== 'hr' && <p className="mt-2 text-[12.5px] leading-normal text-ink-500">{t('footnote')}</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
