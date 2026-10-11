'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SkeletonList } from '@/components/ui';
import { shiftDate } from '@/lib/academy/load';
import { sortReadiness, type ReadinessSort } from '@/lib/academy/readiness';
import type { ReadinessAlert, ReadinessListResponse, ReadinessRow } from '@/lib/academy/readiness-board';
import { CARD, Segmented, StructureText, TOP_BAR, weekdayOf } from '@/components/trainee/ui';
import { FitnessSpark } from './FitnessSpark';
import { FormChip, M, MB, SPARK_COLOR } from './shared';

// ── מוכנות המתאמנים (trainee-experience-v2 C1, TP Coach: Home) ──────────────────────────
//
// Who needs me this week. One alert on top — the most tired trainee the pace gate holds,
// with the two things to do about it (an easy week, a message). Then every trainee in one
// row: initials, name, the ONE fact that stands out, fitness over 7 weeks as a spark (oldest
// left, so climbing toward the dot is building), and form as a number and a word in the
// band's colour — the trainee's own words and colours (form-bands.ts). Everything else (RHR,
// the week's sessions) is one tap away, in the trainee's sheet (C2).
//
// GET /api/academy/readiness, scoped by the server exactly as the coach tools are.

export function ReadinessBoard({ scope, heldIds, onOpen, onLightWeek, onWrite, topBar }: {
  /** `scope=coach` for a manager's coach view. */
  scope: string;
  /** Trainees whose pace-up suggestion the coach tools hold right now (the alert says so). */
  heldIds?: ReadonlySet<string>;
  onOpen: (row: ReadinessRow) => void;
  onLightWeek: (athleteId: string) => void;
  onWrite: (athleteId: string) => void;
  /**
   * On a phone the title row is the screen's top bar (the shell folds the header, the areas
   * bar and the sub-tabs): the way back to the academy home at the start, search at the end.
   */
  topBar?: { onBack: () => void; search: ReactNode; backLabel: string };
}) {
  const t = useTranslations('readiness');
  const { data, error } = useApi<ReadinessListResponse>(`/api/academy/readiness${scope ? `?${scope}` : ''}`);
  const [sort, setSort] = useState<ReadinessSort>('tired');
  const rows = useMemo(() => (data ? sortReadiness(data.rows, sort) : []), [data, sort]);

  if (!data) return error ? <p className="py-8 text-center text-sm text-ink-400">{t('error')}</p> : <SkeletonList count={4} />;

  return (
    <div className="flex flex-col gap-2.5" dir="rtl">
      {topBar ? (
        <div className={cn('relative flex items-center justify-between', TOP_BAR)}>
          <button type="button" onClick={topBar.onBack} aria-label={topBar.backLabel}
            className="grid h-11 w-11 place-items-center rounded-full text-brand-600 md:invisible">
            <ChevronRight className="h-6 w-6" />
          </button>
          <h2 className="text-[17px] font-extrabold text-ink-900">{t.rich('title', { ...M, n: data.rows.length })}</h2>
          <span className="md:invisible">{topBar.search}</span>
        </div>
      ) : (
        <h2 className="text-center text-[17px] font-extrabold text-ink-900">{t.rich('title', { ...M, n: data.rows.length })}</h2>
      )}

      {data.alert && (
        <AlertCard alert={data.alert} held={!!heldIds?.has(data.alert.athleteId)} onLightWeek={onLightWeek} onWrite={onWrite} />
      )}

      {rows.length > 0 ? (
        <>
          <Segmented value={sort} onChange={setSort} label={t('sort.label')}
            options={(['tired', 'week', 'name'] as const).map(v => ({ value: v, label: t(`sort.${v}`) }))} />
          <div className="flex items-baseline justify-between gap-2 px-1">
            <span className="text-[12.5px] font-bold text-ink-400">{t.rich('caption', M)}</span>
            <span className="text-[12.5px] font-bold text-ink-400">{t('captionForm')}</span>
          </div>
          <div className={cn(CARD, 'overflow-hidden')}>
            {rows.map(r => <Row key={r.athleteId} row={r} today={data.today} onOpen={() => onOpen(r)} />)}
          </div>
        </>
      ) : (
        <p className={cn(CARD, 'px-4 py-6 text-center text-sm text-ink-400')}>{t('empty')}</p>
      )}
    </div>
  );
}

