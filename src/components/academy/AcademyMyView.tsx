'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Activity, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, GraduationCap,
  Medal, Route, Timer, Trophy, Users, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPace } from '@/lib/garmin/pace';
import { useApi } from '@/lib/api';
import { Card, EmptyState, InsetRow, InsetSection, SkeletonList } from '@/components/ui';
import { fmtRate, fmtWeekRange, initialsOf, rateColor, shiftWeek, sundayOf } from './types';

// The academy as one of its athletes sees it.
//
// Before this, an academy athlete had no academy screen at all: migration 022
// denies `academy_user` the academy nav tab on purpose, because the only thing
// behind it was the coach's admin console. So the answer to "am I keeping up, and
// where do I stand?" was spread across the program tab and the group leaderboard,
// and the academy itself — the thing they signed up for — was invisible.
//
// Reads /api/academy/me, which is gated self-or-staff and returns only what a
// club member can already see about their teammates (first name + weekly
// distance), never the staff roster's emails or approval flags.

interface Workout {
  date: string;
  name: string;
  completed: boolean;
  distance: { plannedMin: number; plannedMax: number; actual: number | null };
  duration: { planned: number; actual: number | null };
  pace: { actual: number | null };
}

interface MyView {
  isMember: boolean;
  weekStart: string;
  athlete?: { athleteId: string; name: string; avatarUrl: string | null; groupName: string | null; hasWatch: boolean };
  week?: { plannedCount: number; completedCount: number; completionRate: number; avgScore: number; workouts: Workout[] };
  volume?: { weekKm: number; weekRuns: number; weekDurationMin: number; totalKm: number; totalRuns: number; totalDurationMin: number };
  rank?: { position: number; of: number } | null;
  academy?: { members: number; activeThisWeek: number; weekKm: number; avgWeekKm: number };
  leaderboard?: { athleteId: string; name: string; avatarUrl: string | null; weekKm: number; isMe: boolean }[];
  results?: { id: string; testName: string; timeSeconds: number; recordedOn: string; rank: number; entrants: number }[];
}

