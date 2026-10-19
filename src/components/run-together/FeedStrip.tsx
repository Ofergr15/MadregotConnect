'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useApi } from '@/lib/api';
import { dayHeading, KIND_LABEL, type RunMeetup } from '@/lib/runs/meetups';
import { FaceStack, PackChip, StaticMap, packHex } from './parts';

/**
 * "🏃 רצים יחד השבוע" at the top of the feed (mockup screen 5): the open runs, the door
 * to the board, and an invitation to post. Nothing at all when nobody has posted.
 */
export function RunTogetherStrip() {
  const { data } = useApi<{ meetups: RunMeetup[]; today: string }>('/api/runs/meetups');
  const runs = (data?.meetups ?? []).slice(0, 8);
  if (!data || runs.length === 0) return null;
  return (
    <section className="mb-4 rounded-[24px] bg-card py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]" dir="rtl">
      <div className="flex items-center justify-between px-4 pb-2.5">
        <b className="text-[15.5px] font-black text-ink-900">🏃 רצים יחד השבוע</b>
        <Link href="/dashboard/run-together" className="-me-2 flex min-h-[44px] items-center px-2 text-[13px] font-extrabold text-brand-600">הכל ‹</Link>
      </div>
      <div className="flex gap-2.5 overflow-x-auto px-3 pb-1">
        {runs.map((m) => (
          <Link key={m.id} href={`/dashboard/run-together/${m.id}`} className="w-[156px] shrink-0 rounded-[18px] bg-page p-1.5 pb-2.5 active:opacity-85" style={{ borderTop: `4px solid ${packHex(m.pack)}` }}>
            {m.lat != null && m.lng != null
              ? <StaticMap lat={m.lat} lng={m.lng} color={packHex(m.pack)} className="h-[76px] w-full rounded-[13px]" />
              : <div className="h-[76px] rounded-[13px] bg-card" />}
            <b className="mt-1.5 block px-1 text-[14.5px] font-black text-ink-900">{dayHeading(m.date, data.today).title} · <bdi>{m.startTime}</bdi></b>
            <small className="block truncate px-1 text-[11.5px] font-bold text-ink-500">{[m.kind ? KIND_LABEL[m.kind] : null, m.distanceKm ? `${m.distanceKm}` : null].filter(Boolean).join(' ')} · <bdi>{m.location}</bdi></small>
            <span className="mt-1.5 flex items-center justify-between px-1"><FaceStack people={m.going} size={22} /><PackChip pack={m.pack} small /></span>
          </Link>
        ))}
      </div>
      <Link href="/dashboard/run-together?new=1" className="mx-3 mt-2.5 flex h-12 items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-dashed border-brand-600/30 text-[13.5px] font-extrabold text-brand-600">
        <Plus className="h-[18px] w-[18px]" />יוצא/ת לרוץ? פרסם/י, ואולי מישהו יצטרף
      </Link>
    </section>
  );
}
