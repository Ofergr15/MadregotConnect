'use client';

import { useState, useEffect } from 'react';
import { Loader2, Activity, Route, Clock, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AthleteStat {
  athleteId: string;
  name: string;
  weekKm: number;
  weekRuns: number;
  weekDurationMin: number;
  totalKm: number;
  totalRuns: number;
  totalDurationMin: number;
}
interface TeamStat {
  athletes: number;
  weekKm: number; weekRuns: number; weekDurationMin: number;
  totalKm: number; totalRuns: number; totalDurationMin: number;
}

function initialsOf(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}
function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function AcademyStats() {
  const [athletes, setAthletes] = useState<AthleteStat[]>([]);
  const [team, setTeam] = useState<TeamStat | null>(null);
  const [scope, setScope] = useState<'week' | 'total'>('week');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/academy/stats');
        const data = await res.json();
        setAthletes(data.athletes || []);
        setTeam(data.team || null);
      } catch (err) {
        console.error('Failed to fetch academy stats:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-7 w-7 text-primary-500 animate-spin" /></div>;
  }

  const isWeek = scope === 'week';
  const teamRuns = team ? (isWeek ? team.weekRuns : team.totalRuns) : 0;
  const teamKm = team ? (isWeek ? team.weekKm : team.totalKm) : 0;
  const teamMin = team ? (isWeek ? team.weekDurationMin : team.totalDurationMin) : 0;

  const sorted = [...athletes].sort((a, b) =>
    isWeek ? b.weekKm - a.weekKm : b.totalKm - a.totalKm
  );
  const maxKm = Math.max(1, ...sorted.map(a => (isWeek ? a.weekKm : a.totalKm)));

  return (
    <div className="space-y-5">
      {/* Scope toggle */}
      <div className="flex items-center gap-1 bg-slate-800/50 border border-slate-700/50 rounded-xl p-1 w-fit">
        {(['week', 'total'] as const).map(s => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={cn(
              'px-4 h-9 rounded-lg text-sm font-semibold transition-colors',
              scope === s ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'
            )}
          >
            {s === 'week' ? 'This week' : 'All-time'}
          </button>
        ))}
      </div>

      {/* Team totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <TeamTile icon={Users} label="Athletes" value={String(team?.athletes ?? 0)} />
        <TeamTile icon={Activity} label="Workouts" value={String(teamRuns)} />
        <TeamTile icon={Route} label="Kilometers" value={`${teamKm.toFixed(1)}`} />
        <TeamTile icon={Clock} label="Time" value={fmtDuration(teamMin)} />
      </div>

      {/* Per-athlete */}
      {sorted.length === 0 ? (
        <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl p-10 text-center">
          <p className="text-slate-300 font-medium">No activity yet</p>
          <p className="text-sm text-slate-500 mt-1">
            Stats appear once academy athletes sync runs from Garmin/Strava.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((a, i) => {
            const km = isWeek ? a.weekKm : a.totalKm;
            const runs = isWeek ? a.weekRuns : a.totalRuns;
            const mins = isWeek ? a.weekDurationMin : a.totalDurationMin;
            return (
              <div key={a.athleteId} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-5 text-center text-xs font-bold text-slate-500 shrink-0">{i + 1}</div>
                  <div className="bg-primary-600/20 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-primary-300 shrink-0">
                    {initialsOf(a.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white text-sm truncate">{a.name}</div>
                    <div className="text-xs text-slate-400">{runs} workout{runs !== 1 ? 's' : ''} · {fmtDuration(mins)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-bold text-white tabular-nums">{km.toFixed(1)}</div>
                    <div className="text-[10px] text-slate-500 -mt-0.5">km</div>
                  </div>
                </div>
                {/* km bar */}
                <div className="mt-2 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                  <div className="h-full bg-primary-500 rounded-full" style={{ width: `${(km / maxKm) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamTile({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
      <div className="flex items-center gap-1.5 text-slate-400 mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
    </div>
  );
}
