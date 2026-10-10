'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, GraduationCap } from 'lucide-react';
import { cn, israelToday } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { EmptyState, Sheet, SkeletonList } from '@/components/ui';
import { DAY_LABELS } from '@/lib/academy/characterization';
import { fmtKm, fmtPace } from '@/lib/academy/pace-verdict';
import { weekDates, type HomeWorkout, type TraineeHome } from '@/lib/academy/trainee-home';
import type { TestInvitation } from '@/lib/academy/testInvite';
import { initialsOf, shiftWeek, sundayOf } from './types';
import { AcademyThreadPanel } from './AcademyThreadPanel';
import { MyInvitation } from './MyInvitation';
import { MyTestsCard } from './MyTestsCard';
import { PaceText } from './PaceMark';
import { BidiText } from '@/components/BidiText';
import { WorkoutPlanSheet } from './WorkoutPlanSheet';
import { joinHebrewList } from '@/lib/academy/members';
import { CoachAvatarStack } from './CoachAvatarStack';

// The academy as one of its trainees sees it — mockup academy-trainee-home-v4.
//
// Screen one, above the fold on an iPhone 14: who coaches me (and whether they
// wrote), what I'm training for and how long is left, my paces, twelve weeks of
// kilometres ending at this one, and this week's plan day by day with what I
// actually ran under each session. Screen two, "המסע שלי": the long-run numbers and
// my tests.
//
// What is NOT here any more, on purpose (2026-10-06): the leaderboard, the rank,
// "the academy this week" and the mini-stats. In a 1:1 academy the comparison
// that matters is me against my plan, and a table of teammates' kilometres on the
// screen about my training answered a question nobody asked it.
//
// Every pace on the screen goes through ONE rule (lib/academy/pace-verdict.ts):
// green on plan, green ▲ faster, orange ▼ slower. Tapping a session opens its
// plan-vs-actual sheet; tapping the coach opens the conversation.
//
// Reads /api/academy/me, gated self-or-staff, about this one trainee only.

const RING_C = 2 * Math.PI * 15;

