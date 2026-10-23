'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Layers } from 'lucide-react';
import { useApi } from '@/lib/api';
import { getViewMode } from '@/lib/impersonation';
import { readClock } from '@/lib/quality-session/clock';
import { previewHidesShare, useQualitySessionAccess } from '@/lib/quality-session/use-access';
import { inRowWindow, packRuns, runnersOf, suggestOrder, type QsClock, type QsSession } from '@/lib/quality-session/model';

// "שיתוף הדבוקות", AT THE TOP OF THE FEED — 07:00 → 11:00 ON A QUALITY OR LONG-RUN
// MORNING (read off the plan), ALL DAY ON ONE THE SUPER USER MARKED SPECIAL.
// The first of two separate staff cards (mockups/post-session/v2): how many finished in
// each pack and whose run is suggested for its card (the longest of the morning), and
// one button into the one-look flow — /dashboard/quality-session?all=1. The photos
// are the second card (StaffSessionPhotos), under its own title.
// The super user's and the "אינסטגרם" switch's (lib/quality-session/access.ts); outside
// the window, or on any other day, it renders nothing, inside the feed's `empty:mb-0`.

const pace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const initials = (n: string) => n.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

export function QualitySessionRow() {
  const hasAccess = useQualitySessionAccess();
  const [clock, setClock] = useState<QsClock | null>(null);
  useEffect(() => { setClock(readClock()); }, []);

  // Asked all day: a day the super user marked special shows outside the window too.
  const on = hasAccess && !previewHidesShare(getViewMode()) && !!clock;
  const { data } = useApi<QsSession>(on ? `/api/quality-session?date=${clock!.date}` : null, { refreshInterval: 60_000 });
  const packs = useMemo(() => {
    if (!data || !clock) return [];
    return ([1, 2, 3] as const).map(p => {
      const rs = runnersOf(packRuns(data, p, clock.minutes)).sort(suggestOrder);
      return { p, done: rs.length, top: rs[0]?.run ?? null };
    });
  }, [data, clock]);
  if (!on || !data?.workout || !(data.workout.special || inRowWindow(clock!.minutes))) return null;

  const href = `/dashboard/quality-session?date=${clock!.date}`;
  const runs = packs.reduce((n, x) => n + x.done, 0);
  const kind = data.workout.long ? 'הארוכה' : 'אימון האיכות';
  return (
    <section dir="rtl">
      <h2 className="mb-1.5 px-1 text-[13px] font-extrabold text-ink-500">שיתוף הדבוקות</h2>
      <div className="rounded-[22px] border-[1.5px] border-dashed border-[#9AA0FF] bg-card p-3.5">
        <span className="inline-block rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-extrabold text-brand-600">רק לצוות</span>
        <div className="mt-2 flex items-center gap-2.5">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FFF1E8] text-xl">🏃</span>
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[15px] text-ink-900">{kind} של הבוקר{data.workout.name ? <> · <bdi dir="ltr">{data.workout.name}</bdi></> : null}</b>
            <small className="block truncate text-12 text-ink-500"><bdi dir="ltr">{runs}</bdi> סיימו · מתעדכן לבד</small>
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl bg-page">
          {packs.map((x, i) => (
            <Link key={x.p} href={href} className={`flex min-h-[54px] items-center gap-2.5 px-3 ${i ? 'border-t border-card' : ''}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-extrabold text-white">{x.top ? initials(x.top.name) : x.p}</span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[14px] text-ink-900">דבוקה {x.p} · <bdi dir="ltr">{x.done}</bdi> סיימו</b>
                <small className="block truncate text-12 text-ink-500">
                  {x.top ? <>{x.top.name} · <bdi dir="ltr">{(x.top.dist / 1000).toFixed(1)}</bdi> ק״מ · <bdi dir="ltr">{pace(x.top.pace)}</bdi></> : 'עוד אף אחד לא סיים'}
                </small>
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />
            </Link>
          ))}
        </div>
        <Link href={`${href}&all=1`} className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white">
          <Layers className="h-5 w-5" aria-hidden /> שיתוף כל הדבוקות
        </Link>
        <p className="mt-2 text-center text-12 text-ink-400">בוחרים מראה פעם אחת על דבוקה 1 — 2 ו־3 מקבלות אותו</p>
      </div>
    </section>
  );
}
