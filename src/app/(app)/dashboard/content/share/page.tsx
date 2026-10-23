'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { FeedAvatar } from '@/components/FeedAvatar';
import { Empty, Group, SectionHead, TypePage } from '@/components/content/hub-ui';
import { dm, dowOf, kindOf, shareHref, titleOf, useShareDays } from '@/components/content/share-ui';

// ═════════════════════════════════════════════════════════════════════════════
// תוכן › שיתוף האימון (mockups/content-share.html, Ofer 10-23): today's session with
// each pack's suggested runner and one button into the one-look flow, and every
// session before it — yesterday's can be shared too. All of it opens the existing
// share screen, unchanged.
// ═════════════════════════════════════════════════════════════════════════════

export default function ContentSharePage() {
  const { access, data } = useShareDays();
  const t = data?.today;
  return (
    <TypePage type="share">
      {!access ? (
        <Group><Empty>השיתוף פתוח למי שמסומן ״אינסטגרם״ במסך התפקידים.</Empty></Group>
      ) : (
        <>
          {t ? (
            <section className="mt-2 rounded-[22px] p-3.5 text-white" style={{ background: 'radial-gradient(120% 90% at 85% 0%, #8b5cf6 0%, #6d3fd6 50%, #3b1f8f 100%)' }}>
              <p className="text-[12px] font-extrabold opacity-80">היום · מחכה לשיתוף</p>
              <p className="mt-0.5 text-[20px] font-black leading-tight">{dowOf(t.date)} · {titleOf(t)} · {dm(t.date)}</p>
              <p className="mt-0.5 text-[13px] opacity-85">
                <bdi dir="ltr">{t.runs}</bdi> סיימו{t.packs.map((x) => <span key={x.pack}> · <bdi dir="ltr">{x.done}</bdi> בדבוקה {x.pack}</span>)}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {t.packs.map((x) => (
                  <Link key={x.pack} href={shareHref(t.date)} className="rounded-[14px] bg-white/[0.13] px-1.5 py-2.5 text-center">
                    <span className="mx-auto block h-[46px] w-[46px] overflow-hidden rounded-full border-2 border-white/80">
                      {x.top ? <FeedAvatar name={x.top.name} url={x.top.avatarUrl} className="h-full w-full text-[14px]" /> : <span className="grid h-full w-full place-items-center text-[16px] font-black">{x.pack}</span>}
                    </span>
                    <b dir="auto" className="mt-1.5 block truncate text-[12.5px]">{x.top?.name ?? 'עוד אין'}</b>
                    <small className="block text-[11px] opacity-80">דבוקה {x.pack}</small>
                  </Link>
                ))}
              </div>
              <Link href={shareHref(t.date, true)} className="mt-3 flex min-h-[50px] w-full items-center justify-center rounded-full bg-white text-[15.5px] font-black text-[#4a2a9e]">
                לבחור ולשתף את 3 הדבוקות
              </Link>
            </section>
          ) : data ? (
            <Group className="mt-2"><Empty>היום אין אימון איכות או ריצה ארוכה. אפשר לשתף אימון קודם:</Empty></Group>
          ) : (
            <div className="mt-2 h-[260px] animate-pulse rounded-[22px] bg-card" />
          )}

          <SectionHead gray>אימונים קודמים</SectionHead>
          <Group>
            {(data?.past ?? []).map((d) => (
              <Link key={d.date} href={shareHref(d.date)} className="flex min-h-[58px] items-center gap-3 px-3.5 py-2.5 active:bg-page">
                <span className="w-[42px] shrink-0 text-center">
                  <b className="block text-[17px] font-black text-ink-900 tabular-nums">{Number(d.date.slice(8, 10))}</b>
                  <small className="block text-[11px] text-ink-400">{dowOf(d.date)}</small>
                </span>
                <span className="min-w-0 flex-1">
                  <b dir="auto" className="block truncate text-[14.5px] text-ink-900">{titleOf(d)}</b>
                  <small className="block text-12 text-ink-400">{titleOf(d) !== kindOf(d) && <>{kindOf(d)} · </>}<bdi dir="ltr">{d.runs}</bdi> ריצות</small>
                </span>
                <ChevronLeft className="h-[18px] w-[18px] text-[#c4c4c9]" />
              </Link>
            ))}
            {data && data.past.length === 0 && <Empty>עוד אין אימונים קודמים.</Empty>}
          </Group>
        </>
      )}
    </TypePage>
  );
}
