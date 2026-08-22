'use client';

import { useState } from 'react';
import { Activity, Route, Clock, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { Card, SkeletonList, EmptyState, SegmentedControl } from '@/components/ui';

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
  if (min < 60) return `${min} ד'`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ש' ${m} ד'` : `${h} ש'`;
}

export function AcademyStats() {
  const [scope, setScope] = useState<'week' | 'total'>('week');
  const { data, isLoading } = useApi<{ athletes: AthleteStat[]; team: TeamStat | null }>('/api/academy/stats');

  const athletes = data?.athletes ?? [];
  const team = data?.team ?? null;

  if (isLoading && !data) return <SkeletonList count={4} />;

  const isWeek = scope === 'week';
  const teamRuns = team ? (isWeek ? team.weekRuns : team.totalRuns) : 0;
  const teamKm = team ? (isWeek ? team.weekKm : team.totalKm) : 0;
  const teamMin = team ? (isWeek ? team.weekDurationMin : team.totalDurationMin) : 0;

  const sorted = [...athletes].sort((a, b) =>
    isWeek ? b.weekKm - a.weekKm : b.totalKm - a.totalKm
  );
  const maxKm = Math.max(1, ...sorted.map(a => (isWeek ? a.weekKm : a.totalKm)));

  return (
    <div className="space-y-5" dir="rtl">
      <SegmentedControl
        value={scope}
        onChange={setScope}
        options={[
          { value: 'week', label: 'השבוע' },
          { value: 'total', label: 'סך הכול' },
        ]}
        className="max-w-xs"
      />

      {/* Team totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <TeamTile icon={Users} label="ספורטאים" value={String(team?.athletes ?? 0)} />
        <TeamTile icon={Activity} label="אימונים" value={String(teamRuns)} />
        <TeamTile icon={Route} label="קילומטרים" value={`${teamKm.toFixed(1)}`} />
        <TeamTile icon={Clock} label="זמן" value={fmtDuration(teamMin)} />
      </div>

      {/* Per-athlete */}
      {sorted.length === 0 ? (
        <EmptyState
          title="עדיין אין פעילות"
          description="הנתונים יופיעו כשספורטאי האקדמיה יסנכרנו ריצות מגרמין/סטראבה."
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((a, i) => {
            const km = isWeek ? a.weekKm : a.totalKm;
            const runs = isWeek ? a.weekRuns : a.totalRuns;
            const mins = isWeek ? a.weekDurationMin : a.totalDurationMin;
            return (
              <Card key={a.athleteId} variant="solid">
                <div className="flex items-center gap-3">
                  <div className="w-5 text-center text-xs font-bold text-slate-500 shrink-0">{i + 1}</div>
                  <div className="bg-primary-600/20 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-primary-300 shrink-0">
                    {initialsOf(a.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white text-sm truncate" dir="auto">{a.name}</div>
                    <div className="text-xs text-slate-400">{runs} אימונים · {fmtDuration(mins)}</div>
                  </div>
                  <div className="text-end shrink-0">
                    <div className="text-lg font-bold text-white tabular-nums">{km.toFixed(1)}</div>
                    <div className="text-[10px] text-slate-500 -mt-0.5">ק&quot;מ</div>
                  </div>
                </div>
                {/* km bar */}
                <div className="mt-2 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                  <div className="h-full bg-primary-500 rounded-full" style={{ width: `${(km / maxKm) * 100}%` }} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamTile({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card variant="solid">
      <div className="flex items-center gap-1.5 text-slate-400 mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
    </Card>
  );
}
