'use client';

import { useState } from 'react';
import { Trophy, Medal, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/academy/benchmark';
import { useApi } from '@/lib/api';
import { useTranslations } from 'next-intl';

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
  { ring: 'ring-band-3/40', text: 'text-band-3-ink', bg: 'bg-band-3/10' },
  { ring: 'ring-page/40', text: 'text-ink-700', bg: 'bg-ink-300/10' },
  { ring: 'ring-band-3/40', text: 'text-band-3-ink', bg: 'bg-band-3/10' },
];

function initialsOf(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

export function BenchmarkLeaderboard() {
  const t = useTranslations('academy');
  const [test, setTest] = useState('');
  const [expanded, setExpanded] = useState(false);
  const { data } = useApi<{ results: Result[]; tests: string[] }>('/api/academy/benchmarks');

  const results = data?.results ?? [];
  const tests = data?.tests ?? [];
  // Selected test defaults to the first available; user selection wins once it's valid.
  const activeTest = tests.includes(test) ? test : tests[0] || '';

  // Hide entirely when there's nothing to show (keeps the Races page clean).
  if (!data || results.length === 0) return null;

  const shown = results.filter(r => r.test_name === activeTest);
  const top3 = shown.slice(0, 3);
  const rest = shown.slice(3);

  return (
    <div className="border-b border-page bg-page/30 px-6 py-5">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-band-3" />
            <h2 className="text-base font-semibold text-ink-700">{t('benchmarkTitle', { test: activeTest })}</h2>
          </div>
          {tests.length > 1 && (
            <select
              value={activeTest}
              onChange={e => { setTest(e.target.value); setExpanded(false); }}
              className="bg-card border border-page rounded-lg px-3 h-8 text-xs text-ink-700"
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
                <div className="bg-card w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-ink-700">
                  {initialsOf(r.athlete_name)}
                </div>
                <Medal className={cn('h-5 w-5 absolute -bottom-1 -end-1', podium[i].text)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn('text-[10px] font-bold uppercase tracking-wider', podium[i].text)}>#{r.rank}</div>
                <div className="text-sm font-semibold text-ink-700 truncate" dir="auto">{r.athlete_name}</div>
              </div>
              <div className="text-lg font-black text-ink-700 tabular-nums shrink-0">{formatTime(r.time_seconds)}</div>
            </div>
          ))}
        </div>

        {/* Full board (collapsible) */}
        {rest.length > 0 && (
          <>
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {expanded ? t('benchmarkHideBoard') : t('benchmarkShowAll', { count: shown.length })}
            </button>
            {expanded && (
              <div className="mt-3 space-y-1">
                {rest.map(r => (
                  <div key={r.id} className="flex items-center gap-3 bg-card/40 rounded-lg px-3 py-2">
                    <span className="w-6 text-center text-xs font-bold text-ink-400 shrink-0">{r.rank}</span>
                    <span className="flex-1 min-w-0 text-sm text-ink-700 truncate" dir="auto">{r.athlete_name}</span>
                    <span className="text-sm font-semibold text-ink-700 tabular-nums shrink-0">{formatTime(r.time_seconds)}</span>
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
