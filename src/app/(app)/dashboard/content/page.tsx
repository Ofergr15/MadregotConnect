'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Award, BarChart3, Bell, Cake, CalendarDays, ChevronLeft, Medal, Megaphone, Radio, Sparkles } from 'lucide-react';
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
  recent?: Array<{ id: string; kind: 'message' | 'cheer' | 'survey'; text: string; at: string; likes: number; comments: number; answers: number | null; emoji?: string }>;
}

/** What runners see right now on the circles (api/admin/celebrations). */
interface LiveRow { id: string; source: 'feed' | 'club' | 'survey' | 'scheduled'; emoji: string; label: string; title: string; until: string; active: boolean; likes: number; auto: boolean; answers?: number; at?: string }
/** The chip on a row: until when for the circles, when it closes or goes out for the rest. */
function liveChip(r: LiveRow, today: string): { text: string; tone: string } {
  if (r.source === 'scheduled' && r.at) {
    const d = new Date(r.at);
    const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
    return { text: `${r.until === today ? 'היום' : untilChip(r.until, today).replace('עד ', '')} ${time}`, tone: 'bg-brand-600/10 text-brand-600' };
  }
  if (r.source === 'survey') return { text: r.until ? `נסגר ${untilChip(r.until, today).replace('עד ', '')}` : 'פתוח', tone: 'bg-[#FFF1D6] text-[#8A5A00]' };
  return { text: untilChip(r.until, today), tone: 'bg-[#E3F6EA] text-[#12A150]' };
}
const liveHref = (r: LiveRow) => (r.source === 'survey' ? '/dashboard/settings?tab=notifications' : r.source === 'scheduled' ? '/dashboard/settings?tab=notifications' : '/dashboard/content/celebrations');
const WEEKDAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
function untilChip(until: string, today: string): string {
  if (until === today) return 'עד היום';
  const d = new Date(`${until}T12:00:00`);
  const tomorrow = new Date(`${today}T12:00:00`); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return 'עד מחר';
  return `עד ${WEEKDAY[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}`;
}

/** The four things staff put out (mockup content-hub): the circle has its own tile now. */
function PublishTile({ href, icon, bg, title, sub }: { href: string; icon: React.ReactNode; bg: string; title: string; sub: string }) {
  return (
    <Link href={href} className="min-h-[96px] rounded-[20px] bg-card px-3 py-3 active:opacity-80">
      <span className={cn('mb-2 grid h-9 w-9 place-items-center rounded-[11px] text-lg', bg)}>{icon}</span>
      <b className="block text-[15px] text-ink-900">{title}</b>
      <small className="block text-[11.5px] leading-snug text-ink-400">{sub}</small>
    </Link>
  );
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
  const { data: live } = useApi<{ today: string; items: LiveRow[] }>('/api/admin/celebrations');
  const onAir = (live?.items ?? []).filter((r) => r.active);
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

      {/* עכשיו באוויר (mockup content-hub, 1): what runners see right now, and until when. */}
      <div className="flex items-center justify-between px-1">
        <p className="text-13 font-bold text-ink-400">עכשיו באוויר{onAir.length ? ` · ${onAir.length}` : ''}</p>
        <Link href="/dashboard/content/celebrations" className="inline-flex min-h-[40px] items-center text-13 font-bold text-brand-600">לנהל ‹</Link>
      </div>
      <div className="overflow-hidden rounded-[22px] bg-card">
        {!live && <p className="px-4 py-3 text-sm text-ink-400">…</p>}
        {live && onAir.length === 0 && <p className="px-4 py-3 text-sm text-ink-400">כרגע אין כלום בעיגולים בראש הפיד</p>}
        {onAir.slice(0, 6).map((r) => (
          <Link key={`${r.source}:${r.id}`} href={liveHref(r)} className="flex min-h-[58px] items-center gap-3 border-b border-page px-3.5 py-2 last:border-0">
            {r.source === 'club'
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src="/images/logo.png" alt="" className="h-10 w-10 shrink-0 rounded-full bg-white object-contain p-0.5 ring-[2.5px] ring-brand-600" />
              : <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-page text-lg">{r.emoji}</span>}
            <span className="min-w-0 flex-1">
              <b dir="auto" className="block truncate text-[14px] text-ink-900">{r.title}</b>
              <small className="block text-12 text-ink-400">{r.label}{r.auto ? ' · אוטומטי' : ''}{r.likes ? ` · ${r.likes} ❤` : ''}{r.answers != null ? ` · ${r.answers} הצביעו` : ''}</small>
            </span>
            {(() => { const c = liveChip(r, live!.today); return <span className={cn('shrink-0 rounded-full px-2 py-1 text-[11.5px] font-extrabold', c.tone)}>{c.text}</span>; })()}
          </Link>
        ))}
      </div>

      <p className="px-1 pt-1 text-13 font-bold text-ink-400">{tp('publishHeader')}</p>
      <div className="grid grid-cols-2 gap-2.5">
        <PublishTile href="/dashboard/content/publish?type=message" bg="bg-brand-600 text-white" icon={<Megaphone className="h-5 w-5" />} title={tp('typeMessage')} sub="לפיד, עם או בלי התראה" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <PublishTile href="/dashboard/content/publish?type=message&place=circle" bg="bg-white ring-[2.5px] ring-brand-600" icon={<img src="/images/logo.png" alt="" className="h-7 w-7 rounded-full object-contain" />} title="עיגול מדרגות" sub="בראש הפיד, בשקט" />
        <PublishTile href="/dashboard/content/publish?type=cheer" bg="bg-[#E8436E] text-white" icon={<Medal className="h-5 w-5" />} title={tp('typeCheer')} sub={tp('typeCheerSub')} />
        <PublishTile href="/dashboard/content/publish?type=survey" bg="bg-accent-900 text-white" icon={<BarChart3 className="h-5 w-5" />} title={tp('typeSurvey')} sub={tp('typeSurveySub')} />
      </div>
      {(data?.recent?.length ?? 0) > 0 && (
        <InsetSection header={tp('recentHeader')}>
          {data!.recent!.slice(0, 5).map((r) => (
            <Link key={r.id} href={`/feed?item=${r.id}`} className="flex min-h-[56px] items-center gap-3 border-b border-page px-4 py-2 last:border-0">
              <span aria-hidden className="w-7 shrink-0 text-center text-lg">{r.emoji ?? RECENT_ICON[r.kind]}</span>
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

      {data && counts.active + counts.scheduled === 0 ? (
        // Nothing running or coming: one quiet row, not half a screen of "אין כאן כלום".
        <Link href="/dashboard/settings?tab=challenges" className="flex min-h-[52px] items-center gap-3 rounded-[18px] bg-card px-4">
          <span aria-hidden className="text-lg">🏆</span>
          <b className="flex-1 text-[14.5px] text-ink-900">{t('challenges')} · אין פעילים</b>
          <span className="text-13 font-bold text-brand-600">ליצור ‹</span>
        </Link>
      ) : (<>
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

      </>)}

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
