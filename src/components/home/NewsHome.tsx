'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, UserPlus, Layers, Sun, MessageSquare, Image as ImageIcon, Route, MessageCircle, Bug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { WeekColumns, Spark } from '@/components/club-numbers/charts';
import type { ClubNumbers } from '@/lib/club-numbers/compute';

// ═════════════════════════════════════════════════════════════════════════════
// "מה חדש?" — the admin's first screen (2026-10-20; mockups/admin-ia.html, Ofer
// approved). Research-led (NN/g, Apple HIG; Shopify/Apple Settings/Slack): the
// first screen leads with what needs you — only what is above zero — then the
// club at a glance in charts, and the frequent actions behind one "+" at the top
// (Ofer: "a + top-left that opens the options"). The full numbers screen stays at
// /dashboard/numbers, one tap away.
// ═════════════════════════════════════════════════════════════════════════════

interface NeedsYou { join: number; joinOldestDays: number; reports: number }
interface Attention { pain: number; wantsReply: number; people: number; total: number }

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const n = (v: number) => Math.round(v).toLocaleString('en-US');

const ACTIONS = [
  { href: '/dashboard/people?invite=1', icon: UserPlus, bg: 'bg-brand-600', title: 'הזמנת רץ', sub: 'שם, מייל ודבוקה — והקישור יוצא' },
  { href: '/dashboard/plan/new', icon: Layers, bg: 'bg-accent-900', title: 'פרסום השבוע', sub: 'לאפליקציה ולשעונים, בלחיצה אחת' },
  { href: '/dashboard/day-session', icon: Sun, bg: 'bg-[#ff9500]', title: 'טקסט לאימון מחר', sub: 'שעה, מקום ונוסח לוואטסאפ' },
  { href: '/dashboard/content/publish?type=message', icon: MessageSquare, bg: 'bg-[#5856d6]', title: 'עדכון למועדון', sub: 'הודעה לכולם או לדבוקה' },
  { href: '/dashboard/photos', icon: ImageIcon, bg: 'bg-[#ff2d55]', title: 'תמונות מהאימון', sub: 'האימון האחרון וכל התיקיות' },
] as const;

function NeedRow({ href, icon: Icon, bg, n: count, title, sub }: { href: string; icon: typeof Route; bg: string; n: number; title: string; sub: string }) {
  return (
    <Link href={href} className="flex min-h-[58px] items-center gap-3 px-3.5 active:bg-page/60">
      <span className={cn('grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-white', bg)}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1 py-2">
        <span className="block text-[15.5px] font-semibold text-ink-700">{title}</span>
        <span className="block truncate text-[12.5px] text-ink-400">{sub}</span>
      </span>
      <span className="rounded-full bg-accent-red px-2 text-[13px] font-bold leading-[20px] text-white tabular-nums">{count}</span>
      <ChevronLeft className="h-4 w-4 text-ink-300" />
    </Link>
  );
}

