'use client';

import { ChevronLeft, UserPlus, Bug, Sprout, CalendarClock, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SkeletonList } from '@/components/ui';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';

/**
 * דורש טיפול — the things a human has to act on, and nothing else.
 *
 * Lifted out of `AdminControlRoom` so it can also sit on the admin's TRAINING home
 * at /dashboard. Reported (e7951e14) as "צריך לעשות סדר באיזור של הadmin — לקבל שם
 * פירוט בעמוד הראשי על משתמשים חדשים, בעיות, הערות, באגים וכו". The list already
 * existed and said exactly that; the problem was WHERE it was. Every admin in this
 * club also runs, so /dashboard gives them the runner home and the control room
 * lives one tap away at /dashboard/control-room — which means the summary was on a
 * screen an admin has no reason to open on a normal morning.
 *
 * So it renders in both places, from this one component: the control room shows it
 * in full, and the training home shows the same rows in `compact` form with a way
 * through to the rest of the control room.
 *
 * ── The one behavioural difference, and why ──────────────────────────────────
 * With nothing to act on, the full version says "all clear" and the compact one
 * renders NOTHING. On the control room that line is the answer to the question the
 * screen was opened to ask. On a training home it would be a permanent empty chore
 * card above this morning's run — the surest way to teach somebody to scroll past
 * the place their alerts appear.
 *
 * Both share one `/api/admin/overview` request through SWR's cache, so the second
 * mount of this component costs nothing.
 */

export interface AdminOverview {
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
export function CountBadge({ n, tone }: { n: number; tone: 'urgent' | 'quiet' }) {
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

/** "06.09" — day.month only; the year is never in question for next week. */
function formatWeek(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function AdminAttention({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('controlRoom');
  const { data, isLoading } = useApi<AdminOverview>('/api/admin/overview');

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
          // The inbox got a screen of its own next to the review form; it used to
          // be a tab four taps inside Settings, and this row still pointed there.
          href="/dashboard/review/all"
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

  // Nothing to say on a training home — see the docblock.
  if (compact && (rows.length === 0 || (isLoading && !data))) return null;

  if (isLoading && !data) return <SkeletonList count={3} />;

  return (
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
      {/* Only on the training home: the rows above are the urgent half of the
          control room, and this is the way to the other half (club numbers,
          delivery health, system state) without hunting through Coach Tools. */}
      {compact && (
        <InsetRow
          icon={ShieldCheck}
          iconBg="bg-brand-600"
          label={t('title')}
          href="/dashboard/control-room"
        />
      )}
    </InsetSection>
  );
}
