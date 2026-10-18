'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import type { BirthdayStory } from '@/lib/birthday-year/server';
import { YearStory } from './YearStory';

/**
 * The birthday person's way into their story: one card at the top of their feed for the
 * week after their birthday, and the 7:00 push lands on /feed?birthdayYear=1, which opens
 * it straight away. Nothing for anybody else, and nothing while sending is off.
 */
export function BirthdayYearCard() {
  const { data } = useApi<{ story: BirthdayStory | null }>('/api/birthday-year');
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const story = data?.story ?? null;
  useEffect(() => { if (story && params.get('birthdayYear') === '1') setOpen(true); }, [story, params]);
  if (!story) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full min-h-[64px] items-center gap-3 rounded-[22px] bg-gradient-to-l from-[#1525FF] to-[#0a1080] px-4 py-3 text-start text-white shadow-[0_10px_24px_-14px_rgba(21,37,255,.7)]">
        <span className="text-[28px]" aria-hidden>🎂</span>
        <span className="min-w-0 flex-1">
          <b className="block text-[16px] font-extrabold">מזל טוב, {story.name}!</b>
          <small className="block text-[13px] text-white/80">הכנו לך את השנה שלך בריצה · <bdi>{story.stats.km.toLocaleString('en-US')}</bdi> ק״מ</small>
        </span>
        <ChevronLeft className="h-5 w-5 shrink-0 text-white/70" />
      </button>
      {open && <YearStory story={story} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * On the club's birthday post: "צפו בשנה של <name>" — the birthday person's year, for every
 * member (Ofer, 2026-10-18: everyone sees it), from the birthday for a week while sending is
 * on. Nothing when there is no story to show.
 */
export function BirthdayYearButton({ athleteId }: { athleteId: string }) {
  const { data } = useApi<{ story: BirthdayStory | null }>(`/api/birthday-year?athleteId=${encodeURIComponent(athleteId)}`);
  const [open, setOpen] = useState(false);
  const story = data?.story ?? null;
  if (!story) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="mt-3 flex w-full min-h-[52px] items-center gap-3 rounded-2xl bg-gradient-to-l from-[#1525FF] to-[#0a1080] px-4 text-start text-white">
        <span className="text-[22px]" aria-hidden>🎂</span>
        <span className="min-w-0 flex-1">
          <b className="block text-[15px] font-extrabold">צפו בשנה של {story.name}</b>
          <small className="block text-xs text-white/80"><bdi>{story.stats.km.toLocaleString('en-US')}</bdi> ק״מ, <bdi>{story.stats.runs}</bdi> ריצות</small>
        </span>
        <ChevronLeft className="h-5 w-5 shrink-0 text-white/70" />
      </button>
      {open && <YearStory story={story} onClose={() => setOpen(false)} />}
    </>
  );
}
