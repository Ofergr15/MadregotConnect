'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, Clock, Layers, GraduationCap, BarChart3, CalendarDays, Settings, Users, UserPlus, Layout, MessageSquare, Bell, Award, Trophy, ShoppingBag, Gift, DoorOpen, Wrench, Lock, BellOff, ChevronLeft } from 'lucide-react';
import { InsetSection, InsetRow, Skeleton } from '@/components/ui';
import { isWaitingOnUs, type EntryQueueMember } from '@/lib/admin/entry-queue';
import { getSupabase } from '@/lib/supabase/client';
import { useApi } from '@/lib/api';
import { isSuperUser } from '@/lib/constants';
import { getViewMode, MAINTENANCE_MODE } from '@/lib/impersonation';

// Coach Tools hub (roadmap: native-iOS redesign, Batch 0) — the staff
// equivalent of the bottom tab bar's 4th slot. Staff have too many tools
// (Planner, Groups, Academy, Team Volume, Calendar, History) for one more flat
// tab or a flat "More" sheet, so this is a proper page, same InsetSection/
// InsetRow shell as Settings' "Management" section. Purely a launcher — every
// row links to its own existing route; this page owns no content of its own.

// Skeleton for the Academy row while `role` is still resolving — reserves the
// exact height InsetRow renders (icon tile + label) so the row doesn't pop
// into/out of the list once the async role lookup settles.
function AcademyRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
      <Skeleton className="h-7 w-7 rounded-md shrink-0" />
      <Skeleton className="h-3.5 w-24" />
    </div>
  );
}

