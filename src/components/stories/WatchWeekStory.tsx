'use client';

import dynamic from 'next/dynamic';
import { useApi } from '@/lib/api';
import { Spinner } from '@/components/ui';
import type { WeekStory as Story } from '@/lib/week-story/server';

// The week story itself, opened right here on the stories admin screens — not by sending
// the admin to /feed: the operator account has no member feed and /feed sends it home
// (feed/page.tsx), so a "watch it" link to the feed never opened anything for "MA"
// (Ofer, 2026-10-23: "I don't see it"). The server reads anyone's week for an admin, as of
// the coming Saturday (`at`), any day of the week.
const WeekStory = dynamic(() => import('@/components/week-story/WeekStory').then((m) => m.WeekStory), { ssr: false });

export function WatchWeekStory({ athleteId, at, onClose }: { athleteId: string; at: string; onClose: () => void }) {
  const { data, error } = useApi<{ story: Story | null }>(`/api/week-story?at=${at}&athleteId=${encodeURIComponent(athleteId)}`);
  if (data?.story) return <WeekStory story={data.story} onClose={onClose} />;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[400] grid place-items-center bg-[#060a52]/95 px-8 text-center text-white" dir="rtl" onClick={onClose}>
      {!data && !error ? <Spinner /> : (
        <div>
          <p className="text-[17px] font-extrabold">{error ? 'לא הצלחנו לטעון את הסטורי' : 'אין סטורי לשבוע הזה'}</p>
          <p className="mt-1 text-sm text-white/75">{error ? 'אפשר לנסות שוב בעוד רגע' : 'הסטורי נבנה רק למי שרץ השבוע'}</p>
          <button type="button" onClick={onClose} className="mt-5 min-h-[44px] rounded-full bg-white px-6 text-[15px] font-extrabold text-ink-900">סגירה</button>
        </div>
      )}
    </div>
  );
}
