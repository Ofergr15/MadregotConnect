'use client';

/**
 * The top of a trainee's page as their coach sees it (mockup
 * ~/.cache/madregot/attendance-nav/trainee.html, Ofer 2026-10-17: "when you open a
 * trainee, their details should be on top — name, pack, goal… and a km chart").
 *
 * Everything here is `/api/academy/me` — the same payload the trainee's own home
 * reads, so the coach and the trainee can never be shown two different goals or two
 * different paces. Only `athlete.phone` is coach-only (the route adds it for staff).
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MessageCircle, Phone, Watch } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { FeedAvatar } from '@/components/FeedAvatar';
import { formatPace } from '@/components/activity/format';
import { academyThreadUrl } from '@/lib/academy/deep-links';
import type { HomeKmWeek, TraineeHome } from '@/lib/academy/trainee-home';

/** Digits only, Israeli local numbers to 972 — wa.me wants an international number. */
function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('0') ? `972${d.slice(1)}` : d;
}

function Num({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr" className="whitespace-nowrap tabular-nums">{children}</bdi>;
}

function KmChart({ weeks, avgKm }: { weeks: HomeKmWeek[]; avgKm: number | null }) {
  const t = useTranslations('traineeHeader');
  if (weeks.length < 2) return null;
  const max = Math.max(...weeks.map((w) => Math.max(w.km, w.plannedKm ?? 0)), 1);
  const last = weeks.length - 1;
  return (
    <section className="rounded-card border border-page bg-card p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-extrabold text-ink-700">{t('kmTitle')}</h3>
        <span className="text-2xs text-ink-400">
          {t('kmSub', { n: weeks.length })}{avgKm != null && <> · {t('kmAvg', { km: Math.round(avgKm) })}</>}
        </span>
      </div>
      <div dir="ltr" className="mt-2 flex h-24 items-end gap-1" aria-hidden>
        {weeks.map((w, i) => {
          const planned = w.plannedKm ?? 0;
          // A finished week under 70% of what was planned is the one a coach must see.
          const low = i < last && planned > 0 && w.km < planned * 0.7;
          return (
            <div key={w.weekStart} className="relative h-full flex-1">
              {planned > 0 && (
                <div className="absolute inset-x-0 bottom-0 rounded-t border-[1.5px] border-b-0 border-dashed border-primary-300" style={{ height: `${(planned / max) * 100}%` }} />
              )}
              <div
                className={cn('absolute inset-x-[2px] bottom-0 rounded-t-[3px]', i === last ? 'bg-primary-400' : low ? 'bg-accent-red' : 'bg-brand-600')}
                style={{ height: `${(w.km / max) * 100}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-2xs text-ink-500">
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-brand-600" />{t('kmDone')}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm border border-dashed border-primary-300" />{t('kmPlanned')}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-accent-red" />{t('kmLow')}</span>
      </div>
    </section>
  );
}

export function TraineeHeader({ athleteId }: { athleteId: string }) {
  const t = useTranslations('traineeHeader');
  const { data } = useApi<TraineeHome>(`/api/academy/me?athleteId=${encodeURIComponent(athleteId)}`);
  if (!data?.isMember || !data.athlete) return null;
  const { athlete, goal, paces, km, journey, coaches } = data;
  const coachNames = (coaches?.length ? coaches : data.coach ? [data.coach] : []).map((c) => c.name.split(' ')[0]).join(', ');
  const phone = athlete.phone || null;
  const btn = 'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-page/60 text-[13px] font-bold text-ink-700';

  return (
    <div className="space-y-2">
      <section className="rounded-card border border-page bg-card p-4">
        <div className="flex items-center gap-3.5">
          <span className="relative shrink-0 rounded-full" style={{ boxShadow: '0 0 0 3px #fff, 0 0 0 6px #159AFF' }}>
            <FeedAvatar name={athlete.name} url={athlete.avatarUrl} className="h-16 w-16" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold leading-tight text-ink-900">{athlete.name}</h1>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-2xs font-bold">
              {paces?.bandNumber != null && <span className="rounded-full bg-band-2-ink px-2.5 py-0.5 text-white">{t('band', { n: paces.bandNumber })}</span>}
              {coachNames && <span className="rounded-full bg-page/60 px-2.5 py-0.5 text-ink-700">{t('coach', { names: coachNames })}</span>}
              {journey?.monthsWithUs != null && <span className="rounded-full bg-page/60 px-2.5 py-0.5 text-ink-700">{t('months', { n: journey.monthsWithUs })}</span>}
            </div>
            <p className={cn('mt-1.5 flex items-center gap-1 text-xs', athlete.hasWatch ? 'text-ink-500' : 'text-accent-red-ink font-semibold')}>
              <Watch className="h-3.5 w-3.5" />{athlete.hasWatch ? t('watchOn') : t('watchOff')}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Link href={academyThreadUrl({ recipientIsStaff: true, traineeId: athlete.athleteId })} className={btn}>
            <MessageCircle className="h-4 w-4" />{t('message')}
          </Link>
          {phone && (
            <a href={`https://wa.me/${waNumber(phone)}`} target="_blank" rel="noreferrer" className={btn}>{t('whatsapp')}</a>
          )}
          {phone && (
            <a href={`tel:${phone}`} className={btn}><Phone className="h-4 w-4" />{t('call')}</a>
          )}
        </div>
      </section>

      {goal && (
        <section className="rounded-card bg-brand-600 p-3.5 text-white">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-2xs font-bold opacity-85">{t('goal')}</p>
              <p className="truncate text-base font-extrabold">{goal.title}{goal.goalTime && <> · <Num>{goal.goalTime}</Num></>}</p>
              {goal.week != null && goal.totalWeeks != null && (
                <p className="text-2xs opacity-85">{t('goalWeek', { week: goal.week, total: goal.totalWeeks })}</p>
              )}
            </div>
            {goal.daysLeft != null && (
              <div className="rounded-xl bg-white/20 px-3 py-1 text-center">
                <b className="block text-2xl font-black leading-none tabular-nums">{goal.daysLeft}</b>
                <span className="text-3xs">{t('days')}</span>
              </div>
            )}
          </div>
          {goal.week != null && goal.totalWeeks ? (
            <div dir="ltr" className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, (goal.week / goal.totalWeeks) * 100)}%` }} />
            </div>
          ) : null}
        </section>
      )}

      {paces && (
        <div className="grid grid-cols-4 gap-1.5">
          {([['easy', paces.easy], ['tempo', paces.tempo], ['threshold', paces.threshold], ['interval', paces.interval]] as const).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-page bg-card px-1 py-2 text-center">
              <p className="text-2xs text-ink-400">{t(`pace_${k}`)}</p>
              <p className="text-base font-extrabold text-ink-700"><Num>{formatPace(v)}</Num></p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        <div className="rounded-xl border border-page bg-card p-2.5">
          <b className="block text-lg font-black text-ink-700 tabular-nums">{paces ? <Num>{formatPace(paces.threshold)}</Num> : '–'}</b>
          <span className="text-2xs leading-snug text-ink-400">
            {paces?.source === 'test' ? t('thresholdFromTest') : t('thresholdFromBand')}
            {data.test?.kind === 'ok' && <><br /><Num>{data.test.date.slice(8, 10)}.{data.test.date.slice(5, 7)}</Num></>}
          </span>
        </div>
        <div className="rounded-xl border border-page bg-card p-2.5">
          <b className="block text-lg font-black text-ink-700 tabular-nums">{km?.avgKm != null ? Math.round(km.avgKm) : '–'}</b>
          <span className="text-2xs leading-snug text-ink-400">{t('kmWeek')}</span>
        </div>
        <div className="rounded-xl border border-page bg-card p-2.5">
          <b className="block text-lg font-black text-ink-700 tabular-nums">{journey?.planPct != null ? `${journey.planPct}%` : '–'}</b>
          <span className="text-2xs leading-snug text-ink-400">{t('planDone')}</span>
        </div>
      </div>

      {km && <KmChart weeks={km.weeks} avgKm={km.avgKm} />}
    </div>
  );
}
