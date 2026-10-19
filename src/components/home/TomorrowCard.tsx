'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, Check, ChevronDown, Hourglass } from 'lucide-react';
import { useApi } from '@/lib/api';
import { addDaysToDateStr, cn, GROUP_HEX } from '@/lib/utils';
import { roundKm } from '@/lib/plans/week-summary';
import type { WeekSession } from '@/lib/plans/workout-parsing';
import { packPaces } from '@/lib/home/today';
import { sessionFrame, sessionHeadline, type FrameLabels } from '@/lib/plans/session-summary';
import type { StepUnits } from '@/lib/plans/step-display';
import { paceRangeText, profileSegments, type SegmentKind } from '@/lib/plans/session-profile';
import { formatDurationClock } from '@/lib/workout-duration';
import { isEstimate } from '@/lib/plans/step-estimate';
import type { Lineup } from '@/lib/attendance/lineup';
import { SessionRsvp } from '@/components/feed/SessionRsvp';
import { FeatureTip } from '@/components/whats-new/FeatureTip';

/**
 * "מגיעים מחר?" on the home — the question WITH the session it is about (mockup
 * ~/.cache/madregot/tomorrow-rsvp.html, Ofer 2026-10-19: "צריך להיות שאלה אבל גם מידע על
 * האימון"). Tomorrow's session in the runner's lane — when, what, the shape of it, the
 * pack's pace, the distance and time — then the feed's own vote (SessionRsvp: a pack to
 * come with, who is already coming). Answered, it folds to one line until tapped.
 *
 * Shown the day before a team day (reminder config `teamDays`, or a one-day session the
 * coach marked as quality), the same rule the feed's card asks by.
 */

const SEG_HEIGHT: Record<SegmentKind, string> = { warm: '40%', cool: '40%', rest: '22%', easy: '58%', hard: '100%' };
const SEG_COLOR: Record<SegmentKind, string> = {
  warm: 'linear-gradient(#C9CDD9,#AEB3C2)', cool: 'linear-gradient(#C9CDD9,#AEB3C2)', rest: '#D5D8E1',
  easy: 'linear-gradient(#4ADE7B,#22B45A)', hard: 'linear-gradient(#FFB547,#FF8A00)',
};
const CARD = 'rounded-[22px] bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]';