export default function CoachToolsPage() {
  const t = useTranslations('coachTools');
  const tn = useTranslations('nav');
  // Reuses Settings' own labels for the rows moved here from its "ניהול"
  // section below — same detail screens, just a one-tap-away entry point
  // instead of buried in the "More" overflow sheet.
  const ts = useTranslations('settings');
  // Role scenarios / super-user resolve synchronously — no fetch needed.
  const viewMode = getViewMode();
  const previewRole = viewMode && viewMode !== MAINTENANCE_MODE ? viewMode : null;

  // Best-effort viewer email: localStorage first, else the live Supabase
  // session — same resolution order as MaintenanceGate.
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (previewRole) return;
    const stored = localStorage.getItem('athlete_email') || localStorage.getItem('coach_email') || '';
    if (stored) { setEmail(stored); return; }
    getSupabase().auth.getSession()
      .then(({ data }) => setEmail(data.session?.user?.email || ''))
      .catch(() => setEmail(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared SWR cache (same endpoint/shape other role checks in the app use) —
  // revisiting this page shows the Academy row instantly from cache instead
  // of a skeleton flash every time.
  const { data, isLoading: roleLoading } = useApi<{ role?: string }>(
    !previewRole && email ? '/api/auth/me' : null,
  );
  const role = previewRole || (isSuperUser(email) ? 'admin' : data?.role) || null;
  const showAcademy = role === 'academy_coach' || role === 'admin';

  // ── THE STATUS STRIP ───────────────────────────────────────────────────────
  // This page was a pure launcher: twelve rows, all equally quiet, and nothing
  // on it said whether anything needed doing. So a maintenance window left on
  // for days, or three people waiting a week for approval, were invisible until
  // somebody complained. Same SWR key the queue panel reads, so opening it is a
  // cache hit and the numbers here cannot disagree with the list inside.
  // 403 for non-approver staff just leaves `queue` undefined and the strip out.
  const { data: queue } = useApi<{ maintenance: boolean; members: EntryQueueMember[] }>(
    '/api/admin/entry-queue',
  );
  const members = queue?.members;
  const waiting = members?.filter((m) => isWaitingOnUs(m.stage)).length ?? 0;
  const blocked = members?.filter((m) => m.blocked).length ?? 0;
  const stuck = members?.filter((m) => m.stage === 'never' || m.stage === 'setup').length ?? 0;

  /**
   * A count worth interrupting for, as a pill. Zero shows nothing at all.
   * Carries the chevron itself, because `trailing` replaces it — a row that
   * loses its chevron the moment it gains a badge stops looking tappable.
   */
  const countPill = (n: number, tone: 'bad' | 'warn') =>
    n > 0 ? (
      <span className="flex items-center gap-2 shrink-0">
        <span
          className={`min-w-[22px] px-1.5 py-0.5 rounded-pill text-3xs font-bold text-center tabular-nums text-white ${
            tone === 'bad' ? 'bg-accent-red' : 'bg-band-3'
          }`}
        >
          {n}
        </span>
        <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
      </span>
    ) : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold text-ink-700 tracking-tight" dir="rtl">{t('title')}</h1>
        <p className="text-ink-400 mt-1 text-sm" dir="rtl">{t('subtitle')}</p>
      </div>

      {/* Only when there is something to say. A status card that permanently
          reads "all clear" is a card people stop looking at. */}
      {!!members && (queue!.maintenance || waiting > 0 || stuck > 0) && (
        <InsetSection header={t('statusHeader')}>
          {queue!.maintenance && (
            <InsetRow
              icon={Wrench}
              iconBg="bg-accent-red"
              label={t('statusMaintenance')}
              sublabel={t('statusMaintenanceBlocked', { count: blocked })}
              href="/dashboard/entry-queue?bucket=waiting"
              trailing={countPill(blocked, 'bad')}
            />
          )}
          {waiting > 0 && (
            <InsetRow
              icon={Lock}
              iconBg="bg-band-3"
              label={t('statusWaiting')}
              sublabel={t('statusWaitingSub')}
              href="/dashboard/entry-queue?bucket=waiting"
              trailing={countPill(waiting, 'bad')}
            />
          )}
          {stuck > 0 && (
            <InsetRow
              icon={BellOff}
              iconBg="bg-ink-300"
              label={t('statusStuck')}
              sublabel={t('statusStuckSub')}
              href="/dashboard/entry-queue?bucket=stuck"
              trailing={countPill(stuck, 'warn')}
            />
          )}
        </InsetSection>
      )}

      <InsetSection header={t('planning')}>
        <InsetRow icon={Calendar} iconBg="bg-brand-600" label={tn('planner')} href="/dashboard/plan/new" />
        <InsetRow icon={Clock} iconBg="bg-band-3" label={tn('history')} href="/dashboard/history" />
      </InsetSection>

      <InsetSection header={t('rosterAndGroups')}>
        <InsetRow icon={Layers} iconBg="bg-accent-600" label={tn('groups')} href="/dashboard/groups" />
        {roleLoading ? (
          <AcademyRowSkeleton />
        ) : showAcademy ? (
          <InsetRow icon={GraduationCap} iconBg="bg-band-2" label={tn('academy')} href="/dashboard/academy" />
        ) : null}
      </InsetSection>

      <InsetSection header={t('insights')}>
        <InsetRow icon={BarChart3} iconBg="bg-violet-500" label={tn('teamVolume')} href="/dashboard/team-volume" />
        <InsetRow icon={CalendarDays} iconBg="bg-accent-red" label={tn('calendar')} href="/dashboard/calendar" />
      </InsetSection>

      <InsetSection header={ts('management')}>
        {/* First row in Management on purpose: it is the only screen that answers
            "why can't this person get in" across BOTH gates — approval and the
            maintenance window — and the only one that can open them together. */}
        <InsetRow
          icon={DoorOpen}
          iconBg="bg-brand-600"
          label={t('entryQueue')}
          href="/dashboard/entry-queue"
          trailing={countPill(waiting, 'bad')}
        />
        <InsetRow icon={UserPlus} iconBg="bg-accent-600" label={ts('registrations')} href="/dashboard/settings?tab=registrations" />
        <InsetRow icon={Users} iconBg="bg-indigo-500" label={ts('userManager')} href="/dashboard/settings?tab=users" />
        <InsetRow icon={Layout} iconBg="bg-band-3" label={ts('tabManager')} href="/dashboard/settings?tab=tabs" />
        {/* The reports inbox has its own screen now (next to the review screen
            people file from), so this row points at it directly instead of at a
            tab inside Settings. */}
        <InsetRow icon={MessageSquare} iconBg="bg-teal-500" label={ts('feedback')} href="/dashboard/review/all" />
        <InsetRow icon={Bell} iconBg="bg-accent-red" label={ts('notificationCenter')} href="/dashboard/settings?tab=notifications" />
        <InsetRow icon={Bell} iconBg="bg-band-2" label={ts('workoutReminders')} href="/dashboard/settings?tab=reminders" />
        <InsetRow icon={Award} iconBg="bg-fuchsia-500" label={ts('badgeManager')} href="/dashboard/settings?tab=badges" />
        <InsetRow icon={Trophy} iconBg="bg-band-3" label={ts('challengeManager')} href="/dashboard/settings?tab=challenges" />
        <InsetRow icon={ShoppingBag} iconBg="bg-band-2" label={ts('storeManager')} href="/dashboard/settings?tab=store" />
        <InsetRow icon={Gift} iconBg="bg-pink-600" label={ts('perksManager')} href="/dashboard/settings?tab=perks" />
      </InsetSection>

      <InsetSection>
        <InsetRow icon={Settings} iconBg="bg-ink-300" label={tn('settings')} href="/dashboard/settings" />
      </InsetSection>
    </div>
  );
}
