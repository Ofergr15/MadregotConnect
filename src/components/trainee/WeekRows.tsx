'use client';

import { useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { COMPLIANCE_HEX, meterFraction, type ComplianceColor } from '@/lib/academy/compliance';
import { mainStepIndex, profileBar } from '@/lib/academy/book-steps';
import { RECORD_BUCKETS } from '@/lib/academy/records';
import type { BoardView } from '@/lib/academy/deep-links';
import type { WeekBoard, WeekBoardWorkout } from '@/lib/academy/week-board';
import { N, ProfileBar, clockText, hoursText, kmText } from '@/components/academy/book/ui';
import { WEEKDAY_KEYS, workoutModel } from '@/components/academy/book/WeekBoard';
import { FACES } from './FeelAndTalk';
import { C, SHADOW, StructureText, Tag } from './ui';

// ── The week board's v2 pieces (trainee-experience-v2 screen 2) ───────────────────────────
//
// The four tiles, a row per session and a thin row per rest day, the legend, and the week |
// month switch both boards share. A list, not a chart: Sunday on top, Saturday at the
// bottom. Every number is isolated LTR; every mark under a row is there only when true.

const TILE = cn('rounded-[14px] bg-white px-[9px] py-2', SHADOW);

/** `שבוע | חודש` — the segmented switch at the top of both boards. 44px targets. */
export function BoardViewSwitch({ view, onChange }: { view: BoardView; onChange: (v: BoardView) => void }) {
  const t = useTranslations('trainee.week.view');
  return (
    <div role="tablist" aria-label={t('label')} className="flex rounded-[13px] bg-[#E6E6EC] p-[3px]">
      {(['week', 'month'] as const).map(v => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => { if (view !== v) onChange(v); }}
          className={cn(
            'h-11 flex-1 rounded-[10px] text-[13.5px] font-extrabold',
            view === v ? 'bg-white text-ink-900 shadow-[0_1px_3px_rgba(0,0,0,.08)]' : 'text-ink-400',
          )}
        >
          {t(v)}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, done, planned, fraction }: { label: string; done: string; planned: string; fraction: number }) {
  const t = useTranslations('trainee.week.tile');
  return (
    <div className={TILE}>
      <small className="block text-[11.5px] font-bold text-ink-400">{label}</small>
      <b className="block text-[18px] font-black leading-[1.2] text-ink-900"><N>{done}</N></b>
      <em className="block whitespace-nowrap text-[11px] not-italic text-ink-400">{t.rich('of', { m: (c) => <N>{c}</N>, planned })}</em>
      <div className="mt-[5px] h-[5px] overflow-hidden rounded-full bg-[#F4F4F8]">
        <i className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
    </div>
  );
}

/** Done big, "מתוך" planned under it. The ⚡ tile only once the load numbers are trusted. */
export function WeekTilesV2({ board }: { board: WeekBoard }) {
  const t = useTranslations('trainee.week.tile');
  const { totals } = board;
  const showLoad = !!board.loadOk && totals.plannedLoad != null && totals.doneLoad != null;
  return (
    <div className={cn('grid gap-[7px]', showLoad ? 'grid-cols-4' : 'grid-cols-3')}>
      <Tile label={t('km')} done={kmText(totals.doneKm * 1000)} planned={kmText(totals.plannedKm * 1000)} fraction={meterFraction(totals.doneKm, totals.plannedKm)} />
      <Tile label={t('workouts')} done={String(totals.doneCount)} planned={String(totals.plannedCount)} fraction={meterFraction(totals.doneCount, totals.plannedCount)} />
      <Tile label={t('time')} done={hoursText(totals.doneSec)} planned={hoursText(totals.plannedSec)} fraction={meterFraction(totals.doneSec, totals.plannedSec)} />
      {showLoad && (
        <Tile label={t('load')} done={String(totals.doneLoad)} planned={String(totals.plannedLoad)} fraction={meterFraction(totals.doneLoad!, totals.plannedLoad!)} />
      )}
    </div>
  );
}

/** A day with nothing planned: one thin grey line. */
export function WeekRestRow({ date }: { date: string }) {
  const t = useTranslations('trainee.week');
  const tb = useTranslations('workoutBook');
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return (
    <div className="flex h-[30px] items-center gap-2.5 rounded-xl bg-[#EBEBF0] pe-3 ps-3.5 text-[12.5px] font-bold text-ink-400">
      <b className="min-w-9 whitespace-nowrap font-bold">{tb(`dayShort.${WEEKDAY_KEYS[dow]}`)} <N>{Number(date.slice(8, 10))}</N></b>
      {t('rest')}
    </div>
  );
}

const done = (c: ComplianceColor) => c === 'green' || c === 'yellow' || c === 'orange';

/** The session's own km is in its name ("ארוכה 16 ק״מ"): the line does not say it twice. */
function nameHasKm(name: string, km: string): boolean {
  return new RegExp(`(^|[^\\d.])${km.replace('.', '\\.')}\\s*ק״מ`).test(name);
}

export function WeekRowV2({ w, board, isNext, onOpen }: {
  w: WeekBoardWorkout;
  board: WeekBoard;
  isNext: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations('trainee.week');
  const tb = useTranslations('workoutBook');
  const tf = useTranslations('trainee.feel.faces');
  const td = useTranslations('trainee.done');
  const c = w.compliance;
  const isToday = w.date === board.today;
  const ran = done(c.color);
  const model = useMemo(() => workoutModel(w, board.referenceSec), [w, board.referenceSec]);
  const reps = !!model && model[mainStepIndex(model)]?.kind === 'reps';
  const m = (chunks: ReactNode) => <N>{chunks}</N>;

  let status: ReactNode = null;
  if (c.color === 'green') status = <small className="shrink-0 text-[12.5px] font-extrabold text-[#0E7A3C]">{t('onPlan')}</small>;
  else if (c.color === 'red') status = <small className="shrink-0 text-[12.5px] font-extrabold" style={{ color: C.bad }}>{t('missed')}</small>;
  else if (w.offLine) {
    status = (
      <small className="shrink-0 text-[12.5px] font-extrabold" style={{ color: C.warn }}>
        {t.rich(w.offLine.unit === 'min' ? 'offMin' : 'offKm', {
          m, caret: w.offLine.caret === 'up' ? '▲' : '▼', actual: w.offLine.actual, planned: w.offLine.planned,
        })}
      </small>
    );
  } else if (c.color === 'grey' && isToday) status = <Tag tone="b" className="shrink-0">{t('today')}</Tag>;
  else if (c.color === 'grey' && w.onWatch) status = <small className="shrink-0 text-[12.5px] text-ink-400">{t('onWatch')}</small>;

  // One line: what was run (or, on an off-plan run, the trainee's own word for why), or
  // what is planned; then ⌚ for today's session already on the watch; then ⚡.
  const parts: ReactNode[] = [];
  const km = ran ? w.actualM : w.plannedM;
  const pace = ran ? w.actualPace : w.plannedPace;
  const off = ran && w.actualPace && w.plannedPace ? w.actualPace - w.plannedPace : 0;
  if (ran && w.offLine && w.comment) {
    parts.push(<bdi key="note">{w.comment}</bdi>);
  } else {
    if (km && !(ran && w.offLine) && !(!ran && nameHasKm(w.name, kmText(km)))) parts.push(<span key="km">{t.rich('km', { m, km: kmText(km) })}</span>);
    if (pace) {
      const tone = !ran ? (isToday ? 'text-ink-900' : '') : Math.abs(off) <= 5 ? 'text-[#0E7A3C]' : 'text-[#A8510A]';
      parts.push(
        <span key="pace">
          {t.rich(ran && reps ? 'reps' : 'at', {
            pace: clockText(pace),
            m: (chunks) => <b className={cn('text-[12.5px]', ran || isToday ? 'font-black' : 'font-normal', tone)}><N>{chunks}</N></b>,
          })}
        </span>,
      );
    }
  }
  if (!ran && isToday && w.onWatch) parts.push(<span key="watch">{t('onWatch')}</span>);
  const load = ran ? w.load : c.color === 'grey' ? w.plannedLoad : null;
  if (load != null) parts.push(<span key="load">{t.rich('load', { m, load })}</span>);

  const marks: ReactNode[] = [];
  if (w.marks?.feel != null) marks.push(<span key="feel">{FACES[w.marks.feel]} {tf(String(w.marks.feel) as never)}</span>);
  if (w.marks?.comments) marks.push(<span key="talk">{t.rich('comments', { m, n: w.marks.comments })}</span>);
  if (w.marks?.pr) {
    const bucket = RECORD_BUCKETS.some(b => b.key === w.marks!.pr) ? td(`bucket.${w.marks.pr}` as never) : w.marks.pr;
    marks.push(<span key="pr">{t('pr', { bucket })}</span>);
  }

  const day = tb(`dayShort.${WEEKDAY_KEYS[w.dayOfWeek]}`);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex min-h-[56px] w-full overflow-hidden rounded-2xl bg-white text-start',
        SHADOW,
        isToday && 'outline outline-2 -outline-offset-2 outline-brand-600',
      )}
    >
      <span aria-hidden className="w-[7px] shrink-0" style={{ background: COMPLIANCE_HEX[c.color] }} />
      <span className={cn('w-[42px] shrink-0 pt-2.5 text-center text-[11.5px] font-bold', isToday ? 'text-brand-600' : 'text-ink-400')}>
        {day}
        <b className={cn('block text-[17px] font-black', isToday ? 'text-brand-600' : 'text-ink-900')}><N>{Number(w.date.slice(8, 10))}</N></b>
      </span>
      <span className="min-w-0 flex-1 py-[9px] pe-3">
        <span className="flex items-baseline justify-between gap-2">
          <b className="truncate text-[15px] font-extrabold text-ink-900"><StructureText text={w.name} /></b>
          {status}
        </span>
        {parts.length > 0 && (
          <small className="block text-[12.5px] text-ink-400">
            {parts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}
          </small>
        )}
        {isNext && isToday && model && <ProfileBar segments={profileBar(model, board.thresholdSec, { trainee: true })} height={16} className="mt-1.5" palette="trainee" />}
        {marks.length > 0 && (
          <span className="mt-1 flex items-center gap-3 text-xs text-ink-400">{marks}</span>
        )}
      </span>
    </button>
  );
}

const LEGEND: ComplianceColor[] = ['green', 'yellow', 'orange', 'red'];

/** What the strip colours mean. */
export function ComplianceLegend() {
  const t = useTranslations('trainee.week.legend');
  return (
    <div className="mt-0.5 flex flex-wrap justify-center gap-[11px] text-[11.5px] text-ink-500">
      {LEGEND.map(c => (
        <span key={c} className="flex items-center gap-[5px]">
          <i aria-hidden className="inline-block h-[5px] w-[13px] rounded-[3px]" style={{ background: COMPLIANCE_HEX[c] }} />
          {t(c)}
        </span>
      ))}
    </div>
  );
}
