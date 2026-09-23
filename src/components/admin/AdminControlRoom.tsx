'use client';

import { ChevronLeft, Wrench, RefreshCw, BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { AttendanceRoster } from '@/components/AttendanceRoster';
import { AdminAttention, type AdminOverview } from '@/components/admin/AdminAttention';
import { CoachPulse } from '@/components/CoachPulse';
import { ClubWeekTiles } from '@/components/admin/ClubWeekTiles';

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
// Personal training is NOT here — this screen is the club, not the account. It is
// the only such screen, though: an admin sees every tab there is (see
// resolveNavItems), so an admin who runs reaches their own week, their runs and
// their profile exactly where every other member does.
//
// WHERE IT LIVES (2026-09-07): /dashboard/control-room, reached from the first row
// of Coach Tools — and /dashboard as well, but only for an admin with no athlete
// row, for whom nothing on the training home would have anything to say. An admin
// who DOES run (in this club, all of them) gets their training home at /dashboard
// like every other member. This component stays presentational either way: the
// greeting, the name and which session the roster is about come from
// `ControlRoomScreen`, which both doors render, so the screen cannot differ by door.
//
// One request feeds items 1, 2 and 4 (see /api/admin/overview) — a control room
// whose numbers arrive in six waves reads as broken even when it isn't.
// ═════════════════════════════════════════════════════════════════════════════

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
  // The דורש טיפול list lives in its own component (AdminAttention) because the
  // admin's TRAINING home shows it too — see that file. SWR shares this request
  // with it, so the numbers here and there can never disagree.
  const { data } = useApi<AdminOverview>('/api/admin/overview');

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-6">
      <div>
        <p className="text-sm text-ink-400">
          {greeting}
          {firstName ? ` ${firstName}` : ''} 👋
        </p>
        <h1 className="mt-0.5 text-3xl font-extrabold tracking-tight text-ink-700">{t('weekTitle')}</h1>
      </div>

      {/* Numbers first, then what needs doing (#71 option B, picked 2026-09-23):
          the admin opens this screen to see how the club is doing this week, and
          the to-do list is one short scroll below. */}
      <ClubWeekTiles week={data?.week} deliverySuccessRate={data?.club.deliverySuccessRate} />

      <AdminAttention />

      {/* Both kept from the coach home on purpose: they are about the athletes,
          not about this account's own training. */}
      <CoachPulse />
      {rosterWeekStart && rosterDay !== undefined && (
        <AttendanceRoster weekStart={rosterWeekStart} day={rosterDay} />
      )}

      <InsetSection header={t('systemStatus')}>
        {/* Who hears the alerts this screen's top section is made of. It sits
            here rather than under דורש טיפול because it is a setting, not a
            chore — but it belongs on this screen: an admin who wonders why a bug
            report reached two of their phones (or none) starts here. */}
        <InsetRow
          icon={BellRing}
          iconBg="bg-ink-700"
          label={t('notificationRouting')}
          sublabel={t('notificationRoutingHint')}
          href="/dashboard/settings?tab=notifRouting"
        />
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
