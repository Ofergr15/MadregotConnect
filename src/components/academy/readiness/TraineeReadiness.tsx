'use client';

import { useNoNumberText } from '@/components/trainee/NoNumberCard';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formBand, signed } from '@/lib/academy/form-bands';
import { fmtSleep } from '@/lib/academy/normal-range';
import type { Metric } from '@/lib/academy/progress';
import type { ReadinessDetailResponse } from '@/lib/academy/readiness-board';
import type { PaceSuggestionPayload } from '@/lib/academy/coach-tools-payload';
import { BarButton, FlowOverlay, FlowScreen, PrimaryButton, clockText } from '../book/ui';
import { MetricTiles } from '@/components/trainee/ProgressScreen';
import { MetricSheet } from '@/components/trainee/MetricSheet';
import { FAT, FIT, FitnessChart } from '@/components/trainee/FitnessChart';
import { CARD, Tag, dm } from '@/components/trainee/ui';
import { missingText } from '@/components/trainee/BodyChips';
import { GateSentence, M, MB, useReasonsText } from './shared';

// ── מתאמן אחד (trainee-experience-v2 C2, TP Coach: PMC + future) ────────────────────────
//
// "Does the week I planned suit them": the trainee's own three numbers (the progress
// screen's tiles, each a tap into 7ב), 8 weeks of fitness and fatigue with what is planned
// continuing as dashed lines in a zone to the RIGHT of today, and ONE sentence about where
// that leaves form at the end of next week. Then how the last runs felt, the body against
// its range, and the pace suggestion — with the gate said out loud, or held with why.
//
// GET /api/academy/readiness?athleteId (staff on the 1:1 line). The approve button opens
// the shipped PaceSuggestionScreen with the very suggestion the home lists.

export function TraineeReadiness({ athleteId, name, onClose, onApprove }: {
  athleteId: string;
  /** Shown in the bar while the sheet loads. */
  name: string;
  onClose: () => void;
  onApprove: (suggestion: PaceSuggestionPayload) => void;
}) {
  const t = useTranslations('readiness.detail');
  const { data, error } = useApi<ReadinessDetailResponse>(`/api/academy/readiness?athleteId=${encodeURIComponent(athleteId)}`);
  const [metric, setMetric] = useState<Metric>('form');
  const [sheet, setSheet] = useState(false);
  const shown = data?.name || name;
  const sug = data?.pace.suggestion ?? null;

  return (
    <FlowOverlay label={shown}>
      <FlowScreen
        className="gap-2.5 px-4 pt-3.5"
        title={<bdi>{shown}</bdi>}
        leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />{t('back')}</BarButton>}
        footer={sug && !data?.pace.held ? <PrimaryButton onClick={() => onApprove(sug)}>{t('approve')}</PrimaryButton> : undefined}
      >
        {!data ? (
          <p className="py-10 text-center text-sm text-ink-400">{error ? <ErrorText /> : '…'}</p>
        ) : (
          <Body data={data} onMetric={(m) => { setMetric(m); setSheet(true); }} />
        )}
      </FlowScreen>
      {data?.numbers && (
        <MetricSheet open={sheet} onOpenChange={setSheet} metric={metric} gender={data.gender ?? 'other'}
          numbers={{ fitness: data.numbers.fitness, fatigue: data.numbers.fatigue, form: data.numbers.form, ramp: data.numbers.ramp }} />
      )}
    </FlowOverlay>
  );
}

function ErrorText() {
  const t = useTranslations('readiness');
  return <>{t('error')}</>;
}

