'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Award, Bell, CalendarDays, ChevronLeft, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { EmptyState, InsetRow, InsetSection, Skeleton } from '@/components/ui';
import { CHALLENGE_PHASES, daysUntil, type ChallengePhase } from '@/lib/admin/content';
import { israelDateOf } from '@/lib/reports/last-7-days';

// ═════════════════════════════════════════════════════════════════════════════
// תוכן — everything the admin shows the club, on one screen (#71, phase 2).
//
// Challenges, badges, events, notifications and what's new were five rows deep
// in Settings, each opening its own manager with no hint of what was live. This
// says where each one stands and links to the manager that already exists; it
// edits nothing itself.
// ═════════════════════════════════════════════════════════════════════════════

interface ContentResponse {
  today: string;
  challenges: Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    phase: ChallengePhase;
    earned: number;
  }>;
  badges: { active: number; awardedThisWeek: number };
  events: Array<{ id: string; name: string; date: string }>;
  lastNotification: { title: string | null; sentAt: string; reached: number } | null;
  latestNote: { title: string; date: string } | null;
}

const PHASE_PILL: Record<ChallengePhase, string> = {
  active: 'bg-accent-600/15 text-accent-900',
  scheduled: 'bg-brand-600/15 text-brand-600',
  ended: 'bg-page text-ink-500',
};

function shortDate(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}.${m}`;
}

export default function ContentPage() {
  const t = useTranslations('contentHub');
  const { data, isLoading } = useApi<ContentResponse>('/api/admin/content');
  const [phase, setPhase] = useState<ChallengePhase>('active');

  const today = data?.today ?? '';
  const counts = useMemo(() => {
    const out = { active: 0, scheduled: 0, ended: 0 } as Record<ChallengePhase, number>;
    for (const c of data?.challenges ?? []) out[c.phase]++;
    return out;
  }, [data]);
  const shown = (data?.challenges ?? []).filter(c => c.phase === phase);

  const when = (c: ContentResponse['challenges'][number]) => {
    if (c.phase === 'scheduled') return t('startsOn', { date: shortDate(c.startDate) });
    if (c.phase === 'ended') return t('endedOn', { date: shortDate(c.endDate) });
    const n = daysUntil(c.endDate, today);
    return n <= 0 ? t('endsToday') : t('endsIn', { n });
  };

  return (
    <div className="space-y-3 pb-6">
      <h1 className="text-[28px] font-black text-ink-700">{t('title')}</h1>

      <div className="flex items-center justify-between px-1">
        <p className="text-2xs font-bold uppercase tracking-wider text-ink-400">{t('challenges')}</p>
        <Link href="/dashboard/settings?tab=challenges" className="inline-flex min-h-[44px] items-center text-xs font-bold text-brand-600">
          {t('manageChallenges')}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {CHALLENGE_PHASES.map(p => {
          const on = phase === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => setPhase(p)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 min-h-[44px] text-xs font-semibold transition-colors',
                on ? 'bg-ink-700 border-ink-700 text-white' : 'bg-card border-page text-ink-500',
              )}
            >
              {t(`phase_${p}` as never)}
              {data && <span className={cn('tabular-nums', on ? 'text-white/70' : 'text-ink-400')}>{counts[p]}</span>}
            </button>
          );
        })}
      </div>

      {isLoading && !data ? (
        <Skeleton className="h-20 rounded-card" />
      ) : shown.length === 0 ? (
        <EmptyState title={t('noChallenges')} />
      ) : (
        <div className="space-y-2">
          {shown.map(c => (
            <Link
              key={c.id}
              href="/dashboard/settings?tab=challenges"
              className="flex items-center gap-3 rounded-card bg-card p-3.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink-700">{c.name}</span>
                <span className="block text-xs text-ink-400">
                  {when(c)}
                  {c.phase !== 'scheduled' && <> · {t('earned', { n: c.earned })}</>}
                </span>
              </span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold', PHASE_PILL[c.phase])}>
                {t(`phase_${c.phase}` as never)}
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-ink-400" />
            </Link>
          ))}
        </div>
      )}

      <InsetSection header={t('more')} className="pt-2">
        <InsetRow
          icon={CalendarDays}
          iconBg="bg-accent-900"
          label={t('events')}
          sublabel={data?.events[0]
            ? t('eventsNext', { name: data.events[0].name, date: shortDate(data.events[0].date) })
            : data ? t('eventsNone') : undefined}
          href="/dashboard/calendar"
        />
        <InsetRow
          icon={Award}
          iconBg="bg-fuchsia-500"
          label={t('badges')}
          sublabel={data ? t('badgesSub', { n: data.badges.active, w: data.badges.awardedThisWeek }) : undefined}
          href="/dashboard/settings?tab=badges"
        />
        <InsetRow
          icon={Bell}
          iconBg="bg-accent-red"
          label={t('notifications')}
          sublabel={data?.lastNotification
            ? t('notificationsSub', { date: shortDate(israelDateOf(data.lastNotification.sentAt)), n: data.lastNotification.reached })
            : data ? t('notificationsNone') : undefined}
          href="/dashboard/settings?tab=notifications"
        />
        <InsetRow
          icon={Sparkles}
          iconBg="bg-brand-600"
          label={t('whatsNew')}
          sublabel={data?.latestNote ? t('whatsNewSub', { title: data.latestNote.title }) : undefined}
          href="/dashboard/whats-new"
        />
      </InsetSection>
    </div>
  );
}
