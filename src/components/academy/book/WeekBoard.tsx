'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { addDaysToDateStr, cn } from '@/lib/utils';
import { COMPLIANCE_HEX, meterFraction } from '@/lib/academy/compliance';
import { absoluteToLibrary, fromLibrarySteps, mainStepIndex, profileBar, type BookStep } from '@/lib/academy/book-steps';
import type { WeekBoard as WeekBoardData, WeekBoardWorkout } from '@/lib/academy/week-board';
import { N, ProfileBar, RICH, clockText, hoursText, kmText } from './ui';
import { DayPlanner } from './DayPlanner';
import { TraineeWorkout } from './TraineeWorkout';
import { CopyWeekFlow } from '../tools/CopyWeekFlow';
import { useTraineeV2 } from '@/lib/trainee/v2';
import type { BoardView } from '@/lib/academy/deep-links';
import { BoardViewSwitch, WeekRestRow, WeekRowV2, WeekTilesV2, WeekUnplannedRow, ComplianceLegend } from '@/components/trainee/WeekRows';
import { TOP_BAR } from '@/components/trainee/ui';
import { Hotspot } from '@/components/tour/Hotspot';
import { HOTSPOTS } from '@/lib/tour/hotspots';

// ── השבוע (mockup phone 4) — the same screen for the trainee and the coach ───────────────
//
// TrainingPeaks' two good ideas, in the club's week (Sunday first): a colour strip down the
// side of every session that says how it went before a number is read (lib/academy/
// compliance.ts — green within ±20%, yellow ▲▼ a bit off, orange far off, red missed, grey
// not yet), and the week summed at the top, planned against done.
//
// One line per session says what happened (`▼ 8.4 מ־10 ק״מ`), and the next session draws
// its profile, because "what am I running next" is the question this screen is opened to
// answer. Tapping any session opens it (phone 5); the coach gets the same screen with the
// planner one tap further, and the days with nothing on them as `+` chips.
//
// Under the trainee experience v2 (lib/trainee/v2.ts) it is the trainee's "לוח", screen 2
// of trainee-experience-v2: four tiles (ק״מ, אימונים, זמן, ⚡), a row per day from Sunday
// down (a thin one for a rest day), the ⚡ of every session, and under each run only the
// marks that are true (🙂 feel, 💬 comments, 🏅 a record). With `onView`, a week | month
// switch sits under the title. The rows themselves are trainee/WeekRows.tsx.

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** `2026-10-11` → `11.10` */
function dm(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}`;
}

/**
 * A planned workout's own steps, as the book model: restated against the threshold they were
 * written for (`referenceSec`), then drawn at the trainee's.
 */
export function workoutModel(w: Pick<WeekBoardWorkout, 'steps'>, referenceSec: number): BookStep[] | null {
  if (!w.steps?.length) return null;
  return fromLibrarySteps(absoluteToLibrary(w.steps, referenceSec).steps);
}

export function WeekBoard({ athleteId, initialWeek, openDate, onView, onClosed, topBar = false }: {
  athleteId: string;
  initialWeek?: string | null;
  /** `?open=<date>`: that day's workout opens as soon as the week has loaded. */
  openDate?: string | null;
  /** The trainee's board: draws the week | month switch, and is told when it is tapped. */
  onView?: (view: BoardView) => void;
  /** The opened workout was closed (the board clears `?open=`). */
  onClosed?: () => void;
  /**
   * The shell's phone header is folded away (the trainee's own board, as mockup 2 draws it):
   * the week's title row is the top bar, under the status bar.
   */
  topBar?: boolean;
}) {
  const t = useTranslations('workoutBook');
  const tw = useTranslations('trainee.week');
  const v2 = useTraineeV2();
  const [week, setWeek] = useState<string | null>(initialWeek ?? null);
  const { data, error, mutate } = useApi<WeekBoardData>(
    `/api/academy/week-board?athleteId=${encodeURIComponent(athleteId)}${week ? `&weekStart=${week}` : ''}`,
    { keepPreviousData: true },
  );
  const [open, setOpen] = useState<WeekBoardWorkout | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [fromGroup, setFromGroup] = useState(false);
  const tt = useTranslations('academyTools.copy');

  const next = useMemo(() => data?.workouts.find(w => w.date >= data.today && w.compliance.color === 'grey' && !w.excuse) ?? null, [data]);

  // A deep link to one day: opened once, when its week arrives.
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    // Cleared (the workout was closed): the same day may be linked again.
    if (!openDate) { if (opened) setOpened(null); return; }
    if (opened === openDate || !data || data.weekStart > openDate || data.weekEnd < openDate) return;
    const w = data.workouts.find(x => x.date === openDate);
    setOpened(openDate);
    if (w) setOpen(w);
    // A day with only an unplanned run opens that run's own page (issue 25).
    else {
      const u = data.unplanned?.find(x => x.date === openDate);
      if (u) window.location.assign(`/dashboard/activities/${u.activityId}`);
    }
  }, [openDate, opened, data]);
  const close = () => {
    setOpen(null);
    onClosed?.();
  };

  if (!data) {
    return <p className="py-10 text-center text-sm text-ink-400">{error ? t('error.load') : t('loading')}</p>;
  }

  const weekStart = data.weekStart;
  const T = data.thresholdSec;
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i));
  const emptyDays = days.filter(d => !data.workouts.some(w => w.date === d) && d >= data.today);
  const { totals } = data;

  return (
    <div className="space-y-2.5" dir="rtl">
      <div className={cn('flex items-center justify-between', topBar && TOP_BAR)}>
        <button type="button" onClick={() => setWeek(addDaysToDateStr(weekStart, -7))} aria-label={t('prevWeek')}
          className="grid h-11 w-11 place-items-center rounded-full text-brand-600">
          <ChevronRight className="h-6 w-6" />
        </button>
        <h2 className="text-[17px] font-extrabold text-ink-900">
          {v2
            ? tw.rich(weekStart <= data.today && data.today <= data.weekEnd ? 'weekOf' : 'otherWeek', {
              m: (c) => <N>{c}</N>, range: `${dm(weekStart).split('.')[0]}–${dm(data.weekEnd)}`,
            })
            : <>{t('weekTitle')} · <N>{dm(weekStart).split('.')[0]}–{dm(data.weekEnd)}</N></>}
        </h2>
        <button type="button" onClick={() => setWeek(addDaysToDateStr(weekStart, 7))} aria-label={t('nextWeek')}
          className="grid h-11 w-11 place-items-center rounded-full text-brand-600">
          <ChevronLeft className="h-6 w-6" />
        </button>
      </div>

      {onView && <BoardViewSwitch view="week" onChange={onView} />}

      {v2 ? (
        <>
          <WeekTilesV2 board={data} />
          {data.fromClub && (
            <p className="px-1 text-13 text-ink-400">{t('fromClubNote', { name: data.athlete.name.split(' ')[0] })}</p>
          )}
          {data.workouts.length === 0 && (
            <p className="rounded-[18px] bg-white px-4 py-5 text-center text-sm text-ink-400">{tw('empty')}</p>
          )}
          {days.map((d) => {
            const list = data.workouts.filter(w => w.date === d);
            const extra = (data.unplanned ?? []).filter(u => u.date === d).map(u => <WeekUnplannedRow key={u.activityId} u={u} />);
            if (!list.length) {
              if (extra.length) return extra;
              return data.restDays?.some(r => r.date === d) ? <WeekRestRow key={d} date={d} /> : null;
            }
            return [...list.map(w => (
              <WeekRowV2
                key={`${w.date}-${w.name}`}
                w={w}
                board={data}
                isNext={next?.date === w.date}
                onOpen={() => setOpen(w)}
              />
            )), ...extra];
          })}
          {data.workouts.length > 0 && <ComplianceLegend />}
        </>
      ) : (
        <>
      <div className="grid grid-cols-3 gap-2">
        <Total label={t('total.km')} done={kmText(totals.doneKm * 1000)} planned={kmText(totals.plannedKm * 1000)} fraction={meterFraction(totals.doneKm, totals.plannedKm)} />
        <Total label={t('total.workouts')} done={String(totals.doneCount)} planned={String(totals.plannedCount)} fraction={meterFraction(totals.doneCount, totals.plannedCount)} />
        <Total label={t('total.time')} done={hoursText(totals.doneSec)} planned={hoursText(totals.plannedSec)} fraction={meterFraction(totals.doneSec, totals.plannedSec)} />
      </div>

      {data.fromClub && (
        <p className="px-1 text-13 text-ink-400">{t('fromClubNote', { name: data.athlete.name.split(' ')[0] })}</p>
      )}

      {data.workouts.length === 0 && (
        <p className="rounded-[18px] bg-white px-4 py-5 text-center text-sm text-ink-400">{t('weekEmpty')}</p>
      )}

      {data.workouts.map(w => (
        <WeekCard
          key={`${w.date}-${w.name}`}
          w={w}
          today={data.today}
          thresholdSec={T}
          referenceSec={data.referenceSec}
          isNext={next?.date === w.date}
          onOpen={() => setOpen(w)}
        />
      ))}
        </>
      )}

      {data.canPlan && (data.groupDays?.length ?? 0) > 0 && (
        <GroupWeek
          athleteId={athleteId}
          weekStart={weekStart}
          days={data.groupDays!}
          today={data.today}
          name={data.athlete.name.split(' ')[0]}
          replaces={!data.fromClub && data.workouts.length > 0}
          onTake={(d) => { setFromGroup(true); setPlanning(d); }}
          onDone={() => void mutate()}
        />
      )}

      {data.canPlan && emptyDays.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-13 font-bold text-ink-400">{t('addOn')}</span>
          {emptyDays.map(d => (
            <button key={d} type="button" onClick={() => setPlanning(d)} data-tour="week-add-day"
              className="h-11 rounded-full bg-white px-4 text-[15px] font-bold text-brand-600 shadow-sm">
              + {t(`dayShort.${WEEKDAY_KEYS[new Date(`${d}T12:00:00Z`).getUTCDay()]}`)}
            </button>
          ))}
        </div>
      )}

      {/* The coach tools: this week, copied forward or to other trainees. Their own plan only. */}
      {data.canPlan && !data.fromClub && data.workouts.length > 0 && (
        <button type="button" onClick={() => setCopying(true)}
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-white text-[15.5px] font-extrabold text-brand-600 shadow-sm">
          {tt('weekButton')}
        </button>
      )}
      {copying && (
        <CopyWeekFlow athleteId={athleteId} weekStart={weekStart} onClose={() => setCopying(false)} onDone={() => void mutate()} />
      )}

      {open && (
        <TraineeWorkout
          workout={open}
          board={data}
          onClose={close}
          onChange={data.canPlan ? () => { setPlanning(open.date); setOpen(null); } : undefined}
        />
      )}
      {planning && (
        <DayPlanner
          athleteId={athleteId}
          date={planning}
          onClose={() => { setPlanning(null); setFromGroup(false); }}
          onDone={() => void mutate()}
          fromGroup={fromGroup}
        />
      )}
    </div>
  );
}

function Total({ label, done, planned, fraction }: { label: string; done: string; planned: string; fraction: number }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]">
      <small className="block text-xs font-bold text-ink-400">{label}</small>
      <p className="mt-0.5 whitespace-nowrap">
        <N className="text-[19px] font-black text-ink-900">{done}</N>{' '}
        <N className="text-13 text-ink-400">/ {planned}</N>
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#F4F4F8]">
        <i className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
    </div>
  );
}

function WeekCard({ w, today, thresholdSec, referenceSec, isNext, onOpen }: {
  w: WeekBoardWorkout;
  today: string;
  thresholdSec: number | null;
  referenceSec: number;
  isNext: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations('workoutBook');
  const c = w.compliance;
  const dayShort = t(`dayShort.${WEEKDAY_KEYS[w.dayOfWeek]}`);
  const caret = c.caret === 'up' ? '▲' : c.caret === 'down' ? '▼' : '';
  const tomorrow = addDaysToDateStr(today, 1);
  const model = useMemo(() => workoutModel(w, referenceSec), [w, referenceSec]);
  const reps = !!model && model[mainStepIndex(model)]?.kind === 'reps';

  let status: React.ReactNode;
  if (c.color === 'green') status = <span className="text-[#0E7A3C]">✓ {t('onPlan')}</span>;
  else if (c.color === 'red') status = <span className="font-extrabold text-accent-red-ink">{t('missed')}</span>;
  else if (c.color === 'grey') {
    const when = w.date === today ? t('today') : w.date === tomorrow ? t('tomorrow') : null;
    status = <>{when && <>{when} · </>}{w.onWatch ? t('onWatchShort') : t('notOnWatch')}</>;
  } else {
    const planned = c.measure === 'time' ? Math.round((w.plannedSec ?? 0) / 60) : kmText(w.plannedM ?? 0);
    const actual = c.measure === 'time' ? Math.round((w.actualSec ?? 0) / 60) : kmText(w.actualM ?? 0);
    status = (
      <span className={cn('font-extrabold', c.color === 'orange' ? 'text-[#9A4A0E]' : 'text-[#7A5A08]')}>
        {caret} {t.rich(c.measure === 'time' ? 'ofPlannedMin' : 'ofPlannedKm', { ...RICH, actual, planned })}
      </span>
    );
  }

  const done = c.color !== 'grey' && c.color !== 'red';
  const km = done ? w.actualM : w.plannedM;
  const pace = done ? w.actualPace : w.plannedPace;
  const off = done && w.actualPace && w.plannedPace ? w.actualPace - w.plannedPace : 0;
  const paceColor = !done ? 'text-ink-900' : Math.abs(off) <= 5 ? 'text-[#0E7A3C]' : 'text-[#8A4308]';

  return (
    <button type="button" onClick={onOpen} className="flex w-full overflow-hidden rounded-[18px] bg-white text-start shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]">
      <span aria-hidden className="w-[7px] shrink-0" style={{ background: COMPLIANCE_HEX[c.color] }} />
      <span className="min-w-0 flex-1 px-3.5 py-3">
        <span className="flex items-baseline justify-between gap-2">
          <b className="truncate text-[16.5px] font-extrabold text-ink-900">{dayShort} · <bdi>{w.name}</bdi></b>
          <small className="shrink-0 text-13 text-ink-400">{status}</small>
        </span>
        <small className="mt-0.5 block text-13 text-ink-400">
          {km ? <>{t.rich('kmOnly', { ...RICH, km: kmText(km) })}</> : null}
          {pace ? (
            <> · {t.rich(reps ? 'repsAtPace' : 'atPace', {
              ...RICH,
              pace: `${done && Math.abs(off) > 5 ? (off > 0 ? '▼ ' : '▲ ') : ''}${clockText(pace)}`,
              p: (chunks) => <bdi dir="ltr" className={cn('font-black', paceColor)}>{chunks}</bdi>,
            })}</>
          ) : null}
        </small>
        {isNext && model && <ProfileBar segments={profileBar(model, thresholdSec)} height={20} className="mt-2" />}
      </span>
    </button>
  );
}

/**
 * The group's week under the trainee's (Ofer, 2026-10-20): each day's group session as a quiet
 * line with "לקחת את של הקבוצה ולהתאים" (the day planner opens on it, at the trainee's paces),
 * and "שבוע שלם מהקבוצה" — the whole group week written as the trainee's own, re-paced, after
 * which the coach edits single days (copy-week, fromClub).
 */
function GroupWeek({ athleteId, weekStart, days, today, name, replaces, onTake, onDone }: {
  athleteId: string; weekStart: string; days: Array<{ date: string; name: string }>; today: string; name: string;
  replaces: boolean; onTake: (date: string) => void; onDone: () => void;
}) {
  const t = useTranslations('workoutBook');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const copyAll = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/academy/copy-week', {
        method: 'POST', headers: await apiHeaders(true),
        body: JSON.stringify({ fromClub: true, athleteId, weekStart, send: true }),
      });
      const body = await res.json().catch(() => ({}));
      const r = body?.results?.[0];
      setMsg(res.ok && r && r.status !== 'failed' ? `השבוע של הקבוצה נכתב ל־${name} — אפשר לערוך כל יום` : 'לא הצליח — נסו שוב');
      setConfirm(false);
      if (res.ok) onDone();
    } catch {
      setMsg('לא הצליח — נסו שוב');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-[18px] bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <b className="text-[15px] text-ink-900">השבוע של הקבוצה</b>
        <Hotspot id="week-from-club" title={HOTSPOTS['week-from-club'].title} body={HOTSPOTS['week-from-club'].body} className="shrink-0">
          <button type="button" disabled={busy} onClick={() => (replaces ? setConfirm(true) : void copyAll())}
            className="min-h-[40px] shrink-0 rounded-full bg-[#F3EEFF] px-3.5 text-[13px] font-extrabold text-[#7C3AED] disabled:opacity-60">
            ⧉ שבוע שלם מהקבוצה
          </button>
        </Hotspot>
      </div>
      {confirm && (
        <div className="mt-2 rounded-xl bg-[#FDF0E2] px-3 py-2.5 text-[13px] font-bold text-[#8A4308]">
          זה מחליף את השבוע ש־{name} כבר קיבל/ה.
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void copyAll()} className="min-h-[40px] rounded-xl bg-brand-600 px-4 text-[13px] font-extrabold text-white">{busy ? '…' : 'להחליף'}</button>
            <button type="button" onClick={() => setConfirm(false)} className="min-h-[40px] rounded-xl bg-white px-3 text-[13px] font-extrabold text-ink-700">ביטול</button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-[12.5px] font-bold text-ink-500">{msg}</p>}
      <div className="mt-1 divide-y divide-page">
        {days.map((d) => (
          <div key={d.date} className="flex min-h-[52px] items-center gap-3 py-1.5">
            <span className="w-10 shrink-0 text-center text-[13px] font-extrabold text-ink-700">
              {t(`dayShort.${WEEKDAY_KEYS[new Date(`${d.date}T12:00:00Z`).getUTCDay()]}`)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-400" dir="auto">{d.name}</span>
            {d.date >= today && (
              <button type="button" onClick={() => onTake(d.date)} className="min-h-[44px] shrink-0 text-[12.5px] font-extrabold text-brand-600">
                לקחת ולהתאים ›
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