function Body({ data, onMetric }: { data: ReadinessDetailResponse; onMetric: (m: Metric) => void }) {
  const t = useTranslations('readiness.detail');
  const tt = useTranslations();
  const tc = useTranslations('readiness.chip');
  const gender = data.gender ?? 'other';
  const n = data.numbers;
  const p = data.projection;
  const reasonsText = useReasonsText();
  // The gate holds the pace-up: the projection never says "יש מקום להוסיף" then.
  const holdReasons = data.pace.gate.paused ? reasonsText(data.pace.gate.reasons, data.gender) : null;

  return (
    <>
      {n ? (
        <MetricTiles numbers={{ ...n, band: n.bandKey }} gender={gender} onOpen={onMetric}
          fitnessSub={t('fitnessSub', { word: tt(`trainee.ramp.${n.rampWordKey}` as never), heavy: n.heavyLastWeek ? 'yes' : 'no' })} />
      ) : (
        <LearningCard status={data.status} />
      )}

      {n && data.series.length > 1 && (
        <div className={cn(CARD, 'px-4 py-3.5')}>
          <div className="flex gap-3 text-[12px] text-ink-500">
            <span className="flex items-center gap-[5px]"><i aria-hidden className="inline-block h-[5px] w-4 rounded-[3px]" style={{ background: FIT }} />{tt('trainee.progress.legend.fitness')}</span>
            <span className="flex items-center gap-[5px]"><i aria-hidden className="inline-block h-[2px] w-4 rounded-[3px]" style={{ background: FAT }} />{tt('trainee.progress.legend.fatigue')}</span>
            {p && <span className="flex items-center gap-[5px]"><i aria-hidden className="inline-block w-4 border-t-2 border-dashed border-ink-400" />{t('legendNext')}</span>}
          </div>
          <div className="mt-1.5">
            <FitnessChart series={data.series} height={104} axis="weeks" projection={p?.series} ariaLabel={t('aria')}
              zoneLabel={p ? t.rich('zone', { ...M, form: signed(p.projectedForm) }) : undefined} />
          </div>
          {p && (
            <p className={cn('mt-1.5 text-[13px] leading-normal', p.verdict === 'warn' ? 'font-bold text-[#A8510A]' : 'text-ink-500')}>
              {t.rich(p.nextWeekLoad == null ? 'say.noPlan' : `say.${p.verdict}`, {
                ...MB, gender, load: p.nextWeekLoad ?? 0, form: signed(p.projectedForm),
                word: tc(formBand(p.projectedForm).key, { gender }), reasons: holdReasons ?? '',
              })}
              {p.nextWeekLoad == null && holdReasons && t.rich('say.holdTail', { ...MB, reasons: holdReasons })}
            </p>
          )}
        </div>
      )}

      <div className={cn(CARD, 'overflow-hidden')}>
        <FeelRow data={data} />
        <BodyRow data={data} />
      </div>

      <PaceCard data={data} />
    </>
  );
}

function FeelRow({ data }: { data: ReadinessDetailResponse }) {
  const t = useTranslations('readiness.detail');
  const tt = useTranslations();
  const f = data.feel;
  // Runs are not arriving: neither "בלי כאב" nor "0 מתוך 5" is known — say what is missing.
  if (data.status.kind === 'noFeed') {
    return (
      <div className="flex min-h-[56px] items-center gap-[11px] border-b border-[#EFEFF4] px-3.5">
        <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">⌚</span>
        <span className="min-w-0 flex-1 py-[9px]">
          <b className="block text-[14.5px] font-extrabold text-ink-900">{t('feelNoFeed', { provider: data.status.provider })}</b>
          <small className="mt-px block text-[12.5px] leading-snug text-ink-400">{t('feelNoFeedSub')}</small>
        </span>
      </div>
    );
  }
  const week = f.weekPlanned > 0 ? <span className="whitespace-nowrap">{t.rich('weekPart', { ...M, done: f.weekDone, planned: f.weekPlanned })}</span> : null;
  const bad = f.pain || (f.face != null && f.face <= 1);
  return (
    <div className="flex min-h-[56px] items-center gap-[11px] border-b border-[#EFEFF4] px-3.5">
      <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">🙂</span>
      <span className="min-w-0 flex-1 py-[9px]">
        {f.face != null ? (
          <>
            <b className="block text-[14.5px] font-extrabold text-ink-900">
              {t.rich('feel', { ...M, word: tt(`trainee.feel.faces.${f.face}` as never), effort: f.effort != null ? String(f.effort) : 'none' })}
            </b>
            <small className="mt-px block text-[12.5px] leading-snug text-ink-400">
              {t.rich('feelSub', { ...M, n: f.n, pain: f.pain ? 'yes' : 'no' })}{week}
            </small>
          </>
        ) : (
          <>
            <b className="block text-[14.5px] font-extrabold text-ink-900">{t('feelNone')}</b>
            <small className="mt-px block text-[12.5px] leading-snug text-ink-400">{t('feelNoneSub', { pain: f.pain ? 'yes' : 'no' })}{week}</small>
          </>
        )}
      </span>
      {(f.face != null || f.pain) && <Tag tone={bad ? 'w' : 'g'}>{bad ? '▼' : '✓'}</Tag>}
    </div>
  );
}

