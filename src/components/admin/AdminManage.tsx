'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, GraduationCap, Bug, Sparkles, Trophy, Bell, ShieldCheck, Gauge, Image as ImageIcon, Footprints, Gift, Users, LifeBuoy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { InsetRow, InsetSection } from '@/components/ui';
import { MANAGE_GROUPS } from '@/lib/admin/manage-groups';
import { findPlaces } from '@/lib/search/places';

// ═════════════════════════════════════════════════════════════════════════════
// ניהול — the admin's version (2026-10-20, mockups/admin-ia.html): seven rows
// instead of twenty, each opening one place that holds everything of its kind
// (NN/g: flat with visual grouping, at most two levels; Apple Settings: search on
// top). The search finds any tool or setting by name, or a runner by name. With
// no "עוד" in the admin's bar, the member pages the admin also uses sit at the
// bottom. Coaches keep the classic Management page (coach-tools).
// ═════════════════════════════════════════════════════════════════════════════

interface NeedsYou { join: number; joinOldestDays: number; reports: number }

/** Every place reachable from here, for the search. Hebrew synonyms in `also`. */
const INDEX: Array<{ label: string; href: string; also?: string }> = [
  { label: 'אקדמיה', href: '/dashboard/academy', also: 'מתאמנים מועמדים לוח' },
  { label: 'דיווחים', href: '/dashboard/review/all', also: 'באגים תקלות' },
  { label: 'גרסאות', href: '/dashboard/whats-new', also: 'מה חדש שחרור אישור' },
  { label: 'חדר בקרה', href: '/dashboard/control-room' },
  { label: 'בדיקות הרשמה', href: '/dashboard/tests', also: 'בדיקה טסט הרשמה זרימה' },
  { label: 'מדרגות במספרים', href: '/dashboard/numbers', also: 'מספרים גרפים' },
  ...MANAGE_GROUPS.flatMap((g) => g.items.map((i) => ({ label: i.label, href: i.href, also: `${g.title} ${i.also ?? ''}` }))),
  { label: 'בניית התוכנית ופרסום', href: '/dashboard/plan/new', also: 'מתכנן תוכנית שבועית שעון גרמין' },
  { label: 'פתיחת השבוע', href: '/dashboard/week' },
  { label: 'אימון מחר', href: '/dashboard/day-session', also: 'וואטסאפ' },
  { label: 'משוב אחרי אימון', href: '/dashboard/workout-feedback' },
  { label: 'נוכחות', href: '/dashboard/practice-attendance' },
  { label: 'נפח הקבוצה', href: '/dashboard/team-volume' },
  { label: 'תוכניות קודמות', href: '/dashboard/history', also: 'היסטוריה' },
  { label: 'אישור מצטרפים', href: '/dashboard/onboarding-funnel?stage=approved', also: 'הצטרפות משפך ממתינים' },
  { label: 'דבוקות', href: '/dashboard/groups', also: 'קבוצות' },
];

export function AdminManage() {
  const { data: needs } = useApi<NeedsYou>('/api/admin/needs-you');
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const s = q.trim();
    if (!s) return [];
    // This screen's own rows, then every screen and setting the shared index knows
    // (lib/search/places — the main search reads the same list); the admin opens them all.
    const own = INDEX.filter((x) => `${x.label} ${x.also ?? ''}`.includes(s));
    const seen = new Set(own.map((x) => x.href));
    return [...own, ...findPlaces({ isSuper: true }, s, 12).filter((p) => !seen.has(p.href))].slice(0, 10);
  }, [q]);

  return (
    <div className="pb-8" dir="rtl">
      <h1 className="px-1 text-[32px] font-black tracking-tight text-ink-700">ניהול</h1>
      <label className="relative my-3 block">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש כלי, הגדרה או רץ" aria-label="חיפוש בניהול"
          className="min-h-[44px] w-full rounded-xl bg-card ps-9 pe-4 text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-600" />
      </label>

      {q.trim() ? (
        <InsetSection>
          {hits.map((h) => <InsetRow key={h.href} label={h.label} href={h.href} />)}
          {/* A name that is no tool is probably a runner. */}
          <InsetRow icon={Users} iconBg="bg-ink-400" label={`לחפש "${q.trim()}" באנשים`} href={`/dashboard/people?q=${encodeURIComponent(q.trim())}`} />
        </InsetSection>
      ) : (
        <>
          <InsetSection>
            <InsetRow icon={GraduationCap} iconBg="bg-[#af52de]" label="אקדמיה" sublabel="מתאמנים, מועמדים ולוח" href="/dashboard/academy" />
            <InsetRow icon={Bug} iconBg="bg-accent-red" label="דיווחים" sublabel={needs?.reports ? `${needs.reports} חדשים` : 'מה לא עובד לאנשים'} href="/dashboard/review/all"
              trailing={needs?.reports ? <span className="rounded-full bg-[#ff9500] px-2 text-[13px] font-bold leading-[20px] text-white tabular-nums">{needs.reports}</span> : null} />
            <InsetRow icon={Sparkles} iconBg="bg-[#ff9500]" label="גרסאות" sublabel="מה יצא, ואישור השחרור הבא" href="/dashboard/whats-new" />
          </InsetSection>
          <InsetSection>
            {MANAGE_GROUPS.map((g) => (
              <InsetRow key={g.key} icon={g.key === 'club' ? Trophy : g.key === 'notify' ? Bell : ShieldCheck}
                iconBg={g.key === 'club' ? 'bg-[#ff9500]' : g.key === 'notify' ? 'bg-accent-red' : 'bg-ink-400'}
                label={g.title} sublabel={g.items.map((i) => i.label).join(', ')} href={`/dashboard/manage/${g.key}`} />
            ))}
            <InsetRow icon={Gauge} iconBg="bg-ink-400" label="חדר בקרה" sublabel="התמונה המלאה של המערכת" href="/dashboard/control-room" />
            <InsetRow icon={ShieldCheck} iconBg="bg-[#16A34A]" label="בדיקות הרשמה" sublabel="מה לעשות בכל שלב, וסטטוס חי" href="/dashboard/tests" />
          </InsetSection>
          {/* No "עוד" in the admin's bar: the member pages the admin uses too. */}
          <p className="px-4 pb-1.5 text-[13px] font-semibold text-ink-400">גם באפליקציה</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { href: '/dashboard/photos', icon: ImageIcon, bg: 'bg-[#ff2d55]', label: 'תמונות' },
              { href: '/dashboard/run-together', icon: Footprints, bg: 'bg-accent-900', label: 'לרוץ ביחד' },
              { href: '/dashboard/records', icon: Trophy, bg: 'bg-[#ff9500]', label: 'שיאי המועדון' },
              { href: '/dashboard/benefits', icon: Gift, bg: 'bg-[#af52de]', label: 'הטבות' },
              { href: '/dashboard/search', icon: Search, bg: 'bg-ink-400', label: 'חיפוש' },
              { href: '/dashboard/review', icon: LifeBuoy, bg: 'bg-accent-red', label: 'דיווח על תקלה' },
            ].map((a) => (
              <Link key={a.href} href={a.href} className="rounded-2xl bg-card px-1 py-3 text-center active:opacity-80">
                <span className={cn('mx-auto grid h-10 w-10 place-items-center rounded-xl text-white', a.bg)}><a.icon className="h-5 w-5" /></span>
                <span className="mt-1.5 block text-[13px] font-semibold text-ink-700">{a.label}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
