'use client';

import type { ReactNode } from 'react';
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
  /** The time came from a lap-measured stretch inside a longer run, not the whole run. */
  fromSegment?: boolean;
  /** What the watch actually recorded for the run this best was taken from. */
  sourceMeters?: number | null;
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

  /**
   * Where a bucket time actually came from, in the athlete's own numbers.
   *
   * Reported as a bug twice: a runner sees "HM 1:23:53" here, compares it with the
   * chip time on his medal, and the card looks wrong. It isn't — it is his watch's
   * 21.21 km in 1:24:20, scaled down to the 21.097 km the bucket is defined as. The
   * two numbers can't agree, because a GPS trace of a race is never exactly the
   * measured course, and nothing in this app has access to an official result.
   *
   * So the honest fix is to show the working rather than to keep a number that reads
   * as a mistake. Returns null when there is nothing to explain — a run that was
   * genuinely within 0.5% of the bucket distance needs no footnote.
   */
  const provenance = (b: DistanceBest): ReactNode => {
    if (b.seconds == null) return null;
    if (b.fromSegment) return 'הקטע המהיר ביותר בתוך ריצה ארוכה יותר';
    const src = b.sourceMeters;
    if (!src || Math.abs(src - b.meters) / b.meters < 0.005) return null;
    // The raw duration, recovered from the scaling that produced `seconds`. Shown
    // rather than the ratio because "21.21 km in 1:24:20" is a thing the athlete can
    // find in his own activity list; "+0.5%" is not. Each number gets its own <bdi>
    // so the RTL run around them can't reorder the pair.
    const rawSeconds = Math.round(b.seconds * (src / b.meters));
    return (
      <>
        לפי המדידה בשעון: <bdi dir="ltr">{(src / 1000).toFixed(2)}</bdi> ק״מ ב-
        <bdi dir="ltr">{formatTime(rawSeconds)}</bdi>
      </>
    );
  };

  return (
    <div className="rounded-card bg-card/80 border border-page/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wider">שיאים אישיים</h2>
      </div>
      <div className="space-y-2">
        {achieved.map((b) => {
          const note = provenance(b);
          return (
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
              {/* Deliberately NOT `truncate` like the date line above it: this text
                  is a sentence, and clipping it drops the time on the end — which is
                  the only part anyone reads it for. Two lines is fine. */}
              {note && <div className="text-2xs text-ink-400/80 leading-snug">{note}</div>}
            </div>
            <div className="text-lg font-black text-ink-700 tabular-nums shrink-0">{formatTime(b.seconds!)}</div>
          </div>
          );
        })}
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
      <p className="mt-3 text-2xs text-ink-400 leading-relaxed">
        מחושב אוטומטית מהריצות שלך (גרמין / סטרבה). זמן למרחק מדויק מחושב לפי המדידה של השעון, ולכן
        ייתכן הפרש קטן מזמן רשמי בתחרות.
      </p>
    </div>
  );
}