export function TomorrowCard({ date, weekStart, dayOfWeek, sessions, lane, packIndex, time }: {
  /** Tomorrow, YYYY-MM-DD. */
  date: string;
  /** Tomorrow's plan week (Sunday) and weekday, for the vote. */
  weekStart: string;
  dayOfWeek: number;
  /** Tomorrow's sessions in the runner's lane; empty when the coach hasn't posted it. */
  sessions: WeekSession[];
  /** The lane the week was read in (its paces are that pack's), null for one-day sessions. */
  lane: number | null;
  packIndex: number;
  /** The session's time, "18:00", when known. */
  time: string | null;
}) {
  const t = useTranslations('todayHome');
  const tc = useTranslations('common');
  const td = useTranslations('dashboard');
  const tp = useTranslations('planner');
  const units: StepUnits = { km: tc('km'), m: tc('meters'), sec: tc('seconds'), min: tc('minutes') };
  const frameLabels: FrameLabels = { ...units, warmup: tp('sectionWarmup'), cooldown: tp('sectionCooldown') };
  const dayNames = tc.raw('dayNames') as string[];

  // Same key SessionRsvp reads, so the folded line and the vote share one fetch.
  const { data: lineup } = useApi<Lineup & { homeIndex: number }>(`/api/attendance/lineup?weekStart=${weekStart}&day=${dayOfWeek}`);
  const storeKey = `mc:tmr:${date}`;
  const [open, setOpenRaw] = useState<boolean | null>(null);
  useEffect(() => { try { setOpenRaw(localStorage.getItem(storeKey) === 'open' ? true : null); } catch { /* */ } }, [storeKey]);
  const setOpen = (v: boolean) => { setOpenRaw(v); try { localStorage.setItem(storeKey, v ? 'open' : 'closed'); } catch { /* */ } };

  const s = sessions[0] ?? null;
  const headline = s ? sessionHeadline(s.steps, units) || s.name : '';
  const m = /^([\d.:–×x\s-]+?)\s*([^\d\s].*)?$/.exec(headline);
  const frame = s ? sessionFrame(s.steps, frameLabels) : '';
  const profile = s ? profileSegments(s.steps || []) : [];
  const paces = packPaces(s?.steps, lane).map((p) => (p ? paceRangeText(p) : null));
  const lo = s ? roundKm(s.kmMin) : 0; const hi = s ? roundKm(s.kmMax) : 0;
  const approx = s && isEstimate(s.kmFrom) ? '~' : '';
  const when = [td('tomorrow'), dayNames[dayOfWeek]].join(' · ');

  const mine = lineup?.mine ?? null;
  const folded = !!mine && open !== true;
  if (folded) {
    const hex = mine!.attending && mine!.index >= 0 ? GROUP_HEX[mine!.index] : '#B4B5BC';
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn(CARD, 'flex w-full items-center gap-3 py-3 text-start')}>
        <span className="grid h-8 w-8 flex-none place-items-center rounded-full text-white" style={{ background: mine!.attending ? '#15803d' : '#B4B5BC' }}>
          {mine!.attending ? <Check className="h-4 w-4" strokeWidth={3} /> : '–'}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14.5px] text-ink-900">
            {mine!.attending ? t('tmrComing', { n: mine!.index + 1 }) : t('tmrNotComing')}
          </b>
          <span className="block truncate text-xs text-ink-400">
            {time && <><bdi dir="ltr">{time}</bdi> · </>}{headline && <bdi dir="auto">{headline}</bdi>}{hi > 0 && <> · <bdi dir="ltr">{approx}{lo !== hi ? `${lo}–${hi}` : hi}</bdi> {tc('km')}</>}
          </span>
        </span>
        {mine!.attending && <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: hex }} />}
        <ChevronDown className="h-4 w-4 flex-none text-ink-400" />
      </button>
    );
  }

  return (
    <>
    <FeatureTip id="tomorrow-with-session" title={t('tipTomorrow')} body={t('tipTomorrowBody')} until="2026-10-26" />
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 py-0.5 pe-3 ps-2 text-[12.5px] font-extrabold text-brand-600">
          <CalendarDays className="h-3.5 w-3.5" strokeWidth={2.4} />{when}{time && <> · <bdi dir="ltr">{time}</bdi></>}
        </span>
        <span className="flex items-center gap-2 text-[12.5px] text-ink-400">
          {t('teamSession')}
          {mine && (
            <button type="button" aria-label={t('fold')} onClick={() => setOpen(false)} className="grid h-7 w-7 place-items-center rounded-full bg-page">
              <ChevronDown className="h-3.5 w-3.5 rotate-180 text-ink-500" />
            </button>
          )}
        </span>
      </div>

      {s ? (
        <>
          <div className="mt-1.5 text-[30px] font-black leading-tight tracking-tight text-ink-900">
            {m && m[2] ? <><bdi dir="ltr">{m[1].trim()}</bdi><small className="ms-1.5 text-[15px] font-bold text-ink-500">{m[2]}</small></> : <span dir="auto">{headline}</span>}
          </div>
          {frame && <p className="mt-0.5 text-13 text-ink-500" dir="auto">{frame}</p>}
          {profile.length > 0 && (
            <span className="mt-2.5 flex h-6 items-end gap-[2px]" aria-hidden>
              {profile.map((seg, i) => (
                <span key={i} className="block rounded-t-[5px] rounded-b-[2px]" style={{ flexGrow: seg.share, flexBasis: 0, minWidth: 2, height: SEG_HEIGHT[seg.kind], background: SEG_COLOR[seg.kind] }} />
              ))}
            </span>
          )}
          <div className="mt-2.5 flex gap-2">
            {paces[packIndex] && <Tile value={paces[packIndex]!} label={t('packPace')} />}
            {hi > 0 && <Tile value={`${approx}${lo !== hi ? `${lo}–${hi}` : hi}`} label={tc('km')} />}
            {s.durationSec > 0 && <Tile value={`~${formatDurationClock(s.durationSec)}`} label={t('hours')} />}
          </div>
        </>
      ) : (
        <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-page/70 p-3">
          <Hourglass className="mt-0.5 h-5 w-5 flex-none text-ink-400" strokeWidth={1.8} />
          <span>
            <b className="block text-[15px] text-ink-900">{t('tmrPending')}</b>
            <span className="text-13 leading-normal text-ink-500">{t('tmrPendingBody')}</span>
          </span>
        </div>
      )}

      <SessionRsvp weekStart={weekStart} day={dayOfWeek} paces={paces} whenLabel={td('tomorrow')} onAnswered={() => setOpen(false)} />
    </div>
    </>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col rounded-xl bg-page/70 px-2.5 py-1.5">
      <b className="whitespace-nowrap text-[16px] font-extrabold text-ink-900"><bdi dir="ltr">{value}</bdi></b>
      <span className="truncate text-[11.5px] text-ink-400">{label}</span>
    </span>
  );
}

/**
 * The same card, reading its own session — for the inbox's "מחכה לתשובה שלך", where the
 * day-before reminder names only the week and the day (`?rsvp=weekStart:day`).
 */
export function TomorrowSession({ weekStart, day }: { weekStart: string; day: number }) {
  const { data: week } = useApi<{ hasPlan?: boolean; lane?: number | null; sessions?: WeekSession[] }>(`/api/plans/week?weekStart=${weekStart}&lane=mine`);
  const { data: reminder } = useApi<{ config?: { workoutHour?: number } }>('/api/reminder-config');
  if (!week || !reminder) return <div className="h-[220px] animate-pulse rounded-[22px] bg-card" />;
  const sessions = (week.sessions ?? []).filter((s) => s.dayOfWeek === day && s.kmMax > 0);
  const hour = reminder.config?.workoutHour;
  const time = sessions[0]?.daySession?.startTime
    ?? (typeof hour === 'number' ? `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}` : null);
  const lane = week.lane ?? null;
  return (
    <TomorrowCard
      date={addDaysToDateStr(weekStart, day)}
      weekStart={weekStart}
      dayOfWeek={day}
      sessions={sessions}
      lane={lane}
      packIndex={Math.min(2, Math.max(0, (lane ?? 2) - 1))}
      time={time}
    />
  );
}