export function AcademyMyView({ athleteId }: {
  /** `null` while the id is still being read from storage; `''` once we've looked and found nobody. */
  athleteId: string | null;
}) {
  const t = useTranslations('academy');
  const locale = useLocale();
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));

  const { data, isLoading } = useApi<MyView>(
    athleteId ? `/api/academy/me?athleteId=${encodeURIComponent(athleteId)}&weekStart=${weekStart}` : null,
  );

  const isCurrentWeek = weekStart === sundayOf(new Date());

  if (athleteId === null || (!!athleteId && isLoading && !data)) {
    return <div className="p-4"><SkeletonList count={6} /></div>;
  }

  // "You're not in the academy" is a legitimate answer, not an error — a club
  // runner who lands here gets told how to join rather than an empty dashboard.
  // Same screen for a visitor we can't identify at all: there's no athlete whose
  // academy week we could show, and a spinner that never resolves is worse.
  if (!athleteId || (data && !data.isMember)) {
    return (
      <EmptyState
        icon={GraduationCap}
        title={t('notMemberTitle')}
        description={t('notMemberDesc')}
      />
    );
  }

  const week = data?.week;
  const vol = data?.volume;
  const academy = data?.academy;
  // The athlete's own rate is recomputed from counts rather than read off
  // `week.completionRate`, so "no plan this week" shows an em dash instead of 0%.
  const myRate = week && week.plannedCount > 0 ? week.completedCount / week.plannedCount : null;

  const km = (meters: number | null) => (meters == null ? '—' : (meters / 1000).toFixed(1));
  const mins = (sec: number | null) => (sec == null ? '—' : String(Math.round(sec / 60)));
  const dayName = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });

  return (
    <div className="space-y-5" dir="auto">
      {/* Week pager */}
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setWeekStart(shiftWeek(weekStart, -1))}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label={t('previousWeek')}
        >
          <ChevronRight className="h-5 w-5 rtl:block hidden" />
          <ChevronLeft className="h-5 w-5 rtl:hidden" />
        </button>
        <div className="text-center min-w-[170px]">
          <div className="text-sm font-semibold text-white">{fmtWeekRange(weekStart, locale)}</div>
          <div className="text-xs text-slate-500">{isCurrentWeek ? t('thisWeek') : ''}</div>
        </div>
        <button
          onClick={() => setWeekStart(shiftWeek(weekStart, 1))}
          disabled={isCurrentWeek}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={t('nextWeek')}
        >
          <ChevronLeft className="h-5 w-5 rtl:block hidden" />
          <ChevronRight className="h-5 w-5 rtl:hidden" />
        </button>
      </div>

      {/* The headline the athlete came for: how much of my week did I do. */}
      <Card variant="solid" className="text-center">
        <div className="text-2xs font-bold uppercase tracking-wider text-slate-500">{t('myWeekHeader')}</div>
        <div className={cn('mt-1.5 text-5xl font-black tabular-nums leading-none', rateColor(myRate))}>
          {fmtRate(myRate)}
        </div>
        <div className="mt-2 text-sm text-slate-300">
          {week && week.plannedCount > 0
            ? t('completedOfPlanned', { done: week.completedCount, planned: week.plannedCount })
            : t('noPlanThisWeek')}
        </div>
        {data?.athlete?.groupName && (
          <div className="mt-2.5 inline-block text-2xs font-bold px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/20">
            {data.athlete.groupName}
          </div>
        )}
      </Card>

      {/* My volume */}
      <div className="grid grid-cols-3 gap-2.5">
        <MiniStat icon={Route} value={vol ? vol.weekKm.toFixed(1) : '0'} label={t('weekKmShort')} />
        <MiniStat icon={Activity} value={String(vol?.weekRuns ?? 0)} label={t('weekRuns')} />
        <MiniStat icon={Timer} value={String(vol?.weekDurationMin ?? 0)} label={t('minUnit')} />
      </div>

      {/* Where I stand — only meaningful once someone ran. */}
      {data?.rank && academy && (
        <Card variant="muted" className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
            <Medal className="h-5 w-5 text-amber-300" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">
              {t('rankOf', { position: data.rank.position, of: data.rank.of })}
            </div>
            <div className="text-xs text-slate-400">{t('rankHint')}</div>
          </div>
        </Card>
      )}

      {/* This week's sessions, planned vs actual. */}
      <div>
        <SectionTitle>{t('myWorkouts')}</SectionTitle>
        <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 overflow-hidden divide-y divide-slate-700/50">
          {!week || week.workouts.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">{t('noPlannedWorkouts')}</p>
          ) : (
            week.workouts.map((w, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <div className="w-9 shrink-0 text-center">
                  <div className="text-2xs text-slate-500 font-semibold">{dayName(w.date)}</div>
                  {w.completed
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto mt-1" />
                    : <XCircle className="h-4 w-4 text-slate-600 mx-auto mt-1" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{w.name}</div>
                  {w.completed ? (
                    <div className="mt-0.5 text-xs text-slate-400 tabular-nums">
                      {km(w.distance.actual)} / {km(w.distance.plannedMin)} {t('kmUnit')}
                      {' · '}
                      {mins(w.duration.actual)} / {mins(w.duration.planned)} {t('minUnit')}
                      {w.pace.actual != null && ` · ${formatPace(w.pace.actual)}`}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs text-slate-500">
                      {km(w.distance.plannedMin)} {t('kmUnit')} · {mins(w.duration.planned)} {t('minUnit')}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* The academy's week, so an athlete sees the group they're part of. */}
      {academy && (
        <InsetSection header={t('academyThisWeek')}>
          <InsetRow icon={Users} iconBg="bg-primary-600" label={t('statMembers')} value={String(academy.members)} />
          <InsetRow icon={Activity} iconBg="bg-emerald-600" label={t('statActiveThisWeek')} value={`${academy.activeThisWeek}/${academy.members}`} />
          <InsetRow icon={Route} iconBg="bg-sky-600" label={t('statAcademyKm')} value={academy.weekKm.toFixed(1)} />
          <InsetRow icon={ClipboardList} iconBg="bg-violet-600" label={t('avgPerMember')} value={academy.avgWeekKm.toFixed(1)} />
        </InsetSection>
      )}

      {/* Leaderboard — first names and distance only, the same club-internal
          shape the feed and the group standings already show. */}
      {(data?.leaderboard?.length ?? 0) > 0 && (
        <div>
          <SectionTitle>{t('leaderboardHeader')}</SectionTitle>
          <div className="space-y-2">
            {data!.leaderboard!.map((r, i) => (
              <div
                key={r.athleteId}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border p-3',
                  r.isMe
                    ? 'bg-primary-600/15 border-primary-500/40'
                    : 'bg-slate-800/50 border-slate-700/50',
                )}
              >
                <span className="w-4 text-center text-xs font-bold text-slate-500 shrink-0">{i + 1}</span>
                {r.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary-600/20 flex items-center justify-center text-xs font-bold text-primary-300 shrink-0">
                    {initialsOf(r.name)}
                  </div>
                )}
                <span className={cn('flex-1 min-w-0 text-sm truncate', r.isMe ? 'font-bold text-white' : 'font-medium text-slate-200')}>
                  {r.name}
                  {r.isMe && <span className="ms-1.5 text-2xs font-semibold text-primary-300">{t('you')}</span>}
                </span>
                <span className="text-sm font-bold text-white tabular-nums shrink-0">
                  {r.weekKm.toFixed(1)} <span className="text-3xs text-slate-500 font-semibold">{t('kmUnit')}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My benchmark results, each with where it placed. */}
      {(data?.results?.length ?? 0) > 0 && (
        <div>
          <SectionTitle>{t('myResults')}</SectionTitle>
          <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 overflow-hidden divide-y divide-slate-700/50">
            {data!.results!.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <Trophy className="h-4 w-4 text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{r.testName}</div>
                  <div className="text-2xs text-slate-500">
                    {t('placedOf', { position: r.rank, of: r.entrants })}
                    {r.recordedOn && ` · ${new Date(`${r.recordedOn}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })}`}
                  </div>
                </div>
                <span className="text-sm font-bold text-white tabular-nums shrink-0">{formatClock(r.timeSeconds)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All-time footer — the long-run number an athlete likes seeing grow. */}
      {vol && (
        <Card variant="muted" className="flex items-center justify-around text-center">
          <div>
            <div className="text-xl font-bold text-white tabular-nums">{vol.totalKm.toFixed(0)}</div>
            <div className="text-2xs text-slate-500">{t('allTimeKm')}</div>
          </div>
          <div className="w-px h-8 bg-slate-700" />
          <div>
            <div className="text-xl font-bold text-white tabular-nums">{vol.totalRuns}</div>
            <div className="text-2xs text-slate-500">{t('allTimeRuns')}</div>
          </div>
          <div className="w-px h-8 bg-slate-700" />
          <div>
            <div className="text-xl font-bold text-white tabular-nums">{Math.round(vol.totalDurationMin / 60)}</div>
            <div className="text-2xs text-slate-500">{t('allTimeHours')}</div>
          </div>
        </Card>
      )}
    </div>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 mb-2 text-sm font-bold text-white">{children}</h2>;
}

function MiniStat({
  icon: Icon, value, label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-800/60 p-3 text-center">
      <Icon className="h-3.5 w-3.5 text-slate-500 mx-auto" />
      <div className="mt-1 text-xl font-bold text-white tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-2xs text-slate-500">{label}</div>
    </div>
  );
}
