'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Award, BarChart3, Bell, Cake, CalendarDays, ChevronLeft, Medal, Megaphone, Radio, Sparkles, PartyPopper } from 'lucide-react';
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
  recent?: Array<{ id: string; kind: 'message' | 'cheer' | 'survey'; text: string; at: string; likes: number; comments: number; answers: number | null }>;
}

const RECENT_ICON = { message: '📣', cheer: '🏅', survey: '📊' } as const;

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
  const tp = useTranslations('publish');
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

      {/* לפרסם (mockup publish, C0): the three things staff put on the feed. */}
      <InsetSection header={tp('publishHeader')}>
        <InsetRow icon={Megaphone} iconBg="bg-brand-600" label={tp('typeMessage')} sublabel={tp('typeMessageSub')} href="/dashboard/content/publish?type=message" />
        <InsetRow icon={Medal} iconBg="bg-[#E8436E]" label={tp('typeCheer')} sublabel={tp('typeCheerSub')} href="/dashboard/content/publish?type=cheer" />
        <InsetRow icon={BarChart3} iconBg="bg-accent-900" label={tp('typeSurvey')} sublabel={tp('typeSurveySub')} href="/dashboard/content/publish?type=survey" />
        <InsetRow icon={PartyPopper} iconBg="bg-[#C7921A]" label="חגיגות" sublabel="מה בעיגולים בראש הפיד, ועד מתי" href="/dashboard/content/celebrations" />
      </InsetSection>
      {(data?.recent?.length ?? 0) > 0 && (
        <InsetSection header={tp('recentHeader')}>
          {data!.recent!.slice(0, 5).map((r) => (
            <Link key={r.id} href={`/feed?item=${r.id}`} className="flex min-h-[56px] items-center gap-3 border-b border-page px-4 py-2 last:border-0">
              <span aria-hidden className="w-7 shrink-0 text-center text-lg">{RECENT_ICON[r.kind]}</span>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-[15px] font-semibold text-ink-700">{r.text}</span>
                <span className="block text-xs text-ink-400">
                  {shortDate(israelDateOf(r.at))}
                  {r.answers !== null ? <> · {tp('answers', { n: r.answers })}</> : <> · ❤️ <bdi dir="ltr">{r.likes}</bdi> · 💬 <bdi dir="ltr">{r.comments}</bdi></>}
                </span>
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-ink-400" />
            </Link>
          ))}
        </InsetSection>
      )}

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
          icon={Radio}
          iconBg="bg-[#FF5315]"
          label={t('clubUpdates')}
          sublabel={t('clubUpdatesSub')}
          href="/dashboard/club-updates"
        />
        <InsetRow
          icon={Cake}
          iconBg="bg-[#FF5315]"
          label={t('birthdays')}
          sublabel={t('birthdaysSub')}
          href="/dashboard/birthdays"
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
