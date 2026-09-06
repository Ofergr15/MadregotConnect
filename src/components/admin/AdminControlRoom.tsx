'use client';

import { ChevronLeft, UserPlus, Bug, Sprout, CalendarClock, CheckCircle2, Wrench, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, BigStat, SkeletonList } from '@/components/ui';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { AttendanceRoster } from '@/components/AttendanceRoster';
import { CoachPulse } from '@/components/CoachPulse';

// ═════════════════════════════════════════════════════════════════════════════
// THE ADMIN'S HOME — a control room, not a training log.
//
// An admin used to land on the athlete home page: a greeting, then this
// account's own weekly kilometres, streak and personal records, with a strip of
// club stats bolted above them. Two unrelated stories on one screen, and the
// first one told was the wrong one — the person who runs the club opens the app
// to find out who is waiting for them, whether anything is broken and whether
// next week is published. None of that was on the page.
//
// So this screen answers exactly those, in that order:
//   1. דורש טיפול — the things a HUMAN has to act on, and nothing else. Rows
//      appear only while they have a number; when the list empties it collapses
//      to a single "all clear" line rather than four zeroes, because four
//      zeroes still read as a list of chores.
//   2. The club at a glance, and the delivery health that says whether the
//      workouts the coach published actually reached anybody.
//   3. Coach Pulse + tomorrow's attendance roster — kept from the coach home,
//      because both are about the athletes rather than about this account.
//   4. What state the system itself is in.
//
// Personal training is NOT here and is not duplicated anywhere: the Profile tab
// already holds the km table, the recent runs and the records, and that is where
// an admin who also runs goes to see their own week.
//
// One request feeds items 1, 2 and 4 (see /api/admin/overview) — a control room
// whose numbers arrive in six waves reads as broken even when it isn't.
// ═════════════════════════════════════════════════════════════════════════════

interface Overview {
  attention: {
    /** null = the migration behind this count hasn't been applied yet; the row hides. */
    pendingRegistrations: number | null;
    openReports: number | null;
    unfinishedOnboarding: number | null;
    nextWeekStart: string;
    nextWeekPublished: boolean;
  };
  club: { athleteCount: number; groupCount: number; deliverySuccessRate: number | null };
  system: { maintenance: boolean; syncedLast24h: number };
}

/** A loud count on the right of a row, still followed by the chevron that says it opens. */
function CountBadge({ n, tone }: { n: number; tone: 'urgent' | 'quiet' }) {
  return (
    <span className="flex items-center gap-2 shrink-0">
      <span
        className={cn(
          'min-w-[24px] rounded-pill px-2 py-0.5 text-center text-xs font-bold tabular-nums',
          tone === 'urgent' ? 'bg-accent-red text-white' : 'bg-page text-ink-700',
        )}
      >
        {n}
      </span>
      <ChevronLeft className="h-4 w-4 text-ink-300" />
    </span>
  );
}

