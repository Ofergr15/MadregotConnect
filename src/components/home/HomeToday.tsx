'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { apiHeaders, useApi } from '@/lib/api';
import { cn, israelToday } from '@/lib/utils';
import { planDayKey } from '@/lib/plans/workout-parsing';
import { teammateHref } from '@/lib/athletes/profile-link';
import { roundKm } from '@/lib/plans/week-summary';
import { dayStatus } from '@/lib/plans/week-status';
import type { PlanWeekStats } from '@/lib/athletes/plan-week';

/**
 * The runner's home as a morning briefing (Ofer, 2026-10-19, mockups/morning-1019/home-v4):
 * each card answers a question a runner has in the morning, and shows only when it has an
 * answer — my week (with my pack), the club today, the coach's pinned word, last night.
 *
 * "My week" reads the same payload as the profile's "השבוע שלי" (stats.planWeek + the plan
 * week in my lane), so the two screens cannot disagree about a kilometre.
 */

interface PlanWeek {
  hasPlan?: boolean;
  hasClubPlan?: boolean;
  weekTotalMax?: number;
  dailyDistances?: Array<{ dayOfWeek: number; requiredMin?: number; min: number }>;
}
interface Stats { planWeek?: PlanWeekStats; lastNight?: { sleepSeconds: number | null; restingHr: number | null } | null }
interface PackRow { id: string; name: string; avatarUrl: string | null; km: number; rank: number; me: boolean }
interface ClubTodayData {
  runners: number;
  km: number;
  top: Array<{ id: string; name: string; avatarUrl: string | null; km: number; activityId: string | null }>;
  pack: { name: string; rank: number; size: number; lastRank: number | null; gapToFirst: number; rows: PackRow[] } | null;
}

function Avatar({ name, url, size = 28 }: { name: string; url: string | null; size?: number }) {
  return (
    <span className="grid flex-none place-items-center overflow-hidden rounded-full bg-brand-600/10 text-[10px] font-extrabold text-brand-600" style={{ width: size, height: size }}>
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        : name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
    </span>
  );
}

