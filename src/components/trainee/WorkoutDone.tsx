'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { DoneRow, WorkoutResponse } from '@/lib/academy/workout-extras';
import { PR_BUCKETS } from '@/lib/prs/pr-buckets';
import { RepsChart } from './RepsChart';
import { C, CARD, RICH, clock, km, monthName, signedText } from './ui';

// ── 5: did I do what was planned (mockup trainee-experience-v2, phone 5) ───────────────
//
// One verdict line that is always visible, then the plan against what was done with the
// difference (at most five rows), every rep against its watch range, and a medal only
// when there is a real record. The map and the laps are one tap away in the tabs; the ⚡
// row opens 5ב.

function Cell({ row, field }: { row: DoneRow; field: 'planned' | 'done' }) {
  const t = useTranslations('trainee.done');
  const v = row[field];
  if (v == null) return <span />;
  if (row.key === 'hr' && field === 'planned') return <span>{t.rich('hrCap', { ...RICH, bpm: v })}</span>;
  const text = row.key === 'distance' ? km(v) : row.key === 'time' || row.key === 'pace' ? clock(v) : String(v);
  return <bdi dir="ltr">{text}</bdi>;
}

function Diff({ row }: { row: DoneRow }) {
  const t = useTranslations('trainee.done');
  if (row.key === 'hr') return <span>{row.tone === 'good' ? '✓' : '▲'}</span>;
  if (row.diff == null) return <span />;
  if (row.key === 'pace') {
    if (row.diff === 0) return <span>✓</span>;
    return <span>{t.rich(row.diff > 0 ? 'faster' : 'slower', { ...RICH, n: Math.abs(row.diff) })}</span>;
  }
  const text = row.key === 'distance'
    ? signedText(Math.round(row.diff / 100) / 10, (a) => (Number.isInteger(a) ? String(a) : a.toFixed(1)))
    : row.key === 'time' ? signedText(row.diff, clock) : signedText(row.diff);
  return <bdi dir="ltr">{text}</bdi>;
}

export function WorkoutDone({ data, onLoad }: {
  data: WorkoutResponse;
  /** The ⚡ row → 5ב. */
  onLoad: () => void;
}) {
  const t = useTranslations('trainee.done');
  const locale = useLocale();
  const done = data.done;
  if (!done) return null;
  const warn = done.verdictTone === 'warn';
  const d = done.detail;
  const tableTone = (row: DoneRow) => (row.tone === 'good' ? 'font-extrabold text-[#0E7A3C]' : row.tone === 'warn' ? 'font-extrabold text-[#8A4308]' : 'text-ink-400');

  return (
    <>
      <div className="flex items-center gap-3 rounded-[18px] px-3.5 py-3" style={{ background: warn ? C.warnBg : C.goodBg }}>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-[22px] font-black text-white" style={{ background: warn ? C.org : C.goodM }} aria-hidden>
          {done.verdictKey === 'fast' || done.verdictKey === 'long' ? '▲' : warn ? '▼' : '✓'}
        </div>
        <div className="min-w-0">
          <b className="block text-[16px] font-black text-ink-900">{t(`verdict.${done.verdictKey}`)}</b>
          {d.actual != null && d.target != null && (
            <small className="mt-px block text-[12.5px] leading-snug" style={{ color: warn ? C.warn : C.good }}>
              {t.rich(d.reps ? 'detailReps' : 'detailRun', { ...RICH, actual: clock(d.actual), target: clock(d.target) })}
              {d.of > 0 && <> {t.rich('inRange', { ...RICH, inRange: d.inRange, of: d.of, lastFaster: d.lastFaster ? 'yes' : 'no' })}</>}
            </small>
          )}
        </div>
      </div>

      {done.table.length > 0 && (
        <div className={cn(CARD, 'overflow-hidden')}>
          <div className="grid grid-cols-[1.05fr_1fr_1fr_.95fr] text-[14px]" role="table">
            <div className="bg-[#FAFAFC] px-3 py-1.5" role="columnheader" />
            {(['plan', 'done', 'diff'] as const).map(k => (
              <div key={k} role="columnheader" className="bg-[#FAFAFC] px-3 py-1.5 text-[11.5px] font-extrabold text-ink-400">{t(`col.${k}`)}</div>
            ))}
            {done.table.map((row, i) => {
              const last = i === done.table.length - 1;
              const cell = cn('px-3 py-[7px]', !last && 'border-b border-[#EFEFF4]');
              const label = row.key === 'pace' ? (d.reps ? t('row.reps') : t('row.pace')) : t(`row.${row.key}`);
              return (
                <div key={row.key} role="row" className="contents">
                  {row.key === 'load' ? (
                    <button type="button" onClick={onLoad} className={cn(cell, 'min-h-[44px] whitespace-nowrap text-start font-extrabold text-brand-600 underline decoration-dotted underline-offset-[3px]')}>
                      {label}
                    </button>
                  ) : (
                    <div className={cn(cell, 'font-extrabold text-ink-900')}>{label}</div>
                  )}
                  <div className={cn(cell, 'text-ink-700')}><Cell row={row} field="planned" /></div>
                  <div className={cn(cell, 'font-black text-ink-900')}><Cell row={row} field="done" /></div>
                  <div className={cn(cell, tableTone(row))}><Diff row={row} /></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {done.reps.length >= 2 && done.band && (
        <section className={cn(CARD, 'px-4 py-3.5 text-ink-900')}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-extrabold">{t('repsTitle')}</h3>
            <span className="text-[12.5px] font-bold text-ink-400">{t('repsHint')}</span>
          </div>
          <RepsChart reps={done.reps} band={done.band} />
        </section>
      )}

      {data.pr && (
        <div className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5" style={{ background: 'linear-gradient(90deg,#FFF6DB,#FFFBEF)' }}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#F5C542] text-[17px]" aria-hidden>🏅</div>
          <div className="min-w-0">
            <b className="block text-[14.5px] font-black text-ink-900">
              {t.rich('pr', { ...RICH, bucket: PR_BUCKETS.some(b => b.key === data.pr!.bucket) ? t(`bucket.${data.pr.bucket}` as never) : data.pr.bucket })}
            </b>
            <small className="block text-[12.5px] text-ink-500">
              {t.rich('prSub', { ...RICH, value: clock(data.pr.value), previous: clock(data.pr.previous), month: monthName(data.pr.previousDate, locale) })}
            </small>
          </div>
        </div>
      )}
    </>
  );
}

/** The segmented "סיכום · מפה וגרף · הקפות" (mockup 5): the last two leave this screen. */
export function DoneTabs({ activityId, onLaps }: { activityId: string | null; onLaps: () => void }) {
  const t = useTranslations('trainee.done.tabs');
  const router = useRouter();
  const tab = 'h-11 flex-1 rounded-[10px] text-[13.5px] font-extrabold';
  return (
    <div className="flex rounded-[13px] bg-[#E6E6EC] p-[3px]" role="tablist">
      <button type="button" role="tab" aria-selected className={cn(tab, 'bg-white text-ink-900 shadow-[0_1px_3px_rgba(0,0,0,.08)]')}>{t('summary')}</button>
      <button
        type="button" role="tab" aria-selected={false} disabled={!activityId}
        onClick={() => activityId && router.push(`/dashboard/activities/${activityId}`)}
        className={cn(tab, 'text-ink-400 disabled:opacity-50')}
      >
        {t('map')}
      </button>
      <button type="button" role="tab" aria-selected={false} onClick={onLaps} className={cn(tab, 'text-ink-400')}>{t('laps')}</button>
    </div>
  );
}