/** "4.10" */
function dm(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

/** "4–10.10", or "27.9–3.10" across a month. */
function weekRange(weekStart: string): string {
  const [first, , , , , , last] = weekDates(weekStart);
  const a = new Date(`${first}T12:00:00Z`);
  const b = new Date(`${last}T12:00:00Z`);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${dm(last)}`
    : `${dm(first)}–${dm(last)}`;
}

export function AcademyMyView({ athleteId, openThread = false, raiseTest = false }: {
  /** `null` while the id is still being read from storage; `''` once we've looked and found nobody. */
  athleteId: string | null;
  /** `?thread=mine` — a push about the conversation was tapped: open it. */
  openThread?: boolean;
  /** `?test=mine` — a test reminder was tapped: bring the test card into view. */
  raiseTest?: boolean;
}) {
  const t = useTranslations('academy');
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));
  const [today] = useState(() => israelToday());
  /** Set by `MyInvitation`, so the top slot only takes room when there is a card in it. */
  const [hasInvitation, setHasInvitation] = useState(false);
  const [invitation, setInvitation] = useState<TestInvitation | null>(null);
  /**
   * Set when a result is saved from the tests card, read by `MyInvitation` at the
   * top. The two fetch independently — deliberately, so a bad minute on the trend
   * endpoint cannot cost somebody the date of their test — so only this screen
   * knows that saving a result changes what the invitation should say.
   */
  const [resultJustSent, setResultJustSent] = useState(false);
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  /** The dot clears as soon as the conversation has been opened once. */
  const [threadSeen, setThreadSeen] = useState(false);
  const testsRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useApi<TraineeHome>(
    athleteId ? `/api/academy/me?athleteId=${encodeURIComponent(athleteId)}&weekStart=${weekStart}` : null,
  );

  const openConversation = useCallback(() => {
    setSheetDate(null);
    setThreadOpen(true);
    setThreadSeen(true);
  }, []);

  // A push lands here with `?thread=mine`. Followed when it flips, so a second tap
  // while the screen is open opens the sheet again.
  useEffect(() => { if (openThread) openConversation(); }, [openThread, openConversation]);

  // `?test=mine`: the invitation (when there is one) sits at the very top already;
  // otherwise the tests card is below the fold and is scrolled to.
  const loaded = !!data?.isMember;
  useEffect(() => {
    if (!raiseTest || !loaded) return;
    const id = setTimeout(() => {
      const target = hasInvitation ? topRef.current : testsRef.current;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
    return () => clearTimeout(id);
  }, [raiseTest, loaded, hasInvitation]);

  const isCurrentWeek = weekStart === sundayOf(new Date());

  if (athleteId === null || (!!athleteId && isLoading && !data)) {
    return <div className="p-4"><SkeletonList count={6} /></div>;
  }

  // "You're not in the academy" is a legitimate answer, not an error — a club
  // runner who lands here gets told how to join rather than an empty dashboard.
  if (!athleteId || (data && !data.isMember)) {
    return <EmptyState icon={GraduationCap} title={t('notMemberTitle')} description={t('notMemberDesc')} />;
  }

  const coach = data?.coach ?? null;
  // Every coach (a shared trainee has several, all equal); an older payload has
  // only `coach`.
  const coachList = data?.coaches?.length ? data.coaches : coach ? [coach] : [];
  const firstOf = (name: string) => name.split(' ')[0];
  // "Dana" or "Dana ו־Guy" — the header line and the conversation's title.
  const coachFirst = coachList.length ? joinHebrewList(coachList.map((c) => firstOf(c.name))) : null;
  const multi = coachList.length > 1;
  const unread = !threadSeen && (data?.unread ?? 0) > 0;
  const week = data?.week;
  const byDate = new Map((week?.workouts ?? []).map((w) => [w.date, w]));
  const doneKm = (week?.workouts ?? []).reduce((sum, w) => sum + (w.actualM ?? 0), 0);

  return (
    <div className="flex flex-col gap-[7px]" dir="rtl" ref={topRef}>
      {/* The invitation FIRST, above everything: it is the one card on this screen that
          asks the trainee for something with a date on it, and on a test day it is the
          only thing they came for. Outside the tests card on purpose — that one renders
          nothing when its request fails, which is right for history and wrong for an
          appointment. */}
      {data?.athlete?.athleteId && (
        <div className={cn(!hasInvitation && 'hidden')}>
          <MyInvitation
            athleteId={data.athlete.athleteId}
            watchConnected={data.athlete.hasWatch}
            onVisible={setHasInvitation}
            onInvitation={setInvitation}
            resultJustSent={resultJustSent}
          />
        </div>
      )}

      {/* ── Header: the coach, the title, the week ── */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={openConversation}
          aria-label={unread ? `${coach ? `הודעה חדשה מ${coachFirst}` : 'הודעה חדשה'} · לפתיחת השיחה` : 'לפתיחת השיחה'}
          className={cn(
            'relative grid h-11 shrink-0 place-items-center text-13 font-extrabold text-white active:scale-95 transition-transform',
            multi ? 'min-w-11' : 'w-11 rounded-full bg-brand-600',
          )}
        >
          {multi
            ? <CoachAvatarStack coaches={coachList} size={36} />
            : coach?.avatarUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={coach.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
            : coach ? initialsOf(coach.name) : <GraduationCap className="h-5 w-5" />}
          {unread && <i className="absolute -top-px start-[-1px] h-3 w-3 rounded-full border-2 border-page bg-accent-red" aria-hidden />}
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-black leading-tight text-ink-700">האקדמיה שלי</h1>
          <p className="truncate text-xs text-ink-400">
            {/* RTL, not auto, for "Dana ו־Guy": auto would read the Latin first name and
                lay the ו־ out left-to-right, glued to the wrong name. */}
            {coachFirst && <>עם <span dir={multi ? 'rtl' : 'auto'}>{coachFirst}</span> · </>}
            {isCurrentWeek ? 'השבוע' : 'שבוע'} <bdi dir="ltr">{weekRange(weekStart)}</bdi>
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setWeekStart(shiftWeek(weekStart, -1))}
            aria-label={t('previousWeek')}
            className="grid h-11 w-11 place-items-center rounded-full bg-card text-ink-500 active:scale-95"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(shiftWeek(weekStart, 1))}
            disabled={isCurrentWeek}
            aria-label={t('nextWeek')}
            className="grid h-11 w-11 place-items-center rounded-full bg-card text-ink-500 active:scale-95 disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── What I'm training for ── */}
      {data?.goal && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-gradient-to-l from-brand-600 to-[#3B49FF] px-2.5 py-[7px] text-white">
          <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl bg-white/20 text-lg" aria-hidden>🏁</span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[14.5px] font-black leading-5"><BidiText text={data.goal.title} /></b>
            {data.goal.subtitle && <small className="block truncate text-xs leading-4 opacity-90"><BidiText text={data.goal.subtitle} /></small>}
          </div>
          {data.goal.daysLeft != null && (
            <div className="shrink-0 rounded-xl bg-white/15 px-2.5 py-1 text-center">
              <b className="block text-xl font-black leading-none tabular-nums">{data.goal.daysLeft}</b>
              <span className="block text-3xs leading-3 opacity-85">ימים</span>
            </div>
          )}
        </div>
      )}

      {/* ── My paces ── */}
      {data?.paces && (
        <div className="flex gap-1.5">
          {data.paces.bandNumber != null && (
            <PaceTile value={String(data.paces.bandNumber)} label="דבוקה" highlight />
          )}
          <PaceTile value={fmtPace(data.paces.easy)} label="קל" />
          <PaceTile value={fmtPace(data.paces.tempo)} label="טמפו" />
          <PaceTile value={fmtPace(data.paces.threshold)} label="סף" />
          <PaceTile value={fmtPace(data.paces.interval)} label="אינטרוול" />
        </div>
      )}

      {/* ── Twelve weeks of kilometres ── */}
      {data?.km && week && (
        <KmCard
          weeks={data.km.weeks}
          plannedKm={data.km.plannedKm}
          avgKm={data.km.avgKm}
          doneKm={Math.round(doneKm / 100) / 10}
          isCurrentWeek={isCurrentWeek}
          completed={week.completedCount}
          planned={week.plannedCount}
        />
      )}

      {/* ── This week, Sunday to Saturday ── */}
      <div className="overflow-hidden rounded-2xl bg-card">
        {!week || week.workouts.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-ink-400">{t('noPlannedWorkouts')}</p>
        ) : (
          weekDates(weekStart).map((date) => {
            const w = byDate.get(date);
            const day = DAY_LABELS[new Date(`${date}T12:00:00Z`).getUTCDay()];
            if (!w) {
              return (
                <div key={date} className="flex min-h-[26px] items-center gap-2.5 border-b border-page/60 px-3 last:border-0">
                  <span className="w-8 shrink-0 text-center text-[12.5px] font-black text-ink-300">{day}</span>
                  <span className="text-xs text-ink-300">מנוחה</span>
                </div>
              );
            }
            return (
              <WorkoutRow key={date} w={w} day={day} isToday={date === today} onOpen={() => setSheetDate(date)} />
            );
          })
        )}
        {/* The whole week (book v3): totals, the colour strips, what is on the watch. */}
        <Link
          href={`/dashboard/academy/week?weekStart=${weekStart}`}
          className="flex min-h-[44px] items-center justify-center gap-0.5 border-t border-page/60 text-[12.5px] font-extrabold text-brand-600"
        >
          {t('openWeek')} <ChevronLeft className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* ── Below the fold: the journey ── */}
      {data?.journey && (
        <section className="mt-5 flex flex-col gap-[7px]">
          <h2 className="px-0.5 text-[15px] font-black text-ink-700">המסע שלי</h2>
          <div className="grid grid-cols-3 gap-[7px]">
            <JourneyTile value={data.journey.monthsWithUs != null ? String(data.journey.monthsWithUs) : '—'} label="חודשים איתנו" />
            <JourneyTile value={String(data.journey.runs)} label="ריצות הושלמו" />
            <JourneyTile value={String(data.journey.km)} label="ק״מ" />
            <JourneyTile value={data.journey.planPct != null ? `${data.journey.planPct}%` : '—'} label="מהתוכנית בוצע" />
            <JourneyTile value={String(data.journey.streakWeeks)} label="שבועות ברצף" />
            <JourneyTile value={data.journey.longestKm != null ? fmtKm(data.journey.longestKm * 1000) : '—'} label="הכי ארוכה (ק״מ)" />
          </div>
          {data.athlete?.athleteId && (
            <MyTestsCard
              ref={testsRef}
              athleteId={data.athlete.athleteId}
              name={data.athlete.name}
              invitation={invitation}
              onRecorded={() => setResultJustSent(true)}
            />
          )}
        </section>
      )}

      {data?.athlete?.athleteId && (
        <WorkoutPlanSheet
          athleteId={data.athlete.athleteId}
          date={sheetDate}
          coachName={coach?.name ?? null}
          onOpenChange={(open) => { if (!open) setSheetDate(null); }}
          onOpenThread={openConversation}
        />
      )}

      {/* The conversation, over the home: newest at the bottom and in view, the
          composer pinned under it, the older messages behind one tap. */}
      <Sheet
        open={threadOpen}
        onOpenChange={setThreadOpen}
        title={coachFirst ? `השיחה עם ${coachFirst}` : 'השיחה שלי'}
        className="h-[88dvh]"
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden pb-3"
      >
        {threadOpen && (
          <AcademyThreadPanel athleteId={data?.athlete?.athleteId} layout="sheet" className="min-h-0 flex-1" />
        )}
      </Sheet>
    </div>
  );
}

function PaceTile({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <div className={cn('flex-1 rounded-xl px-0.5 py-1 text-center', highlight ? 'bg-brand-600/10' : 'bg-card')}>
      <b className={cn('block text-[14.5px] font-black leading-[19px] tabular-nums', highlight ? 'text-brand-600' : 'text-ink-700')}>
        <bdi dir="ltr">{value}</bdi>
      </b>
      <span className="block text-3xs text-ink-400">{label}</span>
    </div>
  );
}

function JourneyTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[14px] bg-card px-2 py-[9px] text-center">
      <b className="block text-[21px] font-black leading-tight text-ink-700"><bdi dir="ltr">{value}</bdi></b>
      <span className="text-2xs text-ink-400">{label}</span>
    </div>
  );
}

// ── The km chart ────────────────────────────────────────────────────────────
// Time runs left to right whatever the page direction: it is an SVG, and a
// timeline that ran right-to-left would put "this week" under the trainee's
// thumb's opposite edge from every other chart in the app. One hue: the brand
// blue for this week, its light tint for the weeks before, a dashed outline for
// what is planned this week, and a dashed line for the average.

const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

function KmCard({ weeks, plannedKm, avgKm, doneKm, isCurrentWeek, completed, planned }: {
  weeks: Array<{ weekStart: string; km: number }>;
  plannedKm: number;
  avgKm: number | null;
  doneKm: number;
  isCurrentWeek: boolean;
  completed: number;
  planned: number;
}) {
  const W = 330, base = 54, y0 = 6, r = 4;
  const n = Math.max(weeks.length, 1);
  const slot = W / n;
  const bw = Math.max(4, slot - 7);
  const max = Math.max(...weeks.map((w) => w.km), plannedKm, avgKm ?? 0, 1) * 1.08;
  const h = (v: number) => ((base - y0) * v) / max;
  const bar = (x: number, height: number) => (height <= r
    ? `M${x},${base} v${-height} h${bw} v${height} z`
    : `M${x},${base} v${-(height - r)} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} v${height - r} z`);

  // Three ticks: the first month, the first month change in the middle, and the end.
  const ticks: Array<[number, string]> = [];
  if (weeks.length) {
    const month = (i: number) => new Date(`${weeks[i].weekStart}T12:00:00Z`).getUTCMonth();
    ticks.push([0, MONTHS[month(0)]]);
    for (let i = 3; i < weeks.length - 3; i++) {
      if (month(i) !== month(i - 1)) { ticks.push([i, MONTHS[month(i)]]); break; }
    }
    ticks.push([weeks.length - 1, isCurrentWeek ? 'השבוע' : 'שבוע זה']);
  }

  return (
    <div className="rounded-2xl bg-card px-3 pb-1.5 pt-2">
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-[15px] font-black text-ink-700">
          {isCurrentWeek ? 'השבוע' : 'בשבוע'} <bdi dir="ltr">{fmtKm(doneKm * 1000)}</bdi>{' '}
          <span className="text-xs font-semibold text-ink-400">מתוך <bdi dir="ltr">{fmtKm(plannedKm * 1000)}</bdi> ק״מ</span>
        </b>
        <span className="shrink-0 text-xs font-bold text-ink-400">{completed} מתוך {planned} אימונים</span>
      </div>
      <svg viewBox={`0 0 ${W} 64`} className="mt-1 block h-16 w-full overflow-visible" role="img"
        aria-label={`ק״מ ב־${weeks.length} השבועות האחרונים`}>
        {[0, 0.5, 1].map((g) => (
          <line key={g} x1={0} x2={W} y1={base - (base - y0) * g} y2={base - (base - y0) * g} stroke="#EEEEF2" />
        ))}
        {weeks.map((w, i) => {
          const x = i * slot + (slot - bw) / 2;
          const last = i === weeks.length - 1;
          return (
            <g key={w.weekStart}>
              {last && plannedKm > 0 && (
                <path d={bar(x, h(plannedKm))} fill="#F4F5FF" stroke="#1525FF" strokeWidth={1.5} strokeDasharray="3 2" />
              )}
              {w.km > 0 && <path d={bar(x, h(w.km))} fill={last ? '#1525FF' : '#9FA8FF'} />}
            </g>
          );
        })}
        {avgKm != null && avgKm > 0 && (
          <line x1={0} x2={W} y1={base - h(avgKm)} y2={base - h(avgKm)} stroke="#2D2E38" strokeDasharray="2 3" opacity={0.45} />
        )}
        {ticks.map(([i, label]) => (
          <text key={i} x={i * slot + slot / 2} y={64} textAnchor="middle" fontSize={10} fill="#5F5F5F">{label}</text>
        ))}
      </svg>
      <div className="mt-0.5 flex gap-2.5 text-3xs text-ink-400">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-[9px] w-[9px] rounded-[3px] bg-brand-600" />נרץ</span>
        <span className="inline-flex items-center gap-1"><svg viewBox="0 0 10 10" className="h-[9px] w-[9px]" aria-hidden><rect x="0.75" y="0.75" width="8.5" height="8.5" rx="2.5" fill="none" stroke="#1525FF" strokeWidth="1.5" strokeDasharray="2.5 1.5" /></svg>מתוכנן {isCurrentWeek ? 'השבוע' : ''}</span>
        {avgKm != null && <span className="ms-auto font-bold">ממוצע {weeks.length} שבועות: <bdi dir="ltr">{Math.round(avgKm)}</bdi></span>}
      </div>
    </div>
  );
}

// ── One day of the week ─────────────────────────────────────────────────────

function WorkoutRow({ w, day, isToday, onOpen }: {
  w: HomeWorkout;
  day: string;
  isToday: boolean;
  onOpen: () => void;
}) {
  const s = w.status;
  const km = (m: number | null) => fmtKm(m);
  let sub: React.ReactNode;
  if (s.kind === 'done' || s.kind === 'partial') {
    sub = (
      <>
        {s.kind === 'partial'
          ? <span><bdi dir="ltr">{km(w.actualM)}</bdi> מתוך <bdi dir="ltr">{km(w.plannedM)}</bdi> ק״מ</span>
          : <span><bdi dir="ltr">{km(w.actualM)}</bdi> ק״מ</span>}
        {w.pace && <> · <PaceText pace={w.pace.actual} verdict={w.pace.verdict} /></>}
      </>
    );
  } else if (s.kind === 'missed') {
    sub = <span><bdi dir="ltr">{km(w.plannedM)}</bdi> ק״מ · לא בוצע</span>;
  } else if (isToday && w.plannedDurationSec) {
    sub = <span><bdi dir="ltr">{km(w.plannedM)}</bdi> ק״מ · כ־{Math.round(w.plannedDurationSec / 60)} דק׳</span>;
  } else {
    sub = (
      <span>
        <bdi dir="ltr">{km(w.plannedM)}</bdi> ק״מ
        {w.plannedPace != null && <> · <bdi dir="ltr">{fmtPace(w.plannedPace)}</bdi></>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full flex-wrap items-center gap-x-2.5 border-b border-page/60 px-3 text-start last:border-0 active:bg-page/30',
        isToday ? 'border-s-4 border-s-brand-600 bg-brand-600/[0.05] py-[9px]' : 'min-h-[47px]',
      )}
    >
      <span className="w-8 shrink-0 text-center leading-[1.05]">
        <b className={cn('block text-sm font-black', isToday ? 'text-brand-600' : 'text-ink-700')}>{day}</b>
        <span className="text-3xs text-ink-400"><bdi dir="ltr">{dm(w.date)}</bdi></span>
      </span>
      <span className="min-w-0 flex-1">
        <b className="flex items-center text-[14.5px] font-extrabold text-ink-700">
          {/* Pinned number runs: "6×800" otherwise renders as "800×6" in this RTL line. */}
          <span className="truncate"><BidiText text={w.name} /></span>
          {isToday && <span className="ms-1.5 shrink-0 rounded-[5px] bg-brand-600 px-1.5 text-3xs font-black leading-[15px] text-white">היום</span>}
        </b>
        <span className="mt-px flex items-center gap-1.5 text-xs text-ink-400">
          <span className="min-w-0 truncate">{sub}</span>
          {w.hasFeedback && <span className="shrink-0 rounded-md bg-brand-600/10 px-1 text-2xs font-extrabold text-brand-600" aria-label="יש משוב מהמאמן">💬</span>}
        </span>
      </span>
      <span className="w-[42px] shrink-0 text-center"><RowMark status={s} /></span>
      {isToday && w.steps && w.steps.length > 0 && (
        <span
          className="mt-1.5 grid basis-full gap-1 ps-[42px]"
          style={{ gridTemplateColumns: w.steps.map((st) => (st.kind === 'main' ? '1.5fr' : '1fr')).join(' ') }}
        >
          {w.steps.map((st, i) => (
            <span
              key={i}
              className={cn(
                'flex flex-col items-center rounded-[9px] px-1 py-1 text-center text-2xs leading-tight',
                st.kind === 'main' ? 'bg-brand-600 text-white' : 'bg-card text-ink-700',
              )}
            >
              <span className="line-clamp-1">{st.label}</span>
              {st.pace != null && <b className="text-sm font-black"><bdi dir="ltr">{fmtPace(st.pace)}</bdi></b>}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

/** The mark at the end of a row — a ring for what was run, ✕ for what was missed, an empty circle for what is to come. */
function RowMark({ status }: { status: HomeWorkout['status'] }) {
  if (status.kind === 'missed') {
    return (
      <span className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-accent-red/10 text-13 font-black text-accent-red" aria-label="לא בוצע">✕</span>
    );
  }
  if (status.kind === 'upcoming') {
    return <span className="mx-auto block h-7 w-7 rounded-full border-2 border-ink-300" aria-label="מתוכנן" />;
  }
  const partial = status.kind === 'partial';
  const pct = partial ? status.pct : status.score ?? 100;
  const label = partial ? `${status.pct}%` : status.score != null ? String(status.score) : '✓';
  return (
    <span className="relative mx-auto block h-[38px] w-[38px]" aria-label={partial ? `בוצע ${status.pct}% מהמרחק` : status.score != null ? `דיוק ${status.score}` : 'בוצע'}>
      <svg viewBox="0 0 36 36" className="h-[38px] w-[38px] -rotate-90">
        <circle cx={18} cy={18} r={15} fill="none" stroke={partial ? '#FDEBDD' : '#E3F5EA'} strokeWidth={4} />
        <circle
          cx={18} cy={18} r={15} fill="none"
          stroke={partial ? '#E8893A' : '#1FA55B'}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${(Math.max(0, Math.min(100, pct)) / 100) * RING_C} ${RING_C}`}
        />
      </svg>
      <b className="absolute inset-0 grid place-items-center text-2xs font-black text-ink-700">{label}</b>
    </span>
  );
}
