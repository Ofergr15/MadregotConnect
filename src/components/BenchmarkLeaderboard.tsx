'use client';

import { useState, useEffect, useCallback } from 'react';
import { Trophy, Medal, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/academy/benchmark';

interface Result {
  id: string;
  test_name: string;
  athlete_name: string;
  athlete_id: string | null;
  time_seconds: number;
  notes: string | null;
  rank: number;
}

const podium = [
  { ring: 'ring-yellow-400/40', text: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  { ring: 'ring-slate-300/40', text: 'text-slate-200', bg: 'bg-slate-400/10' },
  { ring: 'ring-orange-400/40', text: 'text-orange-400', bg: 'bg-orange-400/10' },
];

function initialsOf(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

export function BenchmarkLeaderboard() {
  const [results, setResults] = useState<Result[]>([]);
  const [tests, setTests] = useState<string[]>([]);
  const [test, setTest] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch('/api/academy/benchmarks');
      const data = await res.json();
      setResults(data.results || []);
      const t: string[] = data.tests || [];
      setTests(t);
      setTest(prev => (t.includes(prev) ? prev : t[0] || ''));
    } catch {
      /* leaderboard is optional */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  // Hide entirely when there's nothing to show (keeps the Races page clean).
  if (loading || results.length === 0) return null;

  const shown = results.filter(r => r.test_name === test);
  const top3 = shown.slice(0, 3);
  const rest = shown.slice(3);

  return (
    <div className="border-b border-slate-700 bg-slate-900/30 px-6 py-5">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-400" />
            <h2 className="text-base font-semibold text-white">Time Trial · {test}</h2>
          </div>
          {tests.length > 1 && (
            <select
              value={test}
              onChange={e => { setTest(e.target.value); setExpanded(false); }}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 h-8 text-xs text-white"
            >
              {tests.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>

        {/* Podium top-3 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {top3.map((r, i) => (
            <div key={r.id} className={cn('rounded-2xl p-4 ring-1 flex items-center gap-3', podium[i].ring, podium[i].bg)}>
              <div className="relative shrink-0">
                <div className="bg-slate-800 w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white">
                  {initialsOf(r.athlete_name)}
                </div>
                <Medal className={cn('h-5 w-5 absolute -bottom-1 -end-1', podium[i].text)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn('text-[10px] font-bold uppercase tracking-wider', podium[i].text)}>#{r.rank}</div>
                <div className="text-sm font-semibold text-white truncate" dir="auto">{r.athlete_name}</div>
              </div>
              <div className="text-lg font-black text-white tabular-nums shrink-0">{formatTime(r.time_seconds)}</div>
            </div>
          ))}
        </div>

        {/* Full board (collapsible) */}
        {rest.length > 0 && (
          <>
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {expanded ? 'Hide full board' : `Show all ${shown.length}`}
            </button>
            {expanded && (
              <div className="mt-3 space-y-1">
                {rest.map(r => (
                  <div key={r.id} className="flex items-center gap-3 bg-slate-800/40 rounded-lg px-3 py-2">
                    <span className="w-6 text-center text-xs font-bold text-slate-500 shrink-0">{r.rank}</span>
                    <span className="flex-1 min-w-0 text-sm text-white truncate" dir="auto">{r.athlete_name}</span>
                    <span className="text-sm font-semibold text-slate-200 tabular-nums shrink-0">{formatTime(r.time_seconds)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
