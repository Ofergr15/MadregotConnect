'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi } from '@/lib/api';
import { addDaysToDateStr, cn, getPlanWeekStart, israelToday } from '@/lib/utils';
import { useNavIdentity } from '@/lib/nav-items';
import { Sheet } from '@/components/ui';
import { SessionRsvp } from '@/components/feed/SessionRsvp';
import { RICH, kmText } from '@/components/academy/book/ui';
import { ProfileStrip, WorkoutLines } from '@/components/day-session/WorkoutLines';
import { packPace, paceRangeText } from '@/lib/plans/session-profile';
import type { Lineup } from '@/lib/attendance/lineup';
import { DAY_SESSION_FOR_ALL } from '@/lib/day-session/flag';
import {
  numberRuns, planCoversDay, planLinks, totalsOf,
  type DaySession, type NutritionWhen, type ProgramWeekLike, type WeekPlanLike,
} from '@/lib/day-session/model';

// ═════════════════════════════════════════════════════════════════════════════
// "אימון ליום אחד" ON THE FEED (mockup manual-day-workout, phones 3–5)
//
// A session the coach typed for one date when there is no weekly plan yet: from
// the moment it is published until after the workout (the route's isOnFeed
// decides), at the top of the feed. The RSVP is the next-session card's own
// SessionRsvp — it keys on (week, day), so the answer lands in the same
// workout_attendance row the reminder push and the dashboard write, and the
// coach's lineup for that day needs nothing new.
//
// The plan wins: when the week's plan has a run on that day, this card draws
// nothing and NextSessionCard shows the plan's session — never both.
//
// Under it, the week's two plans: coloured and tappable when uploaded, a grey
// dashed "עוד אין" that is not a link when not.
// ═════════════════════════════════════════════════════════════════════════════

const FOOD_ICON: Record<NutritionWhen, string> = { before: '🍌', during: '💧', after: '🥤' };

