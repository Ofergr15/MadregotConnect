'use client';

import { Zap } from 'lucide-react';
import { formatTime } from '@/lib/academy/benchmark';
import { useApi } from '@/lib/api';

interface DistanceBest {
  key: string;
  label: string;
  meters: number;
  seconds: number | null;
  date: string | null;
  activityName: string | null;
}

interface LongestRun {
  meters: number;
  km: number;
  date: string | null;
  activityName: string | null;
}

interface BestMonth {
  year: number;
  month: number; // 0-11 (Date#getMonth())
  km: number;
}

// Auto-detected Personal Records — fastest 5K / 10K / Half from the athlete's
// full run history (Garmin + Strava). Zero manual entry. Styled to match the
// sibling "Your Best" (ProfileBest) card. Hidden entirely if the athlete has no
// qualifying efforts yet, so it never shows an empty shell.
interface PrData { distanceBests?: DistanceBest[]; longestRun?: LongestRun | null; bestMonth?: BestMonth | null; }

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export function PersonalRecords({ athleteId }: { athleteId: string }) {
  const { data } = useApi<PrData>(
    athleteId ? `/api/athletes/prs?athleteId=${encodeURIComponent(athleteId)}` : null,
  );
  const bests = data?.distanceBests || [];
  const longest = data?.longestRun || null;
  const bestMonth = data?.bestMonth || null;

  const achieved = bests.filter((b) => b.seconds != null);
  if (achieved.length === 0 && !longest && !bestMonth) return null;

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' }) : '';

  return (
    <div className="rounded-card bg-card/80 border border-page/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wider">שיאים אישיים</h2>
      </div>
      <div className="space-y-2">
        {achieved.map((b) => (
          <div key={b.key} className="flex items-center gap-3 bg-page/50 rounded-xl p-3">
            <span className="shrink-0 w-11 text-center text-2xs font-black uppercase tracking-wide text-brand-600 bg-brand-600/20 rounded-lg py-2">
              {b.key === 'hm' ? 'HM' : b.key === 'fm' ? 'FM' : b.label}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink-700">{b.label}</div>
              {b.date && (
                <div className="text-xs text-ink-400 truncate" dir="auto">
                  {fmtDate(b.date)}{b.activityName ? ` · ${b.activityName}` : ''}
                </div>
              )}
            </div>
            <div className="text-lg font-black text-ink-700 tabular-nums shrink-0">{formatTime(b.seconds!)}</div>
          </div>
        ))}
        {longest && (
          <div className="flex items-center gap-3 bg-page/50 rounded-xl p-3">
            <span className="shrink-0 w-11 text-center text-2xs font-black uppercase tracking-wide text-accent-900 bg-accent-600/20 rounded-lg py-2">
              MAX
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink-700">הריצה הארוכה ביותר</div>
              {longest.date && (
                <div className="text-xs text-ink-400 truncate" dir="auto">
                  {fmtDate(longest.date)}{longest.activityName ? ` · ${longest.activityName}` : ''}
                </div>
              )}
            </div>
            <div className="text-lg font-black text-ink-700 tabular-nums shrink-0">{longest.km} ק״מ</div>
          </div>
        )}
        {bestMonth && (
          <div className="flex items-center gap-3 bg-page/50 rounded-xl p-3">
            <span className="shrink-0 w-11 text-center text-2xs font-black uppercase tracking-wide text-band-3-ink bg-band-3/20 rounded-lg py-2">
              נפח
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink-700">החודש הכי נפחי</div>
              <div className="text-xs text-ink-400 truncate">
                {HE_MONTHS[bestMonth.month]} {bestMonth.year}
              </div>
            </div>
            <div className="text-lg font-black text-ink-700 tabular-nums shrink-0">{bestMonth.km} ק״מ</div>
          </div>
        )}
      </div>
      <p className="mt-3 text-2xs text-ink-400">מחושב אוטומטית מהריצות שלך (גרמין / סטרבה)</p>
    </div>
  );
}
