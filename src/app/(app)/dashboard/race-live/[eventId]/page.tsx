'use client';

import { use, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';
import { formatClock } from '@/lib/race-live/core';
import { viewerLine, type ViewerRunnerInput } from '@/lib/race-live/viewer';
import { boardFreshness, staleDetail, updatedLabel } from '@/lib/race-live/viewerStale';

// Live tracking viewer (web, night task 61). Reads the same board as the native app
// (GET /api/race-live/[eventId] — member-gated, race_live flag, opted-out runners absent)
// and degrades row by row: no GPS → last split; a position older than 3 min is shown
// as stale with its age instead of pretending to be live (lib/race-live/viewer.ts), with the
// last official split under it, and a board-wide "עודכן לפני X דק׳" once every position is stale (viewerStale.ts).

interface BoardRunner extends ViewerRunnerInput {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  bib: string | null;
  isSelf: boolean;
}
interface Board { enabled: boolean; runners?: BoardRunner[]; active?: boolean; updatedAt?: string | null }

export default function RaceLiveViewerPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { data, error } = useApi<Board>(`/api/race-live/${encodeURIComponent(eventId)}`, { refreshInterval: 30_000 });
  // Re-render every 15 s so "stale" flips on time even between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);

  if (error) return <p className="p-6 text-center text-ink-500">לא הצלחנו לטעון את המעקב. ננסה שוב בעוד רגע.</p>;
  if (!data) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (!data.enabled) return <p className="p-6 text-center text-ink-500">המעקב החי עוד לא פתוח.</p>;

  const runners = data.runners ?? [];
  // Nobody has posted for > 3 min: say when the board last heard from anyone (task 147).
  const fresh = boardFreshness(runners, now);
  return (
    <div dir="rtl" className="mx-auto max-w-lg space-y-3 px-4 pb-24 pt-2">
      <header className="flex items-end justify-between">
        <h1 className="text-[26px] font-black text-ink-900">מעקב חי</h1>
        {!data.active && <span className="rounded-pill bg-page px-3 py-1 text-13 font-bold text-ink-500">לא פעיל כרגע</span>}
      </header>
      {fresh.stale && fresh.ageSec != null && (
        <p className="rounded-card bg-band-3/10 px-4 py-2 text-13 font-bold text-band-3-ink" data-testid="board-stale">אין מיקומים חדשים · {updatedLabel(fresh.ageSec)}</p>
      )}
      {runners.length === 0 && <p className="rounded-card bg-card px-4 py-6 text-center text-ink-500">אין רצים במעקב.</p>}
      <ul className="overflow-hidden rounded-card bg-card">
        {runners.map((r) => {
          const line = viewerLine(r, now);
          const stale = staleDetail(r, line);
          return (
            <li key={r.athleteId} className="flex min-h-[60px] items-center gap-3 border-b border-page px-4 py-2 last:border-0" data-kind={line.kind} data-stale={line.stale ? '1' : '0'}>
              <FeedAvatar name={r.name} url={r.avatarUrl} className="h-9 w-9 text-xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-ink-900">{r.name}{r.isSelf && <span className="text-ink-400"> · את/ה</span>}</p>
                <p className={cn('text-13 tabular-nums', line.stale ? 'text-ink-400' : 'text-ink-700')}>
                  <bdi>{line.text}</bdi>
                  {stale && <span className="ms-1 font-bold text-band-3-ink">· {stale.updated}</span>}
                </p>
                {stale?.lastSplit && <p className="text-13 tabular-nums text-ink-700" data-testid="stale-split">נקודה אחרונה: <bdi>{stale.lastSplit}</bdi></p>}
              </div>
              {r.predictedSec != null && line.kind !== 'finished' && (
                <span className="text-13 font-bold text-brand tabular-nums" title="סיום צפוי"><bdi dir="ltr">{formatClock(r.predictedSec)}</bdi></span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
