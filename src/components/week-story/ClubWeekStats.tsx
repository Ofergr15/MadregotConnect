import type { ClubWeekPayload } from '@/lib/week-story/model';

/** The club week post's numbers (lib/week-story/model.ts CLUB_WEEK_KIND), under its line. */
export function ClubWeekStats({ week }: { week: ClubWeekPayload }) {
  const tiles: Array<[number, string]> = [
    [week.km, 'ק״מ'],
    [week.runners, 'רצים'],
    ...(week.records > 0 ? [[week.records, 'שיאים'] as [number, string]] : []),
    ...(week.marathons > 0 ? [[week.marathons, 'ריצות באורך מרתון 🏁'] as [number, string]] : []),
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-2" dir="rtl">
      {tiles.map(([v, label]) => (
        <div key={label} className="rounded-2xl bg-gradient-to-b from-[#1525FF] to-[#0a1080] px-3.5 py-3 text-white [&:last-child:nth-child(odd)]:col-span-2">
          <b className="block text-[24px] font-black leading-none tabular-nums"><bdi>{v.toLocaleString('en-US')}</bdi></b>
          <small className="text-[12px] opacity-85">{label}</small>
        </div>
      ))}
    </div>
  );
}
