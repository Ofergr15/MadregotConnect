'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, Clock, Layers, GraduationCap, BarChart3, CalendarDays, Settings, Users, UserPlus, Layout, MessageSquare, Bell, Award, Trophy, ShoppingBag, Gift } from 'lucide-react';
import { InsetSection, InsetRow, Skeleton } from '@/components/ui';
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold text-ink-700 tracking-tight" dir="rtl">{t('title')}</h1>
        <p className="text-ink-400 mt-1 text-sm" dir="rtl">{t('subtitle')}</p>
      </div>

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
