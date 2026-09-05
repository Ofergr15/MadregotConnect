'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn, getActivityWeekStart, activityWeekStart, israelDateAnchor } from '@/lib/utils';
import { fetchActivities } from '@/lib/activities-client';
import { apiHeaders } from '@/lib/api';

interface Props {
  athleteId: string | null;
}

// How many bars the chart draws. Ten, not the twelve this used to show on the
// feed: on a 320pt screen twelve columns could not fit without either clipping
// or squeezing the labels into unreadability.
const WEEKS = 10;

// One athlete's own volume snapshot — this week's km against the plan's target,
// then the last ten weeks as bars.
//
// Lifted out of WeeklyLeaderboardCard, which used to render this beside the
// club top-3 on the feed. It never belonged there: the feed is "how is everyone
// doing", and a chart of nothing but my own weekly totals is the single most
// personal thing in the app. It lives on the profile landing now, under the
// header, and the feed card is the leaderboard alone. Moving it also takes two
// requests off the feed's first paint.
export function WeeklyVolumeCard({ athleteId }: Props) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const [weeklyKm, setWeeklyKm] = useState(0);
  const [volumes, setVolumes] = useState<Array<{ week: string; km: number; runs: number }>>([]);
  const [weekTarget, setWeekTarget] = useState<{ min: number; max: number } | null>(null);

  useEffect(() => {
    if (!athleteId) return;
    (async () => {
      try {
        const headers = await apiHeaders();
        // `selfOnly` + `volumeOnly` + `sinceDays`: this card reads three fields
        // off an activity — athlete_id, start_time, distance — and never looks
        // past its own window. Asking for the default shape instead meant the
        // club's newest 200 rows with `laps` JSONB included, to produce eleven
        // numbers.
        //
        // Eleven weeks of history for ten bars: the oldest bar's week has to
        // arrive whole or it renders short and reads as a bad week rather than
        // a partial one.
        const [actRes, weeklyRes] = await Promise.all([
          fetchActivities({ selfOnly: true, volumeOnly: true, sinceDays: (WEEKS + 1) * 7 }),
          fetch('/api/dashboard/weekly', { headers }),
        ]);

        if (weeklyRes.ok) {
          const w = await weeklyRes.json();
          if (w?.weekTotalMax > 0) setWeekTarget({ min: Math.round(w.weekTotalMin), max: Math.round(w.weekTotalMax) });
        }

        if (actRes.ok) {
          const actData = await actRes.json();
          const mine = (actData.activities || []).filter((a: any) => a.athlete_id === athleteId);

          const weekStart = new Date(getActivityWeekStart(israelDateAnchor()));
          const thisWeek = mine.filter((a: any) => new Date(a.start_time) >= weekStart);
          setWeeklyKm(Math.round((thisWeek.reduce((s: number, a: any) => s + (a.distance || 0), 0) / 1000) * 10) / 10);

          // Keyed by the week-start Sunday as ISO (YYYY-MM-DD), which sorts
          // correctly as a plain string, and only turned into a DD/MM label at
          // the end — keying by DD/MM has no year, so across New Year the
          // January weeks sort ahead of December's.
          const weekMap: Record<string, { km: number; runs: number }> = {};
          mine.forEach((a: any) => {
            // activityWeekStart, not getActivityWeekStart: start_time is the
            // athlete's wall-clock read as UTC, so local getters here shift it
            // +3h in an Israel browser and a 21:30 Saturday run jumps a week.
            const key = activityWeekStart(a.start_time);
            if (!weekMap[key]) weekMap[key] = { km: 0, runs: 0 };
            weekMap[key].km += (a.distance || 0) / 1000;
            weekMap[key].runs += 1;
          });
          setVolumes(
            Object.entries(weekMap)
              .sort(([a], [b]) => a.localeCompare(b))
              .slice(-WEEKS)
              .map(([iso, data]) => ({
                week: iso.split('-').reverse().slice(0, 2).join('/'), // DD/MM
                km: Math.round(data.km * 10) / 10,
                runs: data.runs,
              })),
          );
        }
      } catch { /* best-effort — the card just hides if nothing loads */ }
    })();
  }, [athleteId]);

  // One bar is not a trend. Same bar as the big number above it, so it would be
  // a chart that says nothing twice.
  if (volumes.length <= 1) return null;

  const maxKm = Math.max(...volumes.map(w => w.km), 1);
  const lastWeek = volumes[volumes.length - 1];
  const prevWeek = volumes[volumes.length - 2];
  const trend = prevWeek && prevWeek.km > 0 && lastWeek
    ? Math.round(((lastWeek.km - prevWeek.km) / prevWeek.km) * 100)
    : 0;

  return (
    <section className="bg-card rounded-card border border-page p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-2xl font-black text-ink-700 tabular-nums">{weeklyKm}</span>
          <span className="text-xs text-ink-400 truncate">{tc('km')} {t('thisWeek')}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {weekTarget && (
            <span className="text-xs font-semibold text-ink-500 tabular-nums">
              {t('weekGoalRange', { min: weekTarget.min, max: weekTarget.max, unit: tc('km') })}
            </span>
          )}
          {trend !== 0 && (
            // dir="ltr" because a signed number is not RTL text. Inside the
            // Hebrew page bidi moved the minus to the far end and "-56%"
            // rendered as "56%-", which reads as a typo at best.
            <span
              dir="ltr"
              className={cn(
                'text-3xs font-bold px-1.5 py-0.5 rounded-md tabular-nums',
                trend > 0 ? 'bg-accent-600/10 text-accent-900' : 'bg-band-3/10 text-band-3-ink',
              )}
            >
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

      {/* Columns are flex-1 rather than a fixed 28px each: ten fixed columns
          plus their gaps came to 334px of content, which a 320pt phone cannot
          give. Sharing the row means the chart fits any width instead of
          deciding how wide the card has to be. */}
      <div className="flex items-end justify-center gap-1" style={{ height: '100px' }}>
        {volumes.map((w, i) => {
          const isLast = i === volumes.length - 1;
          const barH = Math.max(10, Math.round((w.km / maxKm) * 65));
          return (
            <div key={i} className="flex flex-col items-center justify-end flex-1 min-w-0" style={{ height: '100px' }}>
              <span className={cn('text-3xs font-bold mb-1 tabular-nums', isLast ? 'text-[#fc5200]' : 'text-ink-700/70')}>{w.km}</span>
              <div
                className={cn('rounded-full w-3', isLast ? 'bg-[#fc5200]' : 'bg-ink-300')}
                style={{ height: `${barH}px` }}
              />
              <span className={cn('text-3xs mt-1 tabular-nums', isLast ? 'text-ink-700' : 'text-ink-400')}>{w.week}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
