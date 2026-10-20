'use client';

import Link from 'next/link';
import { Plus, X } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { dayHeading, KIND_LABEL, type RunMeetup } from '@/lib/runs/meetups';
import { FaceStack, packHex } from './parts';

/**
 * What the feed row shows (Ofer, 2026-10-20): the runs the server let this member see,
 * minus the ones they hid with ✕ — their own (hosting or going) first, pinned, never
 * hideable; then the rest by date.
 */
export function feedRuns(runs: RunMeetup[]): RunMeetup[] {
  const mine = (m: RunMeetup) => m.isHost || m.joined;
  return [...runs.filter(mine), ...runs.filter((m) => !mine(m) && !m.feedHidden)];
}

/** "N ריצות השבוע" — one run reads as one. */
export function runsCountLabel(n: number): string {
  return n === 1 ? 'ריצה אחת השבוע' : `${n} ריצות השבוע`;
}

/**
 * "🏃 רצים יחד" at the top of the feed, as ONE compact row (Ofer, 2026-10-20: the card
 * strip with maps took half the screen). How many open runs, the next one in a line with
 * its faces, a tap to it, "הכל" to the board and + to post. Nothing when nobody has posted.
 */
export function RunTogetherStrip() {
  const { data, mutate } = useApi<{ meetups: RunMeetup[]; today: string }>('/api/runs/meetups');
  const runs = feedRuns(data?.meetups ?? []);
  if (!data || runs.length === 0) return null;
  const next = runs[0];
  const pinned = next.isHost || next.joined;
  const hide = async () => {
    void mutate((d) => d && { ...d, meetups: d.meetups.map((x) => (x.id === next.id ? { ...x, feedHidden: true } : x)) }, { revalidate: false });
    await fetch('/api/runs/meetups/hide', { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify({ meetupId: next.id }) }).catch(() => {});
  };
  const h = dayHeading(next.date, data.today);
  const what = [next.kind ? KIND_LABEL[next.kind] : null, next.distanceKm ? `${next.distanceKm} ק״מ` : null].filter(Boolean).join(' · ');
  return (
    <section className="mb-4 rounded-[20px] bg-card px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)]" dir="rtl">
      <div className="flex items-center justify-between">
        <b className="text-[14.5px] font-black text-ink-900">🏃 רצים יחד · <span className="font-extrabold text-ink-500">{runsCountLabel(runs.length)}</span></b>
        <span className="flex items-center">
          <Link href="/dashboard/run-together?new=1" aria-label="פרסום ריצה" className="flex h-11 w-11 items-center justify-center text-brand-600"><Plus className="h-5 w-5" /></Link>
          <Link href="/dashboard/run-together" className="-me-1 flex min-h-[44px] items-center px-1 text-[13px] font-extrabold text-brand-600">הכל ‹</Link>
        </span>
      </div>
      <Link href={`/dashboard/run-together/${next.id}`} className="flex min-h-[44px] items-center gap-2 rounded-xl bg-page px-2.5 py-1.5 active:opacity-85" style={{ borderInlineStart: `4px solid ${packHex(next.pack)}` }}>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-700">
          <b className="font-black text-ink-900">{h.title} · <bdi>{next.startTime}</bdi></b>
          {what && <> · {what}</>} · <bdi>{next.location}</bdi>
        </span>
        {pinned && <span className="shrink-0 rounded-full bg-accent-600/15 px-2 py-0.5 text-[11px] font-extrabold text-accent-900">{next.isHost ? 'שלך' : 'מגיע/ה'}</span>}
        <FaceStack people={next.going} size={22} />
        {!pinned && (
          <button type="button" aria-label="להסתיר מהפיד" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void hide(); }}
            className="-me-2 flex h-11 w-9 shrink-0 items-center justify-center text-ink-300"><X className="h-4 w-4" /></button>
        )}
      </Link>
    </section>
  );
}
