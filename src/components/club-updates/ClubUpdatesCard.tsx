'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { FeedAvatar } from '@/components/FeedAvatar';
import { agoHe, feedState, plainText, POLL_MS } from '@/lib/club-updates/model';
import type { StreamResponse } from './api';
import { clock } from './format';
import './club-updates.css';

// ═════════════════════════════════════════════════════════════════════════════
// "עדכונים מהמועדון" in the feed (mockup full-mockup.html, screens 1–2): one card, under
// the celebrations. Full while the newest update is under an hour old, one line until it
// is a day old, and nothing at all otherwise — nor while nothing was ever posted.
// ═════════════════════════════════════════════════════════════════════════════

export function ClubUpdatesCard() {
  const { data } = useApi<StreamResponse>('/api/club-updates?feed=1', { refreshInterval: POLL_MS * 3 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const items = data?.updates ?? [];
  const state = feedState(items[0]?.createdAt, now);
  if (!data?.enabled && !data?.admin) return null;
  if (state === 'hidden') return null;

  if (state === 'quiet') {
    const u = items[0];
    return (
      <Link href="/updates" className="cu mb-4 flex min-h-[64px] items-center gap-3 rounded-[22px] bg-card px-3.5 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <span className="cu-badge !h-10 !w-10 !rounded-[13px]" aria-hidden />
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px] font-extrabold text-ink-900">עדכונים מהמועדון</b>
          <small className="block truncate text-[12px] text-ink-400">{agoHe(u.createdAt, now)} · {plainText(u.body)}</small>
        </span>
        <ChevronLeft className="h-5 w-5 shrink-0 text-brand-600" />
      </Link>
    );
  }

  const writers = [...new Map(items.map((u) => [u.author.id, u.author])).values()].slice(0, 3);
  const firstNames = writers.map((w) => w.name.split(/\s+/)[0]);
  return (
    <section className="cu cu-card mb-4" dir="rtl" aria-label="עדכונים מהמועדון">
      <span className="cu-stairs" aria-hidden />
      <div className="relative flex items-center gap-2">
        <b className="text-[16px] font-black text-ink-900">עדכונים מהמועדון</b>
        <span className="cu-live-pill ms-auto"><span className="cu-dot" />חי</span>
      </div>
      <Link href="/updates" className="cu-tl relative mt-2 block">
        {items.map((u) => (
          <div key={u.id} className={`cu-it${u.breaking ? ' br' : ''}`}>
            <time className="text-[11px] font-extrabold text-brand-600" dir="ltr">{clock(u.createdAt)}</time>
            <p className="mt-px line-clamp-3 text-[14px] font-medium leading-[1.45] text-ink-700" dir="auto">
              {u.breaking && <span className="cu-flash">מבזק</span>}
              {plainText(u.body)}
            </p>
          </div>
        ))}
      </Link>
      <div className="relative mt-1 flex items-center justify-between border-t border-[#F0F0F3] pt-2.5">
        <span className="cu-writers flex items-center gap-1.5 text-[11.5px] text-ink-400">
          <span className="cu-avs">{writers.map((w) => <FeedAvatar key={w.id} name={w.name} url={w.avatarUrl} className="h-[22px] w-[22px] text-[8px]" />)}</span>
          {/* Roster names are Latin, so no Hebrew ו glued to one. */}
          <span>מעדכנים: <bdi>{firstNames.join(', ')}</bdi></span>
        </span>
        <Link href="/updates" className="flex min-h-[44px] items-center rounded-pill bg-[#EEF0FF] px-3.5 text-[12.5px] font-extrabold text-brand-600">לכל העדכונים ›</Link>
      </div>
    </section>
  );
}
