'use client';

import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';
import { formatTime } from '@/lib/academy/benchmark';

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

// Auto-detected Personal Records — fastest 5K / 10K / Half from the athlete's
// full run history (Garmin + Strava). Zero manual entry. Styled to match the
// sibling "Your Best" (ProfileBest) card. Hidden entirely if the athlete has no
// qualifying efforts yet, so it never shows an empty shell.
export function PersonalRecords({ athleteId }: { athleteId: string }) {
  const [bests, setBests] = useState<DistanceBest[]>([]);
  const [longest, setLongest] = useState<LongestRun | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!athleteId) { setLoading(false); return; }
    const email = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
    fetch(`/api/athletes/prs?athleteId=${encodeURIComponent(athleteId)}`, {
      headers: email ? { 'x-user-email': email } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setBests(d?.distanceBests || []); setLongest(d?.longestRun || null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [athleteId]);

  const achieved = bests.filter((b) => b.seconds != null);
  if (loading || (achieved.length === 0 && !longest)) return null;

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' }) : '';

  return (
    <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="h-4 w-4 text-primary-400" />
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">שיאים אישיים</h2>
      </div>
      <div className="space-y-2">
        {achieved.map((b) => (
          <div key={b.key} className="flex items-center gap-3 bg-slate-900/50 rounded-xl p-3">
            <span className="shrink-0 w-11 text-center text-2xs font-black uppercase tracking-wide text-primary-300 bg-primary-600/20 rounded-lg py-2">
              {b.key === 'hm' ? 'HM' : b.key === 'fm' ? 'FM' : b.label}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">{b.label}</div>
              {b.date && (
                <div className="text-xs text-slate-400 truncate" dir="auto">
                  {fmtDate(b.date)}{b.activityName ? ` · ${b.activityName}` : ''}
                </div>
              )}
            </div>
            <div className="text-lg font-black text-white tabular-nums shrink-0">{formatTime(b.seconds!)}</div>
          </div>
        ))}
        {longest && (
          <div className="flex items-center gap-3 bg-slate-900/50 rounded-xl p-3">
            <span className="shrink-0 w-11 text-center text-2xs font-black uppercase tracking-wide text-emerald-300 bg-emerald-600/20 rounded-lg py-2">
              MAX
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">הריצה הארוכה ביותר</div>
              {longest.date && (
                <div className="text-xs text-slate-400 truncate" dir="auto">
                  {fmtDate(longest.date)}{longest.activityName ? ` · ${longest.activityName}` : ''}
                </div>
              )}
            </div>
            <div className="text-lg font-black text-white tabular-nums shrink-0">{longest.km} ק״מ</div>
          </div>
        )}
      </div>
      <p className="mt-3 text-2xs text-slate-500">מחושב אוטומטית מהריצות שלך (גרמין / סטרבה)</p>
    </div>
  );
}
