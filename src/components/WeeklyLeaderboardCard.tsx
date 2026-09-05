'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn, getActivityWeekStart, activityWeekStart, israelDateAnchor } from '@/lib/utils';
import { fetchActivities } from '@/lib/activities-client';
import { SegmentedControl } from '@/components/ui';
import { apiHeaders, useApi } from '@/lib/api';

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
  // Group names for the leaderboard filter chips. Same SWR key the Header uses
  // on every screen, so this reads the cache instead of re-running a 4KB
  // groups+athletes join for three labels.
  const { data: groupsData } = useApi<{ groups?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>(
    athleteId ? '/api/groups' : null,
  );
  const groups = Array.isArray(groupsData) ? groupsData : (groupsData?.groups || []);

  useEffect(() => {
    if (!athleteId) return;
    (async () => {
      try {
        // Both the leaderboard and the weekly plan are session-gated now, so
        // resolve the bearer header once and reuse it for the pair.
        const headers = await apiHeaders();
        // `selfOnly`: despite the name, the activities here are only ever used
        // for MY numbers — this week's km and the 12-week volume bars. The
        // club-wide half of this card is /api/groups/leaderboard, which is
        // aggregated server-side. Without it, staff are handed the club's newest
        // 200 rows and `filtered` below keeps whichever of mine happen to be in
        // there — so a coach who also runs saw a truncated volume chart (and a
        // wrong "this week") on a busy week, plus every other athlete's splits
        // and laps JSONB downloaded to throw away.
        // `volumeOnly` + `sinceDays`: this card reads exactly three fields off an
        // activity — athlete_id, start_time, distance — and only ever looks back
        // twelve weeks, because that's how many bars it draws. Asking for the
        // default shape instead was 113 KB over 5.2 s (138 rows × 32 columns,
        // `laps` JSONB included) to produce thirteen numbers, and it was the
        // single slowest request on the feed. Neither parameter widens anything:
        // one drops columns, the other drops rows.
        //
        // Thirteen weeks, not twelve: the oldest bar's week has to arrive whole or
        // it renders as a short bar and reads as a bad week rather than a partial
        // one.
        const [actRes, lbRes, weeklyRes] = await Promise.all([
          fetchActivities({ selfOnly: true, volumeOnly: true, sinceDays: 13 * 7 }),
          fetch('/api/groups/leaderboard', { headers }),
          fetch('/api/dashboard/weekly', { headers }),
        ]);

        if (weeklyRes.ok) {
          const w = await weeklyRes.json();
          if (w?.weekTotalMax > 0) setWeekTarget({ min: Math.round(w.weekTotalMin), max: Math.round(w.weekTotalMax) });
        }

        if (actRes.ok) {
          const actData = await actRes.json();
          const filtered = (actData.activities || []).filter((a: any) => a.athlete_id === athleteId);

          const weekStart = new Date(getActivityWeekStart(israelDateAnchor()));
          const thisWeekActs = filtered.filter((a: any) => new Date(a.start_time) >= weekStart);
          setWeeklyKm(Math.round((thisWeekActs.reduce((s: number, a: any) => s + (a.distance || 0), 0) / 1000) * 10) / 10);

          // Keyed by the week-start Sunday as ISO (YYYY-MM-DD), which sorts
          // correctly as a plain string, and only turned into a DD/MM label at
          // the end. The previous version keyed by DD/MM and sorted on month then
          // day, so it had no year: across New Year the January weeks sorted
          // ahead of December's and the bars came out in the wrong order — and
          // now that the window is thirteen weeks, that wrong order also picks
          // the wrong twelve to keep.
          const weekMap: Record<string, { km: number; runs: number }> = {};
          filtered.forEach((a: any) => {
            // activityWeekStart, not getActivityWeekStart: start_time is the
            // athlete's wall-clock read as UTC, so local getters here shift it +3h
            // in an Israel browser and a 21:30 Saturday run jumps into next week.
            const key = activityWeekStart(a.start_time);
            if (!weekMap[key]) weekMap[key] = { km: 0, runs: 0 };
            weekMap[key].km += (a.distance || 0) / 1000;
            weekMap[key].runs += 1;
          });
          const sortedWeeks = Object.entries(weekMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-12)
            .map(([iso, data]) => ({
              week: iso.split('-').reverse().slice(0, 2).join('/'), // DD/MM
              km: Math.round(data.km * 10) / 10,
              runs: data.runs,
            }));
          setRunnerWeeklyVolumes(sortedWeeks);
        }

        if (lbRes.ok) setLeaderboard((await lbRes.json()).leaderboard || []);
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
        <section className="bg-card rounded-card border border-page p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-ink-700 tabular-nums">{weeklyKm}</span>
              <span className="text-xs text-ink-400">{tc('km')} {t('thisWeek')}</span>
            </div>
            <div className="flex items-center gap-2">
              {weekTarget && (
                <span className="text-xs font-semibold text-ink-500">Goal: {weekTarget.min}–{weekTarget.max} {tc('km')}</span>
              )}
              {trend !== 0 && (
                <span className={cn('text-3xs font-bold px-1.5 py-0.5 rounded-md', trend > 0 ? 'bg-accent-600/10 text-accent-900' : 'bg-band-3/10 text-band-3-ink')}>
                  {trend > 0 ? '+' : ''}{trend}%
                </span>
              )}
            </div>
          </div>
          {weekTarget && (
            <div className="w-full h-1.5 bg-page rounded-full overflow-hidden mb-4">
              <div
                className={cn('h-full rounded-full transition-all', weeklyKm >= weekTarget.min ? 'bg-accent-600' : 'bg-[#fc5200]')}
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
                  <span className={cn('text-3xs font-bold mb-1 tabular-nums', isLast ? 'text-[#fc5200]' : 'text-ink-700/70')}>{w.km}</span>
                  <div
                    className={cn('rounded-full', isLast ? 'bg-[#fc5200]' : 'bg-ink-300')}
                    style={{ height: `${barH}px`, width: '12px' }}
                  />
                  <span className={cn('text-3xs mt-1', isLast ? 'text-ink-700' : 'text-ink-400')}>{w.week}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* RIGHT: Leaderboard */}
      {leaderboard.length > 0 && (
        <section className="bg-card rounded-card border border-page p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-band-3" />
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">Top 3</span>
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
                <span className="text-2xs font-bold text-ink-500 mb-1 tabular-nums">{top3[1].distanceKm}</span>
                <div className="w-6 rounded-t bg-ink-300/80" style={{ height: '50px' }} />
                <Link
                  href={`/dashboard/teammate/${top3[1].id}`}
                  className="text-2xs text-ink-500 mt-1.5 font-medium whitespace-nowrap"
                >
                  {top3[1].name.split(' ')[0]}
                </Link>
              </div>
            )}
            {top3.length >= 1 && (
              <div className="flex flex-col items-center" style={{ width: '56px' }}>
                <span className="text-sm mb-0.5">👑</span>
                <span className="text-xs font-black text-band-3-ink mb-1 tabular-nums">{top3[0].distanceKm}</span>
                <div className="w-6 rounded-t bg-band-3" style={{ height: '70px' }} />
                <Link
                  href={`/dashboard/teammate/${top3[0].id}`}
                  className="text-2xs text-ink-700 font-bold mt-1.5 whitespace-nowrap"
                >
                  {top3[0].name.split(' ')[0]}
                </Link>
              </div>
            )}
            {top3.length >= 3 && (
              <div className="flex flex-col items-center" style={{ width: '56px' }}>
                <span className="text-2xs font-bold text-band-3-ink mb-1 tabular-nums">{top3[2].distanceKm}</span>
                <div className="w-6 rounded-t bg-band-3/80" style={{ height: '35px' }} />
                <Link
                  href={`/dashboard/teammate/${top3[2].id}`}
                  className="text-2xs text-ink-500 mt-1.5 font-medium whitespace-nowrap"
                >
                  {top3[2].name.split(' ')[0]}
                </Link>
              </div>
            )}
          </div>
          {myRank > 3 && <p className="text-3xs text-ink-400 text-center mt-2">You: #{myRank}</p>}
        </section>
      )}
    </div>
  );
}
