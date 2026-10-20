'use client';

import Link from 'next/link';
import { shortDay } from '@/lib/content/hub';
import { Empty, Group, PlusButton, SectionHead, TypePage } from '@/components/content/hub-ui';
import { useLive } from '@/components/content/use-hub';

// ═════════════════════════════════════════════════════════════════════════════
// תוכן › עיגול מדרגות (mockup content-v4, the same template): the club's messages
// in the first circle at the top of the feed — on now, coming, and past. A circle
// message has no likes (it is not a feed post), so its rows carry only its dates.
// Changing one happens where it always did (חגיגות).
// ═════════════════════════════════════════════════════════════════════════════

export default function ContentCirclePage() {
  const { data: live } = useLive();
  const today = live?.today ?? '';
  const club = (live?.items ?? []).filter((r) => r.source === 'club');
  const now = club.filter((r) => r.active);
  const next = club.filter((r) => !r.active && r.day > today);
  const past = club.filter((r) => !r.active && r.until < today);
  const row = (r: (typeof club)[number], when: string) => (
    <Link key={r.id} href="/dashboard/content/celebrations" className="flex min-h-[56px] items-center gap-3 px-3.5 py-2.5 active:bg-page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/logo.png" alt="" className="h-10 w-10 shrink-0 rounded-full bg-white object-contain p-0.5 ring-[2.5px] ring-ink-900" />
      <span className="min-w-0 flex-1">
        <b dir="auto" className="block truncate text-[15px] font-semibold text-ink-900">{r.title}</b>
        <small className="block text-13 text-ink-400">{when}</small>
      </span>
    </Link>
  );
  const range = (r: (typeof club)[number]) => (r.day === r.until ? shortDay(r.day) : `${shortDay(r.day)}–${shortDay(r.until)}`);
  return (
    <TypePage type="circle" action={<PlusButton label="לעיגול" href="/dashboard/content/publish?type=message&place=circle" />}>
      <SectionHead>באוויר</SectionHead>
      <Group>{!live ? <Empty>טוען…</Empty> : now.length === 0 ? <Empty>כרגע אין הודעה בעיגול. ״＋ לעיגול״ למעלה.</Empty> : now.map((r) => row(r, `עד ${r.until === today ? 'היום' : shortDay(r.until)}`))}</Group>
      {next.length > 0 && (<><SectionHead>מתוזמן</SectionHead><Group>{next.map((r) => row(r, range(r)))}</Group></>)}
      {past.length > 0 && (<><SectionHead gray>היה בעיגול</SectionHead><Group>{past.slice(0, 8).map((r) => row(r, range(r)))}</Group></>)}
    </TypePage>
  );
}
