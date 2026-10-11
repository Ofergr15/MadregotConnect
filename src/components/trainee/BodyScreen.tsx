'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { SkeletonList } from '@/components/ui';
import type { BodyMetric, BodyPayload, MetricPanel } from '@/lib/academy/body';
import { fmtSleep, isLearning, verdictKey } from '@/lib/academy/normal-range';
import { FACES } from './FeelAndTalk';
import { missingText } from './BodyChips';
import { RangeChart } from './RangeChart';
import { C, CARD, RICH, Segmented, Tag, dm } from './ui';

// ── הגוף (trainee-experience-v2 screen 8, TP's Health Insights) ─────────────────────────
//
// What the body says, in three rows: this morning's resting HR and last night's sleep,
// each against the trainee's OWN normal range ("הטווח הרגיל שלך 46–50"), and how the last
// four runs felt — the feel they filled in after each run, finally shown back to them.
// One chart, for whatever stands out today (the server picks; the control switches), with
// the range as the green band. Under the resting-HR chart, the one sentence of the
// 3-morning rule. Nothing to fill in: it all comes from the watch.
//
// A morning not synced yet is not "this morning": the newest stored one is named by its date.

type BodyResponse = BodyPayload & { today: string; source?: 'garmin' | 'none' };

export function BodyScreen({ athleteId, coachName }: { athleteId: string; coachName: string | null }) {
  const t = useTranslations('trainee.body');
  const tt = useTranslations();
  const { data, error } = useApi<BodyResponse>(`/api/academy/body?athleteId=${encodeURIComponent(athleteId)}`);
  const [metric, setMetric] = useState<BodyMetric | null>(null);
  useEffect(() => { if (data && !metric) setMetric(data.featured); }, [data, metric]);

  if (!data) return error ? <p className="py-8 text-center text-sm text-ink-400">{t('noNights')}</p> : <SkeletonList count={4} />;
  const shown = metric ?? data.featured;
  const coach = coachName || t('advice.coach');

  const rangeText = (p: MetricPanel, kind: 'rhr' | 'sleep') => {
    if (isLearning(p.range)) return null;
    return kind === 'sleep'
      ? `${fmtSleep(p.range.lo)}–${fmtSleep(p.range.hi)}`
      : `${Math.round(p.range.lo)}–${Math.round(p.range.hi)}`;
  };

  const panelRow = (kind: 'rhr' | 'sleep') => {
    const p = data[kind];
    const range = rangeText(p, kind);
    const value = p.latest ? (kind === 'sleep' ? fmtSleep(p.latest.value) : String(p.latest.value)) : null;
    const bad = kind === 'rhr' ? p.verdict === 'bitHigh' || p.verdict === 'high' : p.verdict === 'less' || p.verdict === 'veryLittle';
    // What is missing, and what will bring it — never "no data yet" forever.
    const why = p.missing ? missingText(tt, kind, p.missing) : null;
    return (
      <Row emoji={kind === 'rhr' ? '❤️' : '😴'}
        title={value ? t.rich(kind, { ...RICH, n: value, v: value }) : t(`${kind}None`)}
        sub={why && (!p.latest || p.missing?.reason !== 'old') ? <>{why.title}{why.sub && <> · {why.sub}</>}</> : !p.latest ? t('noNights') : (
          <>
            {p.isToday ? t(kind === 'rhr' ? 'rhrToday' : 'sleepToday') : t.rich('ofDate', { ...RICH, date: dm(p.latest.date) })}
            {' · '}
            {range ? t.rich('yours', { ...RICH, range }) : tt.rich('trainee.range.learning', { ...RICH, n: (p.range as { learning: number }).learning })}
          </>
        )}
        tag={p.verdict ? <Tag tone={bad ? 'w' : 'g'}>{tt(verdictKey(kind, p.verdict) as never)}</Tag> : null} />
    );
  };

  return (
    <div className="flex flex-col gap-2.5" dir="rtl">
      <div className={cn(CARD, 'overflow-hidden')}>
        {panelRow('rhr')}
        {panelRow('sleep')}
        {data.feel ? (
          <Row emoji="🙂"
            title={t('feel', { word: tt(`trainee.feel.faces.${data.feel.face}` as never) })}
            sub={<>{t.rich('feelSub', { ...RICH, n: data.feel.n })}{data.feel.effort != null && t.rich('effort', { ...RICH, v: String(data.feel.effort) })}</>}
            tag={data.feel.face <= 1 ? <Tag tone="w">{t('feelLow')}</Tag> : <Tag tone="g">✓</Tag>} />
        ) : (
          <Row emoji="🙂" title={t('feelNone')} sub={t('feelNoneSub')} tag={null} />
        )}
      </div>

      <Segmented value={shown} onChange={setMetric} label={t('seg.label')}
        options={(['rhr', 'sleep', 'feel'] as const).map(v => ({ value: v, label: t(`seg.${v}`) }))} />

      {shown !== 'feel' ? (
        <div className={cn(CARD, 'px-4 py-3.5')}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[15px] font-extrabold text-ink-900">{t.rich(`chart.${shown}`, RICH)}</span>
            <span className="text-[12.5px] font-bold text-ink-400">{t('todayRight')}</span>
          </div>
          {data[shown].series.length ? (
            <>
              <div className="mt-2"><RangeChart panel={data[shown]} kind={shown} today={data.today} /></div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-500">
                {rangeText(data[shown], shown) && (
                  <span className="flex items-center gap-[5px]">
                    <i aria-hidden className="inline-block h-2.5 w-4 rounded-[3px] border border-[#9AD5B0]" style={{ background: C.goodBg }} />
                    {t.rich('legend.range', { ...RICH, range: rangeText(data[shown], shown)! })}
                  </span>
                )}
                <span className="flex items-center gap-[5px]"><i aria-hidden className="inline-block h-[7px] w-[7px] rounded-full bg-[#9A9BA6]" />{t(shown === 'rhr' ? 'legend.rhrDot' : 'legend.sleepDot')}</span>
                <span className="flex items-center gap-[5px]"><i aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: C.org }} />{t(shown === 'rhr' ? 'legend.rhrOut' : 'legend.sleepOut')}</span>
              </div>
            </>
          ) : (
            <p className="mt-2 text-13 text-ink-400">
              {data[shown].missing ? missingText(tt, shown, data[shown].missing!).title : t('noNights')}
            </p>
          )}
        </div>
      ) : (
        <div className={cn(CARD, 'px-4 py-3.5')}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[15px] font-extrabold text-ink-900">{t.rich('chart.feel', { ...RICH, n: data.feel?.n ?? 0 })}</span>
            <span className="text-[12.5px] font-bold text-ink-400">{t('oldLeft')}</span>
          </div>
          {data.feel ? (
            // Oldest left, like every timeline here — the newest answer is on the right.
            <div dir="ltr" className="mt-2 flex gap-1.5">
              {data.feel.recent.map((f, i) => (
                <div key={`${f.date}${i}`} className={cn('flex min-h-[56px] flex-1 flex-col items-center justify-center rounded-[14px] bg-[#F5F5F8] py-1.5', i === data.feel!.recent.length - 1 && 'outline outline-2 outline-brand-600')}>
                  <span aria-hidden className="text-[24px] leading-none">{FACES[f.feel]}</span>
                  <small dir="rtl" className="mt-1 text-[10.5px] font-bold text-ink-400">{tt(`trainee.feel.faces.${f.feel}` as never)}</small>
                  <small className="text-[10.5px] text-ink-400"><bdi dir="ltr">{dm(f.date)}</bdi>{f.difficulty != null && <> · <bdi dir="ltr">{f.difficulty}/10</bdi></>}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-13 text-ink-400">{t('feelNoneSub')}</p>
          )}
        </div>
      )}

      {shown === 'rhr' && data.rhr.advice && (
        <div className={cn(CARD, 'flex items-start gap-[11px] px-4 py-3.5')}>
          <span aria-hidden className="text-[20px]">💡</span>
          <p className="text-[13.5px] leading-normal text-ink-500">{t.rich(`advice.${data.rhr.advice}`, { ...RICH, coach })}</p>
        </div>
      )}

      {/* Where the nights come from — said only when it is true (Garmin connected and sending). */}
      <p className="text-center text-[12.5px] font-bold text-ink-400">
        {data.source === 'none' ? tt('trainee.home.body.missing.noGarmin')
          : data.rhr.missing?.reason === 'feed' ? missingText(tt, 'rhr', data.rhr.missing).title
            : data.rhr.missing?.reason === 'neverWorn' ? `${tt('trainee.home.body.missing.neverWorn')}. ${tt('trainee.home.body.missing.neverWornSub')}`
              : t('footer')}
      </p>
    </div>
  );
}

function Row({ emoji, title, sub, tag }: { emoji: string; title: ReactNode; sub: ReactNode; tag: ReactNode }) {
  return (
    <div className="flex min-h-[56px] items-center gap-[11px] border-b border-[#EFEFF4] px-3.5 last:border-0">
      <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">{emoji}</span>
      <span className="min-w-0 flex-1 py-[9px]">
        <b className="block text-[14.5px] font-extrabold text-ink-900">{title}</b>
        <small className="mt-px block text-[12.5px] leading-snug text-ink-400">{sub}</small>
      </span>
      {tag}
    </div>
  );
}
