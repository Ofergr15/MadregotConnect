'use client';

import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn, getActivityWeekStart } from '@/lib/utils';
import { fetchActivities } from '@/lib/activities-client';
import { SegmentedControl } from '@/components/ui';

interface Props {
  athleteId: string | null;
}

// Weekly volume (mine, last 12 weeks) + top-3 club leaderboard, side by side.
// Moved off the home page (which is hero-only now) into Feed, since both are
// "how's everyone doing" social content rather than "what do I do today".
// Self-contained — resolves its own data from `athleteId`, same shape as
// SquadStandings just below it.
export function WeeklyLeaderboardCard({ athleteId }: Props) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const [weeklyKm, setWeeklyKm] = useState(0);
  const [runnerWeeklyVolumes, setRunnerWeeklyVolumes] = useState<Array<{ week: string; km: number; runs: number }>>([]);
  const [weekTarget, setWeekTarget] = useState<{ min: number; max: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<Array<{ id: string; name: string; groupId: string; distanceKm: number; runs: number }>>([]);
  const [leaderboardFilter, setLeaderboardFilter] = useState<'all' | string>('all');
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!athleteId) return;
    (async () => {
      try {
        const [actRes, lbRes, grpRes, weeklyRes] = await Promise.all([
          fetchActivities(),
          fetch('/api/groups/leaderboard'),
          fetch('/api/groups'),
          fetch('/api/dashboard/weekly'),
        ]);

        if (weeklyRes.ok) {
          const w = await weeklyRes.json();
          if (w?.weekTotalMax > 0) setWeekTarget({ min: Math.round(w.weekTotalMin), max: Math.round(w.weekTotalMax) });
        }

        if (actRes.ok) {
          const actData = await actRes.json();
          const filtered = (actData.activities || []).filter((a: any) => a.athlete_id === athleteId);

          const weekStart = new Date(getActivityWeekStart(new Date()));
          const thisWeekActs = filtered.filter((a: any) => new Date(a.start_time) >= weekStart);
          setWeeklyKm(Math.round((thisWeekActs.reduce((s: number, a: any) => s + (a.distance || 0), 0) / 1000) * 10) / 10);

          const weekMap: Record<string, { km: number; runs: number }> = {};
          filtered.forEach((a: any) => {
            const key = getActivityWeekStart(new Date(a.start_time)).split('-').reverse().slice(0, 2).join('/'); // DD/MM of the week-start Sunday
            if (!weekMap[key]) weekMap[key] = { km: 0, runs: 0 };
            weekMap[key].km += (a.distance || 0) / 1000;
            weekMap[key].runs += 1;
          });
          const sortedWeeks = Object.entries(weekMap)
            .map(([week, data]) => ({ week, km: Math.round(data.km * 10) / 10, runs: data.runs }))
            .sort((a, b) => {
              const [dA, mA] = a.week.split('/').map(Number);
              const [dB, mB] = b.week.split('/').map(Number);
              return mA !== mB ? mA - mB : dA - dB;
            })
            .slice(-12);
          setRunnerWeeklyVolumes(sortedWeeks);
        }

        if (lbRes.ok) setLeaderboard((await lbRes.json()).leaderboard || []);
        if (grpRes.ok) {
          const grpData = await grpRes.json();
          setGroups(grpData.groups || grpData || []);
        }
      } catch { /* best-effort — section just hides if nothing loads */ }
    })();
  }, [athleteId]);

  if (runnerWeeklyVolumes.length <= 1 && leaderboard.length === 0) return null;

  const maxKm = Math.max(...runnerWeeklyVolumes.map(w => w.km), 1);
  const lastWeek = runnerWeeklyVolumes[runnerWeeklyVolumes.length - 1];
  const prevWeek = runnerWeeklyVolumes[runnerWeeklyVolumes.length - 2];
  const trend = prevWeek && prevWeek.km > 0 && lastWeek ? Math.round(((lastWeek.km - prevWeek.km) / prevWeek.km) * 100) : 0;
  const filtered = leaderboardFilter === 'all' ? leaderboard : leaderboard.filter(a => a.groupId === leaderboardFilter);
  const top3 = filtered.slice(0, 3);
  const myRank = filtered.findIndex(a => a.id === athleteId) + 1;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
      {/* LEFT: Weekly Volume */}
      {runnerWeeklyVolumes.length > 1 && (
        <section className="bg-slate-800/30 rounded-2xl border border-slate-700/20 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white tabular-nums">{weeklyKm}</span>
              <span className="text-xs text-slate-500">{tc('km')} {t('thisWeek')}</span>
            </div>
            <div className="flex items-center gap-2">
              {weekTarget && (
                <span className="text-xs font-semibold text-slate-300">Goal: {weekTarget.min}–{weekTarget.max} {tc('km')}</span>
              )}
              {trend !== 0 && (
                <span className={cn('text-3xs font-bold px-1.5 py-0.5 rounded-md', trend > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400')}>
                  {trend > 0 ? '+' : ''}{trend}%
                </span>
              )}
            </div>
          </div>
          {weekTarget && (
            <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden mb-4">
              <div
                className={cn('h-full rounded-full transition-all', weeklyKm >= weekTarget.min ? 'bg-emerald-400' : 'bg-[#fc5200]')}
                style={{ width: `${Math.min(100, (weeklyKm / weekTarget.max) * 100)}%` }}
              />
            </div>
          )}
          <div className="flex items-end justify-center gap-[6px]" style={{ height: '100px' }}>
            {runnerWeeklyVolumes.map((w, i) => {
              const isLast = i === runnerWeeklyVolumes.length - 1;
              const barH = maxKm > 0 ? Math.max(10, Math.round((w.km / maxKm) * 65)) : 10;
              return (
                <div key={i} className="flex flex-col items-center justify-end" style={{ height: '100px', width: '28px' }}>
                  <span className={cn('text-3xs font-bold mb-1 tabular-nums', isLast ? 'text-[#fc5200]' : 'text-white/70')}>{w.km}</span>
                  <div
                    className={cn('rounded-full', isLast ? 'bg-[#fc5200]' : 'bg-slate-600')}
                    style={{ height: `${barH}px`, width: '12px' }}
                  />
                  <span className={cn('text-3xs mt-1', isLast ? 'text-white' : 'text-slate-400')}>{w.week}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* RIGHT: Leaderboard */}
      {leaderboard.length > 0 && (
        <section className="bg-slate-800/30 rounded-2xl border border-slate-700/20 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-yellow-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Top 3</span>
            </div>
            {groups.length > 1 && (
              <SegmentedControl
                value={leaderboardFilter}
                onChange={setLeaderboardFilter}
                options={[
                  { value: 'all', label: 'All' },
                  ...groups.map(g => ({ value: g.id, label: g.name.replace('Group ', '').replace(' - SUB ', ' ') })),
                ]}
              />
            )}
          </div>
          <div className="flex items-end justify-center gap-5 px-2" style={{ height: '100px' }}>
            {top3.length >= 2 && (
              <div className="flex flex-col items-center" style={{ width: '56px' }}>
                <span className="text-2xs font-bold text-slate-300 mb-1 tabular-nums">{top3[1].distanceKm}</span>
                <div className="w-6 rounded-t bg-slate-400/80" style={{ height: '50px' }} />
                <span className="text-2xs text-slate-300 mt-1.5 font-medium whitespace-nowrap">{top3[1].name.split(' ')[0]}</span>
              </div>
            )}
            {top3.length >= 1 && (
              <div className="flex flex-col items-center" style={{ width: '56px' }}>
                <span className="text-sm mb-0.5">👑</span>
                <span className="text-xs font-black text-yellow-400 mb-1 tabular-nums">{top3[0].distanceKm}</span>
                <div className="w-6 rounded-t bg-yellow-500" style={{ height: '70px' }} />
                <span className="text-2xs text-white font-bold mt-1.5 whitespace-nowrap">{top3[0].name.split(' ')[0]}</span>
              </div>
            )}
            {top3.length >= 3 && (
              <div className="flex flex-col items-center" style={{ width: '56px' }}>
                <span className="text-2xs font-bold text-amber-500 mb-1 tabular-nums">{top3[2].distanceKm}</span>
                <div className="w-6 rounded-t bg-amber-600/80" style={{ height: '35px' }} />
                <span className="text-2xs text-slate-300 mt-1.5 font-medium whitespace-nowrap">{top3[2].name.split(' ')[0]}</span>
              </div>
            )}
          </div>
          {myRank > 3 && <p className="text-3xs text-slate-500 text-center mt-2">You: #{myRank}</p>}
        </section>
      )}
    </div>
  );
}