function AlertCard({ alert, held, onLightWeek, onWrite }: {
  alert: ReadinessAlert;
  held: boolean;
  onLightWeek: (id: string) => void;
  onWrite: (id: string) => void;
}) {
  const t = useTranslations('readiness.alert');
  const gender = alert.gender ?? 'other';
  const first = alert.name.split(' ')[0] || alert.name;
  const both = alert.reasons.includes('veryTired') && alert.reasons.includes('rhr');
  const key = both ? 'both' : alert.reasons.includes('veryTired') ? 'veryTired' : 'rhr';
  return (
    <section className="rounded-[18px] bg-[#FDE7E5] px-3.5 py-3" role="alert">
      <b className="block text-[14.5px] font-black leading-snug text-ink-900">
        {t.rich(key, { ...MB, name: first, gender, n: Math.max(3, alert.aboveRun) })}
      </b>
      <p className="mt-0.5 text-[13px] leading-[1.45] text-ink-500">{held ? t('held', { gender }) : t('plain')}</p>
      <div className="mt-[9px] flex gap-2">
        <button type="button" onClick={() => onLightWeek(alert.athleteId)}
          className="flex h-11 flex-1 items-center justify-center rounded-[13px] bg-brand-600 text-[14.5px] font-extrabold text-white">
          {t('light')}
        </button>
        <button type="button" onClick={() => onWrite(alert.athleteId)}
          className="flex h-11 flex-1 items-center justify-center rounded-[13px] bg-white text-[14.5px] font-extrabold text-brand-600 shadow-[0_1px_2px_rgba(20,22,40,.04),0_6px_18px_rgba(20,22,40,.06)]">
          {t('write', { gender })}
        </button>
      </div>
    </section>
  );
}

function Row({ row, today, onOpen }: { row: ReadinessRow; today: string; onOpen: () => void }) {
  const t = useTranslations('readiness');
  const band = row.form != null && row.bandKey ? row.bandKey : 'none';
  return (
    <button type="button" onClick={onOpen}
      aria-label={t('row', { name: row.name, form: row.form != null ? String(row.form) : '—' })}
      className="flex min-h-[62px] w-full items-center gap-2.5 border-b border-[#EFEFF4] px-3 text-start last:border-0 active:bg-[#F7F7FA]">
      <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-[#DFE2FF] text-[12px] font-black text-brand-600" dir="ltr">
        {row.initials}
      </span>
      <span className="min-w-0 flex-1 py-2">
        <b className="block truncate text-[14.5px] font-extrabold text-ink-900"><bdi>{row.name}</bdi></b>
        <small className="block text-[12px] leading-[1.35] text-ink-400"><HighlightLine row={row} today={today} /></small>
      </span>
      <FitnessSpark values={row.spark} color={SPARK_COLOR[band]} label={t('sparkAria')} />
      <FormChip form={row.form} bandKey={row.bandKey} status={row.status} gender={row.gender} />
    </button>
  );
}

/** The ONE fact (readiness.ts `readinessHighlight`), or the week's sessions when nothing stands out. */
export function HighlightLine({ row, today }: { row: Pick<ReadinessRow, 'highlight' | 'gender' | 'weekDone' | 'weekPlanned'>; today: string }) {
  const t = useTranslations('readiness.highlight');
  const tw = useTranslations('readiness.when');
  const h = row.highlight;
  const gender = row.gender ?? 'other';
  switch (h.kind) {
    case 'noFeed':
      return <>{h.feed === 'failed' ? t('noFeedFailed', { provider: h.provider }) : t.rich('noFeedStale', { ...M, provider: h.provider, n: h.days ?? 0 })}</>;
    case 'pain':
      return <>{t.rich('pain', { ...M, when: h.when, n: h.days })}</>;
    case 'veryTiredRhr':
      return <>{t('veryTiredRhr', { gender })}</>;
    case 'rampTooFast':
      return <>{t.rich('rampTooFast', { ...M, n: h.ramp })}</>;
    case 'pr':
      return <>{t.rich(`pr.${h.bucket}` as never, { ...M, when: tw(h.when) } as never)}</>;
    case 'race': {
      const when = h.daysLeft === 0 ? tw('today') : h.daysLeft === 1 ? tw('tomorrow') : h.daysLeft >= 7 ? tw('week') : tw(weekdayOf(shiftDate(today, h.daysLeft)));
      return h.name
        ? <>{t.rich('race', { ...M, race: h.name, when, s: () => <StructureText text={h.name!} /> })}</>
        : <>{t('raceUnnamed', { when })}</>;
    }
    case 'noRun':
      return <>{t.rich('noRun', { ...M, n: h.days, gender })}</>;
    default:
      return row.weekPlanned > 0
        ? <>{t.rich('week', { ...M, done: row.weekDone, planned: row.weekPlanned })}</>
        : <>{t('weekNone')}</>;
  }
}
