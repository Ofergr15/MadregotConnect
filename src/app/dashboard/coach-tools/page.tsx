'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, Clock, Layers, GraduationCap, BarChart3, CalendarDays, Settings, ChevronRight } from 'lucide-react';
import { InsetSection, InsetRow } from '@/components/ui';
import { getSupabase } from '@/lib/supabase/client';
import { isSuperUser } from '@/lib/constants';
import { getViewMode, MAINTENANCE_MODE } from '@/lib/impersonation';

// Coach Tools hub (roadmap: native-iOS redesign, Batch 0) — the staff
// equivalent of the bottom tab bar's 4th slot. Staff have too many tools
// (Planner, Groups, Academy, Team Volume, Calendar, History) for one more flat
// tab or a flat "More" sheet, so this is a proper page, same InsetSection/
// InsetRow shell as Settings' "Management" section. Purely a launcher — every
// row links to its own existing route; this page owns no content of its own.
export default function CoachToolsPage() {
  const t = useTranslations('coachTools');
  const tn = useTranslations('nav');
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const email = localStorage.getItem('athlete_email') || localStorage.getItem('coach_email') || '';
    const viewMode = getViewMode();
    const previewRole = viewMode && viewMode !== MAINTENANCE_MODE ? viewMode : null;
    if (previewRole) { setRole(previewRole); return; }
    if (isSuperUser(email)) { setRole('admin'); return; }
    const resolve = (e: string) => {
      if (!e) return;
      fetch('/api/auth/me', { headers: { 'x-user-email': e } })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (data?.role) setRole(data.role); })
        .catch(() => {});
    };
    if (email) resolve(email);
    else getSupabase().auth.getSession().then(({ data }) => {
      const e = data.session?.user?.email || '';
      if (e) resolve(e);
    }).catch(() => {});
  }, []);

  const chevron = <ChevronRight className="h-4 w-4 text-slate-500 shrink-0 rotate-180" />;
  const showAcademy = role === 'academy_coach' || role === 'admin';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight" dir="rtl">{t('title')}</h1>
        <p className="text-slate-400 mt-1 text-sm" dir="rtl">{t('subtitle')}</p>
      </div>

      <InsetSection header={t('planning')}>
        <InsetRow icon={Calendar} iconBg="bg-primary-600" label={tn('planner')} href="/dashboard/plan/new" trailing={chevron} />
        <InsetRow icon={Clock} iconBg="bg-amber-500" label={tn('history')} href="/dashboard/history" trailing={chevron} />
      </InsetSection>

      <InsetSection header={t('rosterAndGroups')}>
        <InsetRow icon={Layers} iconBg="bg-emerald-500" label={tn('groups')} href="/dashboard/groups" trailing={chevron} />
        {showAcademy && (
          <InsetRow icon={GraduationCap} iconBg="bg-cyan-500" label={tn('academy')} href="/dashboard/academy" trailing={chevron} />
        )}
      </InsetSection>

      <InsetSection header={t('insights')}>
        <InsetRow icon={BarChart3} iconBg="bg-violet-500" label={tn('teamVolume')} href="/dashboard/team-volume" trailing={chevron} />
        <InsetRow icon={CalendarDays} iconBg="bg-rose-500" label={tn('calendar')} href="/dashboard/calendar" trailing={chevron} />
      </InsetSection>

      <InsetSection>
        <InsetRow icon={Settings} iconBg="bg-slate-600" label={tn('settings')} href="/dashboard/settings" trailing={chevron} />
      </InsetSection>
    </div>
  );
}
