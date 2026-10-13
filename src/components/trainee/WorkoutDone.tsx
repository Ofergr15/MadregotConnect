'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { DoneRow, WorkoutResponse } from '@/lib/academy/workout-extras';
import { RECORD_BUCKETS } from '@/lib/academy/records';
import { doneLaps, type DoneLapRow } from '@/lib/trainee/done-laps';
import { MAX_HR_MIN_RUNS } from '@/lib/academy/load';
import { RepsChart } from './RepsChart';
import { C, CARD, RICH, clock, km, monthName, signedText } from './ui';

// ── 5: did I do what was planned (mockup trainee-experience-v2, phone 5) ───────────────
//
// One verdict line that is always visible, then the plan against what was done with the
// difference (at most five rows), every rep against its watch range, and a medal only
// when there is a real record. The laps are a tab on this screen, the map one tap away; the ⚡
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
  if (row.diff === 0) return <span>✓</span>;
  if (row.key === 'pace') {
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
              {/* "5:40 instead of 5:40" for a pace right on target (launch N34). */}
              {clock(d.actual) === clock(d.target)
                ? t.rich(d.reps ? 'detailRepsExact' : 'detailRunExact', { ...RICH, actual: clock(d.actual) })
                : t.rich(d.reps ? 'detailReps' : 'detailRun', { ...RICH, actual: clock(d.actual), target: clock(d.target) })}
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

      {/* No ⚡ for this run: why, and what fixes it — never a silently missing row (12). */}
      {done.noLoad && (
        <p className={cn(CARD, 'px-4 py-3 text-[13px] font-bold leading-snug text-ink-500')}>⚡ {done.noLoad === 'hrLearning' ? t.rich('noLoadHrLearning', { ...RICH, n: MAX_HR_MIN_RUNS }) : t('noLoad')}</p>
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
              {t.rich('pr', { ...RICH, bucket: RECORD_BUCKETS.some(b => b.key === data.pr!.bucket) ? t(`bucket.${data.pr.bucket}` as never) : data.pr.bucket })}
            </b>
            <small className="block text-[12.5px] text-ink-500">
              {data.pr.rep != null
                ? t.rich('prSubRep', { ...RICH, n: data.pr.rep, value: clock(data.pr.value), previous: clock(data.pr.previous), month: monthName(data.pr.previousDate, locale) })
                : t.rich('prSub', { ...RICH, value: clock(data.pr.value), previous: clock(data.pr.previous), month: monthName(data.pr.previousDate, locale) })}
            </small>
          </div>
        </div>
      )}
    </>
  );
}

export type DoneTab = 'summary' | 'map' | 'laps';

/**
 * The segmented "סיכום · מפה וגרף · הקפות" (mockup 5). The laps are a table on this screen
 * (DoneLapsTable); the map and graph open the run's page in its map-only view, without the
 * old page's own verdict, so nothing there contradicts this screen.
 */
export function DoneTabs({ value, activityId, onChange, returnDate = null }: {
  value: DoneTab;
  activityId: string | null;
  onChange: (tab: DoneTab) => void;
  /**
   * The day this screen is about. Written into the current address as `?open=` before
   * the map opens, so "חזרה" from the run's page comes back to this day instead of the
   * bare board (launch N22). The history entry's own state is kept.
   */
  returnDate?: string | null;
}) {
  const t = useTranslations('trainee.done.tabs');
  const router = useRouter();
  const tab = 'h-11 flex-1 rounded-[10px] text-[13.5px] font-extrabold';
  const on = 'bg-white text-ink-900 shadow-[0_1px_3px_rgba(0,0,0,.08)]';
  return (
    <div className="flex rounded-[13px] bg-[#E6E6EC] p-[3px]" role="tablist">
      <button type="button" role="tab" aria-selected={value === 'summary'} onClick={() => onChange('summary')} className={cn(tab, value === 'summary' ? on : 'text-ink-400')}>{t('summary')}</button>
      <button
        type="button" role="tab" aria-selected={false} disabled={!activityId}
        onClick={() => {
          if (!activityId) return;
          if (returnDate) {
            try {
              const url = new URL(window.location.href);
              url.searchParams.set('open', returnDate);
              window.history.replaceState(window.history.state, '', url.toString());
            } catch { /* the map still opens */ }
          }
          router.push(`/dashboard/activities/${activityId}?view=map`);
        }}
        className={cn(tab, 'text-ink-400 disabled:opacity-50')}
      >
        {t('map')}
      </button>
      <button type="button" role="tab" aria-selected={value === 'laps'} onClick={() => onChange('laps')} className={cn(tab, value === 'laps' ? on : 'text-ink-400')}>{t('laps')}</button>
    </div>
  );
}

/** "הקפות": every rep (or kilometre) against the same range the reps chart draws. */
export function DoneLapsTable({ data }: { data: WorkoutResponse }) {
  const t = useTranslations('trainee.done.laps');
  const laps = doneLaps(data.done, data.sheet.chart);
  // Why there are none, from where the run came — never a bare "no laps".
  const why = data.activity?.lapsWhy;
  if (!laps) return <p className={cn(CARD, 'px-4 py-6 text-center text-sm text-ink-400')}>{why && why !== 'unknown' ? t(`why.${why}`) : t('none')}</p>;
  const tone = (r: DoneLapRow) => (r.tone === 'fast' ? C.good : r.tone === 'slow' ? C.warn : C.goodM);
  return (
    <section className={cn(CARD, 'overflow-hidden text-ink-900')}>
      <div className="flex items-baseline justify-between gap-2 px-4 pb-1.5 pt-3">
        <h3 className="text-[15px] font-extrabold">{t('title')}</h3>
        {laps.band && (
          <span className="text-[12.5px] font-bold text-ink-400">
            {t.rich('range', { ...RICH, range: `${clock(laps.band.min)}–${clock(laps.band.max)}` })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[.8fr_1fr_1.6fr] text-[14px]" role="table">
        {([laps.mode === 'reps' ? 'colRep' : 'colKm', 'colPace', 'colRange'] as const).map(k => (
          <div key={k} role="columnheader" className="bg-[#FAFAFC] px-4 py-1.5 text-[11.5px] font-extrabold text-ink-400">{t(k)}</div>
        ))}
        {laps.rows.map((r, i) => {
          const cell = cn('flex min-h-[44px] items-center px-4', i < laps.rows.length - 1 && 'border-b border-[#EFEFF4]');
          return (
            <div key={r.n} role="row" className="contents">
              <div className={cn(cell, 'font-extrabold')}><bdi dir="ltr">{r.n}</bdi></div>
              <div className={cn(cell, 'font-black')}><bdi dir="ltr">{clock(r.paceSec)}</bdi></div>
              <div className={cn(cell, 'font-extrabold')} style={{ color: tone(r) }}>{t(r.tone)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