function BodyRow({ data }: { data: ReadinessDetailResponse }) {
  const t = useTranslations('readiness.detail');
  const tt = useTranslations();
  const gender = data.gender ?? 'other';
  const { rhr, sleep } = data.body;
  const sleepText = sleep.last != null ? fmtSleep(sleep.last) : null;
  // Screen 8's rule: a night that is old, cut short or from a connection that stopped is
  // shown with its date and why — never "✓ בתוך הטווח" as if it were this morning.
  const shownMissing = rhr.today != null ? rhr.missing : sleepText ? sleep.missing : (rhr.missing ?? sleep.missing);
  const date = rhr.today != null ? rhr.date : sleepText ? sleep.date : null;
  const why = shownMissing ? missingText(tt, rhr.today != null ? 'rhr' : 'sleep', shownMissing) : null;
  const ofDate = date && date !== data.today ? <>{t.rich('bodyOf', { ...M, date: dm(date) })} · </> : null;
  return (
    <div className="flex min-h-[56px] items-center gap-[11px] px-3.5">
      <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">❤️</span>
      <span className="min-w-0 flex-1 py-[9px]">
        <b className="block text-[14.5px] font-extrabold text-ink-900">
          {rhr.today != null
            ? t.rich('body', { ...M, rhr: rhr.today, sleep: sleepText ?? 'none' })
            : sleepText ? t.rich('bodySleep', { ...M, sleep: sleepText }) : why ? why.title : t('bodyNone')}
        </b>
        {(rhr.today != null || sleepText) ? (
          <small className="mt-px block text-[12.5px] leading-snug text-ink-400">
            {ofDate}
            {why && shownMissing?.reason !== 'old' ? why.title
              : rhr.range ? t.rich('range', { ...M, gender, range: `${rhr.range.lo}–${rhr.range.hi}` }) : t('rangeLearning', { gender })}
          </small>
        ) : why?.sub ? (
          <small className="mt-px block text-[12.5px] leading-snug text-ink-400">{why.sub}</small>
        ) : null}
      </span>
      {rhr.range && rhr.today != null && rhr.judged && (
        rhr.aboveRun > 0
          ? <Tag tone="w">{t.rich('above', { ...M, n: rhr.aboveRun })}</Tag>
          : <Tag tone="g">{t('inside')}</Tag>
      )}
    </div>
  );
}

function PaceCard({ data }: { data: ReadinessDetailResponse }) {
  const t = useTranslations('readiness.detail');
  const tk = useTranslations('academyTools.kindThe');
  const reasonsText = useReasonsText();
  const held = data.pace.held;
  if (held) {
    return (
      <div className="rounded-[20px] bg-[#FDF0E2] px-4 py-3.5">
        <b className="block text-[14.5px] font-extrabold text-ink-900">{t('heldTitle')}</b>
        <p className="mt-0.5 text-[13px] leading-normal text-[#A8510A]">{t('heldSay', { reasons: reasonsText(held, data.gender) })}</p>
      </div>
    );
  }
  const sug = data.pace.suggestion;
  if (!sug) return null;
  const lead = sug.kinds[0];
  const from = sug.current[lead.kind] ?? lead.currentSec;
  const faster = lead.direction === 'faster';
  return (
    <div className="rounded-[20px] bg-[#E5F6EC] px-4 py-3.5">
      <b className="block text-[14.5px] font-extrabold text-ink-900">
        {t.rich(faster ? 'paceTitle' : 'paceTitleSlower', { ...M, kinds: tk(lead.kind), sec: Math.abs(lead.proposedSec) })}
      </b>
      <p className="mt-0.5 text-[13px] leading-normal text-[#0E7A3C]">
        {t.rich('paceFrom', { ...M, to: clockText(from + lead.proposedSec), from: clockText(from) })}{' '}
        {sug.readiness && <GateSentence readiness={sug.readiness} />}
      </p>
    </div>
  );
}

function LearningCard({ status }: { status: ReadinessDetailResponse['status'] }) {
  const noNumber = useNoNumberText();
  if (status.kind === 'ok') return null;
  const text = noNumber(status, 'coach');
  return (
    <div className={cn(CARD, 'px-4 py-3.5')}>
      <p className="text-[16px] font-black text-ink-900">{text.icon} {text.title}</p>
      <p className="mt-1 text-[13px] leading-normal text-ink-500">{text.say}</p>
    </div>
  );
}
