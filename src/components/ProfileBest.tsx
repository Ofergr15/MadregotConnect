'use client';

import { useState, useEffect } from 'react';
import { Trophy, Medal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/academy/benchmark';

interface Result {
  id: string;
  test_name: string;
  athlete_name: string;
  time_seconds: number;
  notes: string | null;
  rank: number;
}

const medalColor = (rank: number) =>
  rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-slate-300' : rank === 3 ? 'text-orange-400' : 'text-slate-500';

/**
 * Personal-best card for the profile page. Fetches the viewing athlete's benchmark
 * results by athlete_id (preferred) and falls back to name match, so results
 * imported before the athlete registered still show once names line up.
 */
export function ProfileBest({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Try by athlete_id first; if empty, try by name (imported/unlinked results).
        let data: any = null;
        if (athleteId) {
          const r = await fetch(`/api/academy/benchmarks?athleteId=${athleteId}`);
          data = await r.json();
        }
        if ((!data || !data.results?.length) && athleteName) {
          const r = await fetch(`/api/academy/benchmarks?name=${encodeURIComponent(athleteName)}`);
          data = await r.json();
        }
        setResults(data?.results || []);
      } catch {
        /* optional section */
      } finally {
        setLoading(false);
      }
    })();
  }, [athleteId, athleteName]);

  // Hide entirely if the athlete has no results.
  if (loading || results.length === 0) return null;

  return (
    <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-4 w-4 text-yellow-400" />
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Your Best</h2>
      </div>
      <div className="space-y-2">
        {results.map(r => (
          <div key={r.id} className="flex items-center gap-3 bg-slate-900/50 rounded-xl p-3">
            <div className="shrink-0 flex items-center gap-1.5">
              {r.rank <= 3
                ? <Medal className={cn('h-5 w-5', medalColor(r.rank))} />
                : <span className="text-sm font-bold text-slate-500 w-5 text-center">{r.rank}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">{r.test_name}</div>
              <div className="text-xs text-slate-400">Rank #{r.rank}{r.notes ? ` · ${r.notes}` : ''}</div>
            </div>
            <div className="text-lg font-black text-white tabular-nums shrink-0">{formatTime(r.time_seconds)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
