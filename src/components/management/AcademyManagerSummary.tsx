'use client';

/**
 * The academy manager's part of the Management page (mockup
 * ~/.cache/madregot/attendance-nav/roles.html, "מנהל אקדמיה"): the academy at a
 * glance — four numbers, trainees per week, what is waiting for the manager, and
 * the doors into the academy's areas.
 *
 * Reads what the academy already serves: /api/academy/summary (head counts),
 * /api/academy/home (growth, approvals, funnel) and /api/academy/coach-today (this
 * week across every trainee — the same board an academy coach sees, unscoped).
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AcademyHomeResponse } from '@/lib/academy/home';
import type { BoardTrainee } from '@/lib/academy/coach-today';

interface Summary { trainees: number; coaches: number; unpaired: number; inFunnel: number; registrationOpen: boolean }

function Row({ href, label, sub, tag }: { href: string; label: string; sub?: string; tag?: string }) {
  return (
    <Link href={href} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] text-ink-900">{label}{tag && <span className="ms-1.5 rounded-full bg-band-3/15 px-2 py-0.5 text-3xs font-bold text-band-3-ink">{tag}</span>}</p>
        {sub && <p className="truncate text-xs text-ink-400">{sub}</p>}
      </div>
      <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
    </Link>
  );
}

export function AcademyManagerSummary() {
  const t = useTranslations('managementAcademy');
  const { data: summary } = useApi<Summary>('/api/academy/summary');
  const { data: home } = useApi<AcademyHomeResponse>('/api/academy/home');
  const { data: board } = useApi<{ trainees: BoardTrainee[] }>('/api/academy/coach-today');

  const trainees = board?.trainees ?? [];
  const ran = trainees.filter((tr) => tr.weekKm.done > 0).length;
  const planned = trainees.reduce((s, tr) => s + tr.weekKm.planned, 0);
  const done = trainees.reduce((s, tr) => s + tr.weekKm.done, 0);
  const pct = planned > 0 ? Math.round((done / planned) * 100) : null;
  const atRisk = trainees.filter((tr) => tr.reasons.length > 0).length;
  const weeks = home?.weeks ?? [];
  const maxW = Math.max(1, ...weeks.map((w) => w.trainees));
  const waiting = [
    ...(home?.funnel?.forms ?? []).map((f) => ({ key: `f-${f.id}`, label: f.name, sub: t('waitForm'), tag: t('tagHandle'), href: '/dashboard/academy?tab=funnel' })),
    ...(home?.approvals ?? []).map((a) => ({ key: `a-${a.athleteId}`, label: a.name, sub: t('waitApproval'), tag: t('tagApprove'), href: '/dashboard/academy?tab=tests' })),
    ...(home?.funnel?.stuck ?? []).map((s) => ({ key: `s-${s.id}`, label: s.name, sub: t('waitStuck', { days: s.days }), tag: t('tagStuck'), href: '/dashboard/academy?tab=funnel' })),
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 overflow-hidden rounded-card border border-page bg-card text-center">
        <div className="bg-brand-600 py-2.5 text-white">
          <b className="block text-2xl font-black tabular-nums">{summary?.trainees ?? '–'}</b>
          <span className="text-3xs">{t('kTrainees')}</span>
          {home && home.month.joined > 0 && <span className="block text-3xs font-bold">+{home.month.joined} {t('kThisMonth')}</span>}
        </div>
        <div className="border-s border-page py-2.5">
          <b className="block text-2xl font-black tabular-nums text-ink-900">{board ? <>{ran}<small className="text-xs text-ink-400">/{trainees.length}</small></> : '–'}</b>
          <span className="text-3xs text-ink-400">{t('kRan')}</span>
        </div>
        <div className="border-s border-page py-2.5">
          <b className="block text-2xl font-black tabular-nums text-ink-900">{pct != null ? `${pct}%` : '–'}</b>
          <span className="text-3xs text-ink-400">{t('kKm')}</span>
        </div>
        <div className="border-s border-page py-2.5">
          <b className={cn('block text-2xl font-black tabular-nums', atRisk ? 'text-accent-red' : 'text-ink-900')}>{board ? atRisk : '–'}</b>
          <span className="text-3xs text-ink-400">{t('kRisk')}</span>
        </div>
      </div>

      {weeks.length > 1 && (
        <section className="rounded-card border border-page bg-card p-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-extrabold text-ink-700">{t('growthTitle')}</h3>
            <span className="text-2xs text-ink-400">{t('growthSub', { n: weeks.length })}</span>
          </div>
          <div dir="ltr" className="mt-2 flex h-16 items-end gap-1" aria-hidden>
            {weeks.map((w) => <i key={w.weekStart} className="block flex-1 rounded-t-[3px] bg-brand-600" style={{ height: `${(w.trainees / maxW) * 100}%` }} />)}
          </div>
        </section>
      )}

      {waiting.length > 0 && (
        <section>
          <h2 className="mb-1.5 px-1 text-sm font-extrabold text-ink-700">{t('waiting')} <span className="rounded-full bg-accent-red px-1.5 text-2xs font-bold text-white">{waiting.length}</span></h2>
          <div className="divide-y divide-page overflow-hidden rounded-card border border-page bg-card">
            {waiting.slice(0, 5).map((w) => <Row key={w.key} href={w.href} label={w.label} sub={w.sub} tag={w.tag} />)}
          </div>
        </section>
      )}

      {summary && (summary.unpaired > 0 || summary.coaches > 0) && (
        <p className="px-1 text-xs text-ink-500">
          {t('coachesLine', { coaches: summary.coaches })}
          {summary.unpaired > 0 && <span className="font-bold text-band-3-ink"> · {t('unpaired', { n: summary.unpaired })}</span>}
        </p>
      )}

      <section>
        <h2 className="mb-1.5 px-1 text-sm font-extrabold text-ink-700">{t('areas')}</h2>
        <div className="divide-y divide-page overflow-hidden rounded-card border border-page bg-card">
          <Row href="/dashboard/academy?tab=members" label={t('areaPeople')} sub={t('areaPeopleSub')} />
          <Row href="/dashboard/academy?tab=plans" label={t('areaPlans')} sub={t('areaPlansSub')} />
          <Row href="/dashboard/academy?tab=compliance" label={t('areaTrack')} sub={t('areaTrackSub')} />
          <Row href="/dashboard/academy?tab=threads" label={t('areaThreads')} />
          {summary && <Row href="/dashboard/academy?tab=funnel" label={t('registration')} sub={summary.registrationOpen ? t('regOpen', { n: summary.inFunnel }) : t('regClosed')} />}
        </div>
      </section>
    </div>
  );
}