export function DaySessionCard() {
  const t = useTranslations('daySession');
  const tc = useTranslations('common');
  const { isSuper } = useNavIdentity();
  const [foodOpen, setFoodOpen] = useState(false);

  // While the flag is off only the super user asks; the route answers anyone
  // else with an empty list anyway.
  const { data } = useApi<{ setup: boolean; sessions: DaySession[] }>(DAY_SESSION_FOR_ALL || isSuper ? '/api/day-session' : null);
  const s = data?.sessions?.[0] ?? null;

  const weekStart = s ? getPlanWeekStart(new Date(`${s.date}T12:00:00`)) : null;
  const dow = s ? new Date(`${s.date}T12:00:00`).getDay() : 0;
  const { data: plan } = useApi<WeekPlanLike>(weekStart ? `/api/plans/week?weekStart=${weekStart}` : null);
  const { data: weeks } = useApi<ProgramWeekLike[]>(s ? '/api/program-weeks' : null);
  // Same key SessionRsvp asks for: one request, and the reader's own pack.
  const { data: lineup } = useApi<Lineup & { homeIndex: number }>(weekStart ? `/api/attendance/lineup?weekStart=${weekStart}&day=${dow}` : null);

  if (!s || !weekStart || !plan) return null;
  if (planCoversDay(plan, dow)) return null;

  const dayNames = tc.raw('dayNames') as string[];
  const rtl = tc('km') !== 'km';
  const Chevron = rtl ? ChevronLeft : ChevronRight;
  const today = israelToday();
  const whenWord = s.date === today ? t('today') : s.date === addDaysToDateStr(today, 1) ? t('tomorrow') : '';
  const totals = totalsOf(s.steps);
  const home = lineup && lineup.homeIndex >= 0 ? lineup.homeIndex : null;
  // Each pack's pace for the RSVP, from the steps themselves (the same rule as the plan's card).
  const paces = [0, 1, 2].map((i) => { const p = packPace(s.steps, i); return p ? paceRangeText(p) : null; });
  const links = planLinks(weekStart, plan, weeks);
  const foodSummary = s.nutrition.filter((l) => l.when !== 'during').map((l) => `${t(l.when)}: ${l.text}`).join(' · ')
    || s.nutrition.map((l) => `${t(l.when)}: ${l.text}`).join(' · ');

  const linkRow = (label: string, icon: string, live: { href: string } | null, line: React.ReactNode) => {
    const inner = (
      <>
        <span aria-hidden className="text-lg">{icon}</span>
        <span className={cn('min-w-0 flex-1 truncate text-sm font-extrabold', live ? 'text-ink-900' : 'text-ink-400')}>{label}</span>
        <span className={cn('shrink-0 text-xs font-bold', live ? 'text-brand-600' : 'text-ink-400')}>{line}</span>
        {live && <Chevron className="h-4 w-4 shrink-0 text-brand-600" />}
      </>
    );
    return live ? (
      <Link href={live.href} className="flex min-h-[48px] items-center gap-2.5 rounded-2xl bg-brand-600/[0.07] px-3 active:opacity-80">{inner}</Link>
    ) : (
      <div aria-disabled="true" className="flex min-h-[48px] items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-[#D7D8E0] px-3">{inner}</div>
    );
  };

  return (
    <>
      <div className="rounded-[26px] border-2 border-brand-600 bg-card p-4 shadow-[0_10px_28px_-14px_rgba(20,24,60,0.22)]">
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-bold text-ink-400">{[whenWord, dayNames[dow]].filter(Boolean).join(' · ')}</span>
          <span className="min-w-0 truncate text-xs font-bold text-ink-500">
            {s.startTime && <bdi dir="ltr" className="font-extrabold text-ink-900">{s.startTime}</bdi>}
            {s.startTime && s.place ? ' · ' : ''}{s.place}
          </span>
        </div>
        <h2 className="mt-1 font-[ui-rounded,system-ui] text-[28px] font-bold leading-tight tracking-tight text-ink-900">
          <Runs text={s.title} />
        </h2>
        <p className="mt-1 text-13 font-semibold text-ink-400">
          {totals.distanceM > 0 && <>{t.rich('totals', { ...RICH, km: kmText(totals.distanceM), min: Math.round(totals.durationSec / 60) })}</>}
        </p>
        <ProfileStrip steps={s.steps} className="mt-3" />
        {/* The workout as the coach wrote it, the reader's own pack in blue. */}
        <WorkoutLines steps={s.steps} highlight={home ?? undefined} className="mt-2" />
        {s.description && (
          <p dir="auto" className="mt-3 whitespace-pre-line break-words rounded-2xl bg-page px-3 py-2.5 text-[15px] leading-snug text-ink-700">
            {s.description}
          </p>
        )}

        {/* Only a quality session asks who is coming. */}
        {s.quality && <SessionRsvp weekStart={weekStart} day={dow} paces={paces} whenLabel={whenWord || dayNames[dow]} />}

        {s.nutrition.length > 0 && (
          <button
            type="button"
            onClick={() => setFoodOpen(true)}
            className="mt-3 flex min-h-[52px] w-full items-center gap-2.5 rounded-2xl bg-[#E4F6F0] px-3 py-2 text-start active:opacity-80"
          >
            <span aria-hidden className="text-xl">🍽️</span>
            <span className="min-w-0 flex-1">
              <b className="block text-sm font-extrabold text-[#0B7258]">{t('foodRow')}</b>
              <small className="block truncate text-xs text-ink-500">{foodSummary}</small>
            </span>
            <Chevron className="h-4 w-4 shrink-0 text-[#0B7258]" />
          </button>
        )}

        <div className="mt-2 space-y-2">
          {linkRow(t('weeklyPlan'), '📋', links.weekly, links.weekly
            ? <>{t('weeklyLine', { sessions: links.weekly.sessions })}{links.weekly.km > 0 && t.rich('weeklyKm', { ...RICH, km: links.weekly.km })}</>
            : t('none'))}
          {linkRow(t('nutritionPlan'), '🥗', links.nutrition, links.nutrition ? t('nutritionLine') : t('none'))}
        </div>
      </div>

      <Sheet open={foodOpen} onOpenChange={setFoodOpen} title={t('nutrition')}>
        <div dir="rtl" className="space-y-3 pb-2">
          <p className="text-13 font-bold text-ink-400">
            {t('sheetFor', { when: whenWord || dayNames[dow], day: dayNames[dow] })}
            {s.startTime && <> <bdi dir="ltr">{s.startTime}</bdi></>}
          </p>
          <div className="overflow-hidden rounded-[18px] bg-white">
            {s.nutrition.map((l, i) => (
              <div key={i} className="flex items-start gap-2.5 border-b border-[#EFEFF4] px-3.5 py-2.5 last:border-0">
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#E4F6F0] text-base">{FOOD_ICON[l.when]}</span>
                <span className="min-w-0">
                  <b className="block text-13 font-extrabold text-[#0B7258]">{t(l.when)}</b>
                  <span className="block text-[15px] leading-snug text-ink-900">{l.text}</span>
                </span>
              </div>
            ))}
          </div>
          {(s.byName || s.updatedAt) && (
            <p className="text-center text-xs text-ink-400">
              {[s.byName ? t('by', { name: s.byName }) : null, s.updatedAt ? t('updated', { time: updatedText(s.updatedAt) }) : null].filter(Boolean).join(' · ')}
            </p>
          )}
          <button type="button" onClick={() => setFoodOpen(false)} className="flex h-12 w-full items-center justify-center rounded-2xl bg-page text-base font-extrabold text-ink-700">
            {t('close')}
          </button>
        </div>
      </Sheet>
    </>
  );
}

/** The title with each number run in an LTR isolate (`6 × 1` never flips). */
function Runs({ text }: { text: string }) {
  return <>{numberRuns(text).map((r, i) => (r.ltr ? <bdi key={i} dir="ltr">{r.text}</bdi> : <span key={i}>{r.text}</span>))}</>;
}

/** "17:40", Israel wall clock. */
function updatedText(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
