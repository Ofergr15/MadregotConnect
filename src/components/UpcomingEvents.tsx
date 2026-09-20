'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  BookOpen, Cake, Camera, CalendarDays, ChevronRight, Dumbbell, Gift,
  PartyPopper, Tent, Trophy,
} from 'lucide-react';
import { useApi } from '@/lib/api';
import { AthleteLink } from '@/components/AthleteLink';
import { SkeletonCard } from '@/components/ui';
import { isEmptyUpcoming, type UpcomingBuckets } from '@/lib/events/upcoming';

/**
 * "What's next" for the club, in three separated lanes.
 *
 * Requested as a section with the lanes kept APART — races, club events, and
 * birthdays — because the calendar already merges everything into one month grid
 * and that grid answers "what is on the 14th", not "what's coming". Each lane
 * shows at most three rows and hides itself when empty, so the card is short on a
 * quiet week instead of padding itself with empty headings.
 *
 * All three lanes come from one member-gated request (/api/club/upcoming); the
 * birth years never reach the client. See lib/events/upcoming.ts for the date
 * rules and the route for what it does and doesn't expose.
 */

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  race: Trophy,
  camp: Tent,
  lecture: BookOpen,
  social: PartyPopper,
  photo_shoot: Camera,
  sponsor: Gift,
  workout: Dumbbell,
};

export function UpcomingEvents() {
  const t = useTranslations('upcoming');
  const tk = useTranslations('calendar');
  const locale = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
  const { data } = useApi<UpcomingBuckets>('/api/club/upcoming');

  if (!data) return <SkeletonCard />; // true first load → shaped skeleton
  if (isEmptyUpcoming(data)) return null; // nothing on the horizon → no empty card

  // "Today" / "tomorrow" / "in N days" — a bare date makes the reader do the
  // arithmetic, which is the one thing this card exists to do for them.
  const when = (daysAway: number) =>
    daysAway === 0 ? t('today') : daysAway === 1 ? t('tomorrow') : t('inDays', { n: daysAway });

  const shortDate = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' });

  return (
    <div className="rounded-2xl bg-card border border-page p-4 sm:p-5" dir="rtl">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wider">{t('title')}</h2>
        <Link
          href="/dashboard/calendar"
          className="ms-auto flex items-center gap-0.5 text-2xs font-semibold text-brand-600"
        >
          {t('seeAll')}
          <ChevronRight className="h-3 w-3 rtl:rotate-180" />
        </Link>
      </div>

      <div className="space-y-3">
        {(['races', 'club'] as const).map(lane => {
          const rows = data[lane];
          if (rows.length === 0) return null;
          return (
            <Lane key={lane} icon={lane === 'races' ? Trophy : PartyPopper} label={t(lane)}>
              {rows.map(e => {
                const Icon = KIND_ICON[e.kind] || CalendarDays;
                return (
                  <li key={e.id}>
                    <Link
                      href={`/dashboard/calendar/${e.id}`}
                      className="flex items-center gap-2 rounded-xl px-2.5 py-2 bg-page/50 active:scale-[0.99] transition-transform"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink-700 truncate" dir="auto">
                          {e.name}
                        </span>
                        {/* The kind label carries what the icon can only hint at,
                            and the location is what decides whether a member can
                            actually get there. */}
                        <span className="block text-2xs text-ink-400 truncate" dir="auto">
                          {[tk(`kinds.${e.kind}`), e.location].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block text-2xs font-semibold text-ink-700">{when(e.daysAway)}</span>
                        <span className="block text-2xs text-ink-400 tabular-nums">{shortDate(e.date)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </Lane>
          );
        })}

        {data.birthdays.length > 0 && (
          <Lane icon={Cake} label={t('birthdays')}>
            {data.birthdays.map(b => (
              <li key={b.athleteId}>
                <AthleteLink
                  athleteId={b.athleteId}
                  name={b.name}
                  className="flex items-center gap-2 rounded-xl px-2.5 py-2 bg-page/50"
                >
                  <Cake className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                  <span className="min-w-0 flex-1 text-sm font-semibold text-ink-700 truncate" dir="auto">
                    {b.name}
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-2xs font-semibold text-ink-700">{when(b.daysAway)}</span>
                    <span className="block text-2xs text-ink-400 tabular-nums">{shortDate(b.date)}</span>
                  </span>
                </AthleteLink>
              </li>
            ))}
          </Lane>
        )}
      </div>
    </div>
  );
}

/** One labelled lane. The header is what makes the separation readable at a glance. */
function Lane({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="h-3 w-3 text-ink-400" />
        <h3 className="text-2xs font-bold text-ink-400 uppercase tracking-wider">{label}</h3>
        <span className="h-px flex-1 bg-ink-300/40" />
      </div>
      <ul className="space-y-1.5">{children}</ul>
    </section>
  );
}