export function HomeToday({ athleteId, href = '/dashboard/program' }: { athleteId: string; /** Where the card opens: the "השבוע" tab (my-week-proposal, 10-20), or an academy trainee's progress tab. */ href?: string }) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const dayShort = tc.raw('dayNamesShort') as string[];
  const { data: stats } = useApi<Stats>(`/api/athletes/${athleteId}/stats`);
  const pw = stats?.planWeek;
  const { data: plan } = useApi<PlanWeek>(pw ? `/api/plans/week?weekStart=${pw.weekStart}&lane=mine` : null);
  const { data: club } = useApi<ClubTodayData>('/api/club/today');
  if (!pw) return null;

  const plannedMin = (d: number) => {
    const dd = plan?.dailyDistances?.find((x) => x.dayOfWeek === d);
    return dd ? dd.requiredMin ?? dd.min : 0;
  };
  const shouldBy = Array.from({ length: pw.today + 1 }, (_, d) => plannedMin(d)).reduce((s, x) => s + x, 0);
  const clubPlan = plan?.hasPlan && plan.hasClubPlan !== false;
  const scale = (clubPlan && plan?.weekTotalMax) || Math.max(pw.avgKm, pw.km * 1.25, shouldBy * 1.25, 10);
  const delta = pw.km - shouldBy;
  const today = israelToday();
  const pack = club?.pack;

  return (
    <Link href={href} className="block rounded-card bg-card p-3.5 shadow-sm">
      <div className="flex items-center gap-3">
        <MiniRing km={pw.km} scale={scale} should={shouldBy} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-extrabold text-ink-500">{t('myWeek')} · {t('weekDay', { n: pw.today + 1 })}</span>
          <b className="block text-[22px] font-black leading-tight text-ink-900">
            <bdi dir="ltr">{roundKm(pw.km)}</bdi> <small className="text-xs font-bold text-ink-500">{tc('km')}</small>
            {shouldBy > 0 && (
              <bdi dir="ltr" className={cn('ms-1.5 text-[13px] font-black', delta >= 0 ? 'text-accent-900' : 'text-band-3-ink')}>{delta >= 0 ? '+' : '−'}{roundKm(Math.abs(delta))}</bdi>
            )}
          </b>
          {(pw.lastWeekSoFar > 0 || pw.km > 0) && (
            <span className="text-xs text-ink-500">{t('sameTimeLastWeek')} <bdi dir="ltr">{roundKm(pw.lastWeekSoFar)}</bdi></span>
          )}
        </span>
        <ChevronLeft className="h-5 w-5 text-ink-300 ltr:rotate-180" />
      </div>

      {/* The seven days at a glance: done / partial / today / still ahead. */}
      <div className="mx-1 mt-2.5 flex justify-between">
        {Array.from({ length: 7 }, (_, d) => {
          const date = planDayKey(pw.weekStart, d);
          const st = dayStatus({ date, today, requiredMin: plannedMin(d), km: pw.days[d] });
          const ran = pw.days[d] > 0;
          return (
            <span key={d} className="flex flex-col items-center gap-0.5">
              <span className={cn('grid h-[18px] w-[18px] place-items-center rounded-full',
                st === 'done' || (st === 'rest' && ran) ? 'bg-accent-600' : st === 'partial' ? 'bg-band-3' : st === 'missed' ? 'bg-accent-red/20' : d === pw.today ? 'border-2 border-brand-600' : 'border-[1.5px] border-dashed border-ink-300')}>
                {(st === 'done' || (st === 'rest' && ran)) && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />}
              </span>
              <span className={cn('text-[11px] font-bold', d === pw.today ? 'text-brand-600' : 'text-ink-400')}>{dayShort[d]}</span>
            </span>
          );
        })}
      </div>

      {/* My pack this week — where I stand, and how that moved since last week. */}
      {pack && pack.size > 1 && pack.rank > 0 && (
        <div className="mt-3 border-t border-page pt-2.5">
          <p className="mb-1 flex items-center justify-between text-13 font-extrabold text-ink-700">
            <span>{t('packThisWeek', { pack: pack.name })}</span>
            {pack.lastRank != null && pack.lastRank !== pack.rank && (
              <span className={cn('text-xs', pack.rank < pack.lastRank ? 'text-accent-900' : 'text-band-3-ink')}>
                {pack.rank < pack.lastRank ? '▲' : '▼'} {t('packFrom', { n: pack.lastRank })}
              </span>
            )}
          </p>
          {pack.rows.map((r) => (
            <div key={r.id} className={cn('flex min-h-[34px] items-center gap-2 text-sm', r.me && '-mx-1.5 rounded-lg bg-brand-600/[0.08] px-1.5')}>
              <span className="w-4 text-center text-xs font-extrabold text-ink-400 tabular-nums">{r.rank}</span>
              <Avatar name={r.name} url={r.avatarUrl} size={24} />
              <span className={cn('min-w-0 flex-1 truncate', r.me && 'font-bold')} dir="auto">{r.me ? t('packYou') : r.name}</span>
              {r.me && pack.gapToFirst > 0 && <span className="text-2xs text-ink-400"><bdi dir="ltr">{roundKm(pack.gapToFirst)}</bdi> {t('packToFirst')}</span>}
              <b className={cn('tabular-nums', r.me ? 'text-brand-600' : 'text-ink-900')}><bdi dir="ltr">{roundKm(r.km)}</bdi></b>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

function MiniRing({ km, scale, should }: { km: number; scale: number; should: number }) {
  const R = 26; const C = 2 * Math.PI * R;
  const f = Math.min(km / scale, 1); const f3 = Math.min(should / scale, 1);
  const a = f3 * 2 * Math.PI - Math.PI / 2;
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden className="flex-none">
      <circle cx="32" cy="32" r={R} fill="none" stroke="#EEF0F6" strokeWidth="7" />
      {km > 0 && <circle cx="32" cy="32" r={R} fill="none" stroke="#1525FF" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${f * C} 999`} transform="rotate(-90 32 32)" />}
      {should > 0 && <circle cx={32 + R * Math.cos(a)} cy={32 + R * Math.sin(a)} r="3.5" fill="#111827" stroke="#fff" strokeWidth="1.5" />}
    </svg>
  );
}

/** One 👏 on a teammate's run — the same kudos the feed and the inbox give. */
function Clap({ activityId, athleteId }: { activityId: string; athleteId: string }) {
  const [given, setGiven] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/activities/${activityId}/kudos?athleteId=${encodeURIComponent(athleteId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setGiven(!!d.givenByMe); })
      .catch(() => {});
  }, [activityId, athleteId]);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const next = !given;
    setGiven(next);
    try {
      await fetch(`/api/activities/${activityId}/kudos`, { method: next ? 'POST' : 'DELETE', headers: await apiHeaders(true), body: JSON.stringify({ athleteId }) });
    } catch { setGiven(!next); }
    setBusy(false);
  };
  return (
    <button type="button" onClick={toggle} aria-pressed={given} aria-label="👏"
      className={cn('grid h-11 w-11 flex-none place-items-center rounded-xl text-lg transition', given ? 'bg-band-3/25' : 'bg-band-3/10 grayscale-[.3]')}>
      👏
    </button>
  );
}

/** "במועדון היום": how many ran and how far, and a 👏 for the ones who ran furthest. */
export function ClubToday({ athleteId }: { athleteId: string }) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const { data } = useApi<ClubTodayData>('/api/club/today');
  if (!data || data.runners === 0) return null;
  const rows = data.top.filter((r) => r.id !== athleteId).slice(0, 3);
  const more = data.runners - rows.length - (data.top.some((r) => r.id === athleteId) ? 1 : 0);
  return (
    <div className="rounded-card bg-card p-3.5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-extrabold text-ink-500">{t('clubToday')}</span>
        <span className="text-xs text-ink-500"><bdi dir="ltr">{data.runners}</bdi> {t('clubRan')} · <bdi dir="ltr">{data.km}</bdi> {tc('km')}</span>
      </div>
      <div className="mt-1.5">
        {rows.map((r) => (
          <div key={r.id} className="flex min-h-[44px] items-center gap-2 text-sm">
            <Avatar name={r.name} url={r.avatarUrl} />
            <Link href={r.activityId ? `/dashboard/activities/${r.activityId}` : teammateHref(r.id) ?? '/feed'} className="min-w-0 flex-1 truncate" dir="auto">{r.name}</Link>
            <b className="tabular-nums"><bdi dir="ltr">{roundKm(r.km)}</bdi></b>
            {r.activityId && <Clap activityId={r.activityId} athleteId={athleteId} />}
          </div>
        ))}
      </div>
      {more > 0 && <Link href="/feed" className="mt-1 block text-center text-13 font-extrabold text-brand-600">{t('clubMore', { n: more })}</Link>}
    </div>
  );
}

/** The coach's pinned word, when there is one (club updates, migration 154). */
export function CoachPinned() {
  const { data } = useApi<{ enabled?: boolean; updates?: Array<{ id: string; body: string; pinned: boolean; createdAt: string; author: { name: string; avatarUrl: string | null; role: string } }> }>('/api/club-updates?feed=1');
  const u = data?.enabled ? data.updates?.find((x) => x.pinned) : undefined;
  if (!u) return null;
  return (
    <Link href="/feed" className="block rounded-card border-[1.5px] border-brand-600/15 bg-card p-3.5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <Avatar name={u.author.name} url={u.author.avatarUrl} size={32} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-sm text-ink-900" dir="auto">{u.author.name}{u.author.role && <span className="font-semibold text-ink-400"> · {u.author.role}</span>}</b>
          <span className="text-xs text-ink-400"><bdi dir="ltr">{new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(u.createdAt))}</bdi></span>
        </span>
        <span aria-hidden>📌</span>
      </div>
      <p className="mt-2 line-clamp-3 text-[15px] leading-relaxed text-ink-900" dir="auto">{u.body}</p>
    </Link>
  );
}

/** Last night from the watch — only a night it actually reported. */
export function LastNight({ athleteId }: { athleteId: string }) {
  const t = useTranslations('dashboard');
  const { data } = useApi<Stats>(`/api/athletes/${athleteId}/stats`);
  const n = data?.lastNight;
  if (!n) return null;
  const hm = n.sleepSeconds ? `${Math.floor(n.sleepSeconds / 3600)}:${String(Math.round((n.sleepSeconds % 3600) / 60)).padStart(2, '0')}` : null;
  return (
    <div className="flex items-center gap-4 rounded-card bg-[#F4F1FF] px-3.5 py-2.5 text-13 text-ink-700">
      {hm && <span>🌙 <b className="text-[15px] text-ink-900"><bdi dir="ltr">{hm}</bdi></b> {t('nightSleep')}</span>}
      {n.restingHr && <span>❤️ <b className="text-[15px] text-ink-900"><bdi dir="ltr">{n.restingHr}</bdi></b> {t('nightRhr')}</span>}
      <span className="ms-auto text-xs text-ink-400">{t('nightFromWatch')}</span>
    </div>
  );
}
