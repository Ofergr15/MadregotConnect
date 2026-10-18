'use client';

import Link from 'next/link';
import { Check, ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { roundKm } from '@/lib/plans/week-summary';
import type { PlanWeekStats } from '@/lib/athletes/plan-week';

/**
 * The runner's home, "היום" (Ofer, 2026-10-19, mockups/morning-1019): under the next
 * workout, three short answers — what I ran today against today's target, where my week
 * stands, and what the club did today. Each opens the screen that holds the whole story.
 *
 * Today's target and the week come from the same reads as "השבוע שלי" on the profile
 * (the stats payload's planWeek and the plan week in the runner's lane), so the two
 * screens cannot disagree about a kilometre.
 */

interface PlanWeek {
  hasPlan?: boolean;
  hasClubPlan?: boolean;
  weekTotalMax?: number;
  dailyDistances?: Array<{ dayOfWeek: number; requiredMin?: number; min: number }>;
}

function usePlanToday(athleteId: string) {
  const { data: stats } = useApi<{ planWeek?: PlanWeekStats }>(`/api/athletes/${athleteId}/stats`);
  const pw = stats?.planWeek;
  const { data: plan } = useApi<PlanWeek>(pw ? `/api/plans/week?weekStart=${pw.weekStart}&lane=mine` : null);
  if (!pw) return null;
  const plannedMin = (d: number) => {
    const dd = plan?.dailyDistances?.find((x) => x.dayOfWeek === d);
    return dd ? dd.requiredMin ?? dd.min : 0;
  };
  const shouldBy = Array.from({ length: pw.today + 1 }, (_, d) => plannedMin(d)).reduce((s, x) => s + x, 0);
  const clubPlan = plan?.hasPlan && plan.hasClubPlan !== false;
  const scale = (clubPlan && plan?.weekTotalMax) || Math.max(pw.avgKm, pw.km * 1.25, shouldBy * 1.25, 10);
  return { pw, todayTarget: plannedMin(pw.today), shouldBy, scale };
}

const pace = (seconds: number, km: number) => {
  if (km <= 0) return '';
  const s = Math.round(seconds / km);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function HomeToday({ athleteId }: { athleteId: string }) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const data = usePlanToday(athleteId);
  if (!data) return null;
  const { pw, todayTarget, shouldBy, scale } = data;
  const todayKm = pw.days[pw.today];
  const todayRuns = pw.dayRuns[pw.today];
  const todaySeconds = todayRuns.reduce((s, r) => s + r.seconds, 0);
  const delta = pw.km - shouldBy;

  return (
    <div className="space-y-2.5">
      {todayKm > 0 && (
        <Link href={todayRuns.length === 1 && todayRuns[0].id ? `/dashboard/activities/${todayRuns[0].id}` : '/dashboard/activities'} className="flex items-center gap-3 rounded-card bg-card p-3.5 shadow-sm">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent-600"><Check className="h-4 w-4 text-white" strokeWidth={3} /></span>
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] text-ink-900">{t('todayRan')} <bdi dir="ltr">{roundKm(todayKm)}</bdi> {tc('km')}</b>
            <span className="text-xs text-ink-500">
              <bdi dir="ltr">{pace(todaySeconds, todayKm)}</bdi> {t('perKm')}
              {todayTarget > 0 && <> · {t('todayTarget')} <bdi dir="ltr">{roundKm(todayTarget)}</bdi></>}
            </span>
          </span>
          <ChevronLeft className="h-5 w-5 text-ink-300 ltr:rotate-180" />
        </Link>
      )}

      <Link href="/dashboard/profile?tab=stats" className="flex items-center gap-3 rounded-card bg-card p-3.5 shadow-sm">
        <MiniRing km={pw.km} scale={scale} should={shouldBy} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-extrabold text-ink-500">{t('myWeek')}</span>
          <b className="block text-[22px] font-black leading-tight text-ink-900"><bdi dir="ltr">{roundKm(pw.km)}</bdi> <small className="text-xs font-bold text-ink-500">{tc('km')} · {t('weekDay', { n: pw.today + 1 })}</small></b>
          {shouldBy > 0 && (
            <span className="text-xs text-ink-500">
              <bdi dir="ltr" className={delta >= 0 ? 'font-extrabold text-accent-900' : 'font-extrabold text-band-3-ink'}>{delta >= 0 ? '+' : '−'}{roundKm(Math.abs(delta))}</bdi> {t('vsTodayTarget')}
            </span>
          )}
        </span>
        <ChevronLeft className="h-5 w-5 text-ink-300 ltr:rotate-180" />
      </Link>
    </div>
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

/** "במועדון היום": how many ran, the kilometres together, the furthest few. */
export function ClubToday() {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const { data } = useApi<{ runners: number; km: number; top: Array<{ id: string; name: string; avatarUrl: string | null; km: number }> }>('/api/club/today');
  if (!data || data.runners === 0) return null;
  const more = data.runners - data.top.length;
  const lead = data.top[0];
  return (
    <Link href="/feed" className="block rounded-card bg-card p-3.5 shadow-sm">
      <span className="block text-xs font-extrabold text-ink-500">{t('clubToday')}</span>
      <b className="block text-[22px] font-black leading-tight text-ink-900">
        <bdi dir="ltr">{data.runners}</bdi> <small className="text-xs font-bold text-ink-500">{t('clubRanToday', { km: data.km })}</small>
      </b>
      <div className="mt-2 flex items-center">
        {data.top.map((a, i) => (
          <span key={a.id} className="-ms-1.5 first:ms-0 grid h-7 w-7 place-items-center overflow-hidden rounded-full border-2 border-card bg-brand-600/10 text-[10px] font-extrabold text-brand-600" style={{ zIndex: 10 - i }}>
            {a.avatarUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={a.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              : a.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
          </span>
        ))}
        {more > 0 && <span className="ms-1.5 text-xs font-extrabold text-ink-500">+<bdi dir="ltr">{more}</bdi></span>}
      </div>
      {lead && <p className="mt-1.5 text-xs text-ink-500">{t('clubFurthest', { name: lead.name })} <bdi dir="ltr">{roundKm(lead.km)}</bdi> {tc('km')}</p>}
    </Link>
  );
}
