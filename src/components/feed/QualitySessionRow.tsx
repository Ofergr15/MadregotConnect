'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { useIsSuperUser, isPreviewing } from '@/lib/impersonation';
import { readClock } from '@/lib/quality-session/clock';
import { inRowWindow, type QsClock, type QsSession } from '@/lib/quality-session/model';

// THE QUALITY SESSION, AT THE TOP OF THE FEED — 07:00 → 11:00 ON A QUALITY DAY.
// One small row, nothing else: it only says the morning's session is there to
// share, and the tap opens /dashboard/quality-session. A quality day is read off
// the uploaded plan (lib/quality-session/server.ts), not the club's team days.
// The super user's alone while it is tried out; outside the window, or on any
// other day, it renders nothing, inside the feed's `empty:mb-0` wrapper.
export function QualitySessionRow() {
  const isSuper = useIsSuperUser();
  const [clock, setClock] = useState<QsClock | null>(null);
  useEffect(() => { setClock(readClock()); }, []);

  const on = isSuper && !isPreviewing() && !!clock && inRowWindow(clock.minutes);
  const { data } = useApi<QsSession>(on ? `/api/quality-session?date=${clock!.date}` : null);
  if (!on || !data?.workout) return null;

  return (
    <Link
      href={`/dashboard/quality-session?date=${clock!.date}`}
      dir="rtl"
      className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm active:bg-ink-50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF1E8] text-lg" aria-hidden>📸</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold text-ink-900">אימון האיכות של הבוקר</span>
        <span className="block truncate text-[12.5px] text-ink-500">לבחור רץ מכל דבוקה ולשתף</span>
      </span>
      <ChevronLeft className="h-5 w-5 shrink-0 text-ink-400" aria-hidden />
    </Link>
  );
}
