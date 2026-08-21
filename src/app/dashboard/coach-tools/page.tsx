'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, Clock, Layers, GraduationCap, BarChart3, CalendarDays, Settings } from 'lucide-react';
import { InsetSection, InsetRow, Skeleton } from '@/components/ui';
import { getSupabase } from '@/lib/supabase/client';
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
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    const finish = () => setRoleLoading(false);
    const email = localStorage.getItem('athlete_email') || localStorage.getItem('coach_email') || '';
    const viewMode = getViewMode();
    const previewRole = viewMode && viewMode !== MAINTENANCE_MODE ? viewMode : null;
    if (previewRole) { setRole(previewRole); finish(); return; }
    if (isSuperUser(email)) { setRole('admin'); finish(); return; }
    const resolve = (e: string) => {
      if (!e) { finish(); return; }
      fetch('/api/auth/me', { headers: { 'x-user-email': e } })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (data?.role) setRole(data.role); })
        .catch(() => {})
        .finally(finish);
    };
    if (email) resolve(email);
    else getSupabase().auth.getSession().then(({ data }) => {
      const e = data.session?.user?.email || '';
      resolve(e);
    }).catch(() => finish());
  }, []);

  const showAcademy = role === 'academy_coach' || role === 'admin';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight" dir="rtl">{t('title')}</h1>
        <p className="text-slate-400 mt-1 text-sm" dir="rtl">{t('subtitle')}</p>
      </div>

      <InsetSection header={t('planning')}>
        <InsetRow icon={Calendar} iconBg="bg-primary-600" label={tn('planner')} href="/dashboard/plan/new" />
        <InsetRow icon={Clock} iconBg="bg-amber-500" label={tn('history')} href="/dashboard/history" />
      </InsetSection>

      <InsetSection header={t('rosterAndGroups')}>
        <InsetRow icon={Layers} iconBg="bg-emerald-500" label={tn('groups')} href="/dashboard/groups" />
        {roleLoading ? (
          <AcademyRowSkeleton />
        ) : showAcademy ? (
          <InsetRow icon={GraduationCap} iconBg="bg-cyan-500" label={tn('academy')} href="/dashboard/academy" />
        ) : null}
      </InsetSection>

      <InsetSection header={t('insights')}>
        <InsetRow icon={BarChart3} iconBg="bg-violet-500" label={tn('teamVolume')} href="/dashboard/team-volume" />
        <InsetRow icon={CalendarDays} iconBg="bg-rose-500" label={tn('calendar')} href="/dashboard/calendar" />
      </InsetSection>

      <InsetSection>
        <InsetRow icon={Settings} iconBg="bg-slate-600" label={tn('settings')} href="/dashboard/settings" />
      </InsetSection>
    </div>
  );
}