export function NewsHome() {
  const { data: needs } = useApi<NeedsYou>('/api/admin/needs-you');
  const { data: att } = useApi<Attention>('/api/staff/attention');
  const { data: nums } = useApi<ClubNumbers>('/api/admin/club-numbers');
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const today = new Date();
  const c = nums?.overview.club;
  const g = nums?.growth;
  const fullWeeks = nums ? nums.weeks.slice(0, -1).slice(-8) : [];
  const km = c ? c.weeklyKm.slice(-8).map((w) => w.km) : [];
  const lastFull = km.at(-1) ?? 0;
  const prevFull = km.at(-2) ?? 0;
  const delta = prevFull ? Math.round(((lastFull - prevFull) / prevFull) * 100) : null;
  const active = g ? g.activeByWeek.slice(-9) : [];
  const packs = g ? Object.entries(g.packsByWeek).map(([name, series]) => ({ name, now: (series as number[]).at(-1) ?? 0 })).filter((p) => p.now > 0) : [];
  const packMax = Math.max(1, ...packs.map((p) => p.now));
  const painOrReply = att ? att.pain + att.wantsReply : 0;
  const anyNeed = !!needs && (needs.join > 0 || needs.reports > 0) || painOrReply > 0;

  return (
    <div className="pb-8" dir="rtl">
      <div className="relative px-1 pt-1">
        <h1 className="text-[32px] font-black tracking-tight text-ink-700">מה חדש?</h1>
        <p className="text-sm text-ink-400">יום {DAYS[today.getDay()]}, {today.getDate()}.{today.getMonth() + 1}</p>
        {/* The frequent actions, behind one button (top-left in RTL). */}
        <button
          type="button"
          onClick={() => setMenu((m) => !m)}
          aria-label="פעולה חדשה"
          aria-expanded={menu}
          className="absolute end-1 top-1 grid h-10 w-10 place-items-center rounded-full bg-brand-600 text-white shadow-[0_4px_12px_rgba(21,37,255,0.35)] transition-transform active:scale-95"
        >
          <Plus className={cn('h-5 w-5 transition-transform duration-200', menu && 'rotate-45')} strokeWidth={2.6} />
        </button>
        {menu && (
          <>
            <button type="button" aria-label="סגירה" className="fixed inset-0 z-30 cursor-default bg-black/20" onClick={() => setMenu(false)} />
            <div ref={menuRef} role="menu" className="absolute end-1 top-14 z-40 w-[290px] overflow-hidden rounded-2xl bg-card/95 shadow-[0_14px_40px_rgba(0,0,0,0.25)] backdrop-blur-xl">
              {ACTIONS.map((a, i) => (
                <Link key={a.title} href={a.href} role="menuitem" onClick={() => setMenu(false)} className={cn('flex items-center gap-3 px-3.5 py-3 active:bg-page/60', i > 0 && 'border-t border-page')}>
                  <span className={cn('grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-white', a.bg)}><a.icon className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-[15.5px] font-semibold text-ink-700">{a.title}</span>
                    <span className="block text-[12.5px] text-ink-400">{a.sub}</span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      {anyNeed && (
        <>
          <p className="px-4 pb-1.5 pt-5 text-[13px] font-semibold text-ink-400">דורש אותך</p>
          <div className="divide-y divide-page overflow-hidden rounded-2xl bg-card">
            {needs && needs.join > 0 && (
              <NeedRow href="/dashboard/onboarding-funnel?stage=approved" icon={Route} bg="bg-[#5856d6]" n={needs.join} title="בקשות הצטרפות"
                sub={needs.joinOldestDays > 1 ? `הוותיק מחכה ${needs.joinOldestDays} ימים` : 'מחכים לאישור שלך'} />
            )}
            {painOrReply > 0 && att && (
              <NeedRow href="/dashboard/workout-feedback" icon={MessageCircle} bg="bg-accent-red" n={painOrReply} title={att.pain ? 'משוב עם כאב' : 'משוב שמחכה לתשובה'}
                sub={att.pain ? `${att.pain} עם כאב${att.wantsReply ? ` · ${att.wantsReply} מבקשים תשובה` : ''}` : `${att.people} רצים`} />
            )}
            {needs && needs.reports > 0 && (
              <NeedRow href="/dashboard/review/all" icon={Bug} bg="bg-[#ff9500]" n={needs.reports} title="דיווחים חדשים" sub="מה לא עובד לאנשים" />
            )}
          </div>
        </>
      )}

      <p className="px-4 pb-1.5 pt-5 text-[13px] font-semibold text-ink-400">המועדון</p>
      {c ? (
        <>
          <section className="rounded-[20px] bg-card p-3.5">
            <p className="text-[12.5px] text-ink-400">ק״מ בשבוע שעבר</p>
            <p className="text-[28px] font-black leading-tight text-ink-700"><bdi dir="ltr">{n(lastFull)}</bdi></p>
            {delta !== null && (
              <p className={cn('text-[13px] font-semibold', delta >= 0 ? 'text-accent-900' : 'text-accent-red')}>
                {delta >= 0 ? '▲' : '▼'} <bdi dir="ltr">{Math.abs(delta)}%</bdi> משבוע קודם
              </p>
            )}
            <WeekColumns weeks={fullWeeks} km={km} soFar={c.soFar} lastSame={c.lastSame} projected={c.projected} nowLabel="השבוע" height={160} />
            <p className="text-[12px] text-ink-400">השבוע עד עכשיו: <bdi dir="ltr">{n(c.soFar)}</bdi> ק״מ{c.projected != null && <> · צפי <bdi dir="ltr">{n(c.projected)}</bdi></>}</p>
          </section>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <section className="rounded-[20px] bg-card p-3.5">
              <p className="text-[12.5px] text-ink-400">רצו השבוע</p>
              <p className="text-[26px] font-black leading-tight text-ink-700"><bdi dir="ltr">{c.ranThisWeek}</bdi></p>
              {active.length > 2 && <Spark values={active} color="#15803d" className="mt-1 !h-[34px] !w-full" />}
            </section>
            <section className="rounded-[20px] bg-card p-3.5">
              <p className="text-[12.5px] text-ink-400">הצטרפו החודש</p>
              <p className="text-[26px] font-black leading-tight text-ink-700"><bdi dir="ltr">{c.newThisMonth}</bdi></p>
              <p className="text-[12px] text-ink-400"><bdi dir="ltr">{c.members}</bdi> חברי מועדון</p>
            </section>
          </div>
          {packs.length > 0 && (
            <section className="mt-2.5 rounded-[20px] bg-card p-3.5">
              <p className="text-[12.5px] text-ink-400">בכל דבוקה</p>
              {packs.map((p, i) => (
                <div key={p.name} className="mt-2 grid grid-cols-[72px_1fr_28px] items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink-700">{p.name}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-page">
                    <span className={cn('block h-full rounded-full', ['bg-[#F0643C]', 'bg-brand-600', 'bg-accent-900', 'bg-ink-300'][i % 4])} style={{ width: `${(p.now / packMax) * 100}%` }} />
                  </span>
                  <span className="text-end text-[13px] font-semibold tabular-nums text-ink-500">{p.now}</span>
                </div>
              ))}
            </section>
          )}
          <Link href="/dashboard/numbers" className="mt-3 flex items-center justify-center gap-1 text-[14px] font-semibold text-brand-600">
            לכל המספרים <ChevronLeft className="h-4 w-4" />
          </Link>
        </>
      ) : (
        <div className="h-[260px] animate-pulse rounded-[20px] bg-card" />
      )}
    </div>
  );
}