export function AdminControlRoom({
  greeting,
  firstName,
  /** Set only when there is a team session today or tomorrow — the roster is hidden otherwise. */
  rosterWeekStart,
  rosterDay,
}: {
  greeting: string;
  firstName: string;
  rosterWeekStart?: string;
  rosterDay?: number;
}) {
  const t = useTranslations('controlRoom');
  const { data, isLoading } = useApi<Overview>('/api/admin/overview');

  const a = data?.attention;
  const rows: React.ReactNode[] = [];

  if (a) {
    if (a.pendingRegistrations) {
      rows.push(
        <InsetRow
          key="registrations"
          icon={UserPlus}
          iconBg="bg-accent-red"
          label={t('pendingRegistrations')}
          sublabel={t('pendingRegistrationsHint')}
          href="/dashboard/settings?tab=registrations"
          trailing={<CountBadge n={a.pendingRegistrations} tone="urgent" />}
        />,
      );
    }
    if (a.openReports) {
      rows.push(
        <InsetRow
          key="reports"
          icon={Bug}
          iconBg="bg-band-3"
          label={t('openReports')}
          sublabel={t('openReportsHint')}
          href="/dashboard/settings?tab=feedback"
          trailing={<CountBadge n={a.openReports} tone="urgent" />}
        />,
      );
    }
    // Not urgent — nobody is blocked — but it is the number that decides whether
    // the club actually uses the app, so it belongs on this list and not in a
    // report somebody has to remember to open.
    if (a.unfinishedOnboarding) {
      rows.push(
        <InsetRow
          key="onboarding"
          icon={Sprout}
          iconBg="bg-band-2"
          label={t('unfinishedOnboarding')}
          sublabel={t('unfinishedOnboardingHint')}
          href="/dashboard/settings?tab=users"
          trailing={<CountBadge n={a.unfinishedOnboarding} tone="quiet" />}
        />,
      );
    }
    if (!a.nextWeekPublished) {
      rows.push(
        <InsetRow
          key="plan"
          icon={CalendarClock}
          iconBg="bg-ink-400"
          label={t('nextWeekNotPublished')}
          // The week it means, spelled out: this row appears all week and "next
          // week" stops being unambiguous the moment the plan week rolls over on
          // Saturday evening. dir="ltr" on the date via the sublabel formatter.
          sublabel={t('weekOf', { date: formatWeek(a.nextWeekStart) })}
          href="/dashboard/plan/new"
        />,
      );
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-6">
      <div>
        <p className="text-sm text-ink-400">
          {greeting}
          {firstName ? ` ${firstName}` : ''} 👋
        </p>
        <h1 className="mt-0.5 text-3xl font-extrabold tracking-tight text-ink-700">{t('title')}</h1>
      </div>

      {isLoading && !data ? (
        <SkeletonList count={3} />
      ) : (
        <InsetSection header={t('needsAttention')}>
          {rows.length > 0 ? (
            rows
          ) : (
            <InsetRow
              icon={CheckCircle2}
              iconBg="bg-accent-600"
              label={t('allClear')}
              sublabel={t('allClearHint')}
            />
          )}
        </InsetSection>
      )}

      <section className="grid grid-cols-3 gap-3">
        <Card variant="muted" className="p-3 sm:p-4">
          <BigStat value={data?.club.athleteCount ?? '—'} label={t('athletes')} />
        </Card>
        <Card variant="muted" className="p-3 sm:p-4">
          <BigStat value={data?.club.groupCount ?? '—'} label={t('groups')} />
        </Card>
        <Card variant="muted" className="p-3 sm:p-4">
          <BigStat
            // A club with no deliveries at all has no rate — "0%" would read as
            // a total failure rather than as nothing having been sent yet.
            value={data?.club.deliverySuccessRate == null ? '—' : <>{data.club.deliverySuccessRate}%</>}
            label={t('delivery')}
            valueClassName={
              data?.club.deliverySuccessRate != null && data.club.deliverySuccessRate < 90
                ? 'text-accent-red'
                : undefined
            }
          />
        </Card>
      </section>

      {/* Both kept from the coach home on purpose: they are about the athletes,
          not about this account's own training. */}
      <CoachPulse />
      {rosterWeekStart && rosterDay !== undefined && (
        <AttendanceRoster weekStart={rosterWeekStart} day={rosterDay} />
      )}

      <InsetSection header={t('systemStatus')}>
        <InsetRow
          icon={Wrench}
          iconBg={data?.system.maintenance ? 'bg-band-3' : 'bg-ink-400'}
          label={t('maintenanceMode')}
          href="/dashboard/settings"
          trailing={
            <span className="flex items-center gap-2 shrink-0">
              <span
                className={cn(
                  'rounded-pill px-2.5 py-0.5 text-2xs font-bold',
                  data?.system.maintenance ? 'bg-band-3/15 text-band-3-ink' : 'bg-accent-600/10 text-accent-900',
                )}
              >
                {data?.system.maintenance ? t('on') : t('off')}
              </span>
              <ChevronLeft className="h-4 w-4 text-ink-300" />
            </span>
          }
        />
        <InsetRow
          icon={RefreshCw}
          iconBg="bg-band-2"
          label={t('syncedLast24h')}
          // Zero on a weekday means Garmin/Strava stopped delivering, which is
          // invisible from anywhere else in the app.
          sublabel={data && data.system.syncedLast24h === 0 ? t('syncedNone') : undefined}
          value={data ? t('syncedValue', { n: data.system.syncedLast24h }) : '—'}
        />
      </InsetSection>
    </div>
  );
}

/** "06.09" — day.month only; the year is never in question for next week. */
function formatWeek(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
