'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GOAL_RACE, goalRaceProgress } from '@/lib/goal-race';

// The club's goal race as one slim line — on the feed and on the profile.
//
// Counted in WEEKS, because that is the unit a training block lives in, and
// drawn as one square per week of the block (Strava's training-log squares):
// white = done, orange = this week, translucent = still to come. A thin bar
// would say the same thing, but a row of squares can be counted, and "how many
// weeks are left" is the question the card exists to answer.
//
// Under seven days the number switches to days — "1 week" for a race on
// Saturday reads as further away than it is. Gone once race day has passed.
// Kept to 54px on purpose: the first version was 156px and pushed the first
// workout below the fold.
export function GoalRaceBanner({ className }: { className?: string }) {
  const t = useTranslations('goalRace');
  const td = useTranslations('dashboard');
  const locale = useLocale();
  const race = goalRaceProgress();
  const raceOver = GOAL_RACE.date.getTime() + 86_400_000 < Date.now();
  if (raceOver) return null;

  const raceDate = GOAL_RACE.date.toLocaleDateString(locale, { day: 'numeric', month: 'numeric' });
  const inDays = race.days < 7;
  // Whole weeks, rounded DOWN: 51 days is "7 weeks" (and two days), which is
  // also the number of translucent squares left after this week's orange one.
  const count = inDays ? race.days : Math.floor(race.days / 7);

  return (
    <div
      className={cn(
        'flex h-[54px] items-center gap-2.5 rounded-[18px] bg-gradient-to-br from-brand-600 to-[#0F1CCC] pe-3 ps-3.5 text-white',
        className,
      )}
    >
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-white/15">
        <Trophy className="h-4 w-4" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[14.5px] font-extrabold">
          {td(GOAL_RACE.nameKey)}{' '}
          <span className="text-xs font-semibold opacity-80">
            · <bdi dir="ltr">{raceDate}</bdi>
            {race.week > 0 && <> · {t('week', { week: race.week, total: race.totalWeeks })}</>}
          </span>
        </p>
        {/* One square per week. The page's RTL flow fills them from the
            reading start, so the block runs the way the text does. */}
        <div className="mt-[5px] flex gap-[2.5px]" aria-hidden="true">
          {Array.from({ length: race.totalWeeks }, (_, i) => {
            const n = i + 1;
            return (
              <i
                key={n}
                className={cn(
                  'h-[8.5px] w-[8.5px] rounded-[2.5px]',
                  n < race.week ? 'bg-white' : n === race.week ? 'bg-band-3 ring-[1.5px] ring-white/90' : 'bg-white/25',
                )}
              />
            );
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-baseline gap-1">
        {race.days === 0 ? (
          <span className="text-[15px] font-extrabold">{t('raceDay')}</span>
        ) : (
          <span className="text-[12.5px] font-bold">
            {t.rich(inDays ? 'daysLeft' : 'weeksLeft', {
              count,
              n: (chunks) => <span className="mx-0.5 text-[26px] font-black tabular-nums tracking-tight">{chunks}</span>,
            })}
          </span>
        )}
      </div>
    </div>
  );
}
