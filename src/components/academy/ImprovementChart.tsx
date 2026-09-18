'use client';

import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { formatPace } from '@/components/activity/format';
import { useChartWidth } from '@/components/charts/useChartWidth';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Direction, TrendPoint, TrendSeries } from '@/lib/academy/tests';

// ── The improvement graph ────────────────────────────────────────────────────
//
// Section 5, and Ofer's own reason for wanting it: "it would be very cool to have an
// improvement graph; that is something very hard to do by hand unless you have two or
// three trainees." The numbers already arrive — the club tests at intake and every few
// months. Nothing here is hard except that they live in a spreadsheet nobody plots.
//
// FASTER IS HIGHER on this chart, which is the opposite of the way the mockup sketched
// it (5:10 at the top, 4:45 at the bottom, labelled "lower = better"). The app's own pace
// chart already inverts — `charts.tsx` builds its planned band with "upper edge (fastest
// = smaller sec)" — and two pace charts in one app that read in opposite directions is a
// worse defect than either direction is. It is also the reading that cannot be
// misinterpreted at a glance: the line goes up as the athlete gets faster, so nobody has
// to consult an axis label to know whether seven months went well.
//
// Every verdict and delta comes from `lib/academy/tests.ts`, which is pure and tested.
// Nothing here decides whether a change counts as improvement — in particular the noise
// floor, below which a couple of seconds per km is wind and GPS rather than progress.

const PAD = { top: 14, right: 12, bottom: 22, left: 40 };
const HEIGHT = 168;

/** Green when faster, red when slower, neutral when it is inside the noise floor. */
const DIRECTION_TONE: Record<Direction, string> = {
  improved: 'text-accent-900',
  regressed: 'text-accent-red-ink',
  same: 'text-ink-500',
};

/**
 * A delta in seconds per km, as a person says it: "-6" / "+7" / "±0".
 *
 * LTR-isolated because it is a signed number inside Hebrew, and a bare minus sign at an
 * RTL boundary lands on the wrong end of the digits.
 */
function DeltaText({ sec }: { sec: number }) {
  const rounded = Math.round(sec);
  if (rounded === 0) return <bdi dir="ltr">±0</bdi>;
  return <bdi dir="ltr">{rounded < 0 ? '−' : '+'}{Math.abs(rounded)}</bdi>;
}

/** `2026-09-14` → `09.26`, for an axis where only month and year fit. */
function monthLabel(date: string): string {
  const [year, month] = date.split('-');
  return `${month}.${year.slice(2)}`;
}

/**
 * The line itself. Straight segments, not a spline: four tests over seven months are four
 * measurements, and a curve through them draws a trajectory between tests that nobody
 * measured — on a chart whose whole claim is "this is what happened".
 */
function TrendLine({ points }: { points: TrendPoint[] }) {
  const { boxRef, width } = useChartWidth();
  const plotted = points.filter((p): p is TrendPoint & { paceSec: number } => p.paceSec !== null);

  const chartW = Math.max(1, width - PAD.left - PAD.right);
  const chartH = HEIGHT - PAD.top - PAD.bottom;

  const paces = plotted.map(p => p.paceSec);
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  // A floor on the range so two nearly identical tests do not get magnified into a cliff.
  // Ten seconds per km is twice the noise floor: inside it the line stays visibly flat,
  // which is the honest picture of an athlete who has not changed.
  const span = Math.max(slowest - fastest, 10);
  const middle = (slowest + fastest) / 2;
  const viewFast = middle - span / 2 - span * 0.15;
  const viewSlow = middle + span / 2 + span * 0.15;

  // Faster (smaller sec/km) is HIGHER. See the header.
  const toY = (pace: number) => PAD.top + ((pace - viewFast) / (viewSlow - viewFast)) * chartH;
  const toX = (i: number) =>
    PAD.left + (plotted.length === 1 ? chartW / 2 : (i / (plotted.length - 1)) * chartW);

  const coords = plotted.map((p, i) => ({ x: toX(i), y: toY(p.paceSec), point: p }));
  const line = coords.map((c, i) => `${i ? 'L' : 'M'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

  const ticks = [viewFast + span * 0.15, middle, viewSlow - span * 0.15];

  return (
    <div ref={boxRef}>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width={width}
        height={HEIGHT}
        // The page is RTL and an SVG inherits it: without this, textAnchor="end" resolves
        // to the LEFT edge and every y-axis label draws into the plot. Same fix, and the
        // same reason, as the activity charts.
        direction="ltr"
        className="max-w-full"
      >
        {ticks.map(pace => (
          <g key={pace}>
            <line
              x1={PAD.left} x2={PAD.left + chartW} y1={toY(pace)} y2={toY(pace)}
              className="stroke-ink-100" strokeWidth={1}
            />
            <text
              x={PAD.left - 6} y={toY(pace) + 3} textAnchor="end"
              className="fill-ink-400 text-[10px] tabular-nums"
            >
              {formatPace(pace)}
            </text>
          </g>
        ))}

        {plotted.length > 1 && (
          <path d={line} fill="none" className="stroke-brand-600" strokeWidth={2} strokeLinejoin="round" />
        )}

        {coords.map(({ x, y, point }) => (
          <circle
            key={point.testId} cx={x} cy={y} r={4}
            className="fill-card stroke-brand-600" strokeWidth={2}
          />
        ))}

        {coords.map(({ x, point }) => (
          <text
            key={point.testId} x={x} y={HEIGHT - 6} textAnchor="middle"
            className="fill-ink-400 text-[10px] tabular-nums"
          >
            {monthLabel(point.date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/**
 * The pure view. Mounted directly by the preview so the audit sees the real component.
 *
 * `heading` exists for the same reason `FeedbackCard`'s does: this card is read by the
 * trainee ("השיפור שלך") and by the coach looking at that trainee, and a component reused
 * by two seats cannot hard-code the second person.
 */
export function ImprovementChart({
  trend,
  heading = 'השיפור שלך',
  subtitle,
  className,
}: {
  trend: TrendSeries;
  heading?: string;
  subtitle?: string;
  className?: string;
}) {
  const { points, totalDeltaSec, totalDirection, spanDays, excluded } = trend;

  if (points.length === 0) {
    return (
      <div className={cn('rounded-card bg-card p-4 text-center', className)} dir="rtl">
        <p className="text-xs text-ink-400">עוד לא נרשם טסט. הטסט הראשון הוא קו הבסיס.</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-card bg-card p-4 space-y-3', className)} dir="rtl">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink-900">{heading}</h3>
          {subtitle && <p className="text-[11px] text-ink-400">{subtitle}</p>}
        </div>
        {/* The headline number, and only when there are two tests to compare. One test
            is a baseline, and quoting it as a change would invent a comparison. */}
        {totalDeltaSec !== null && totalDirection && (
          <span className={cn('shrink-0 text-lg font-bold tabular-nums', DIRECTION_TONE[totalDirection])}>
            <DeltaText sec={totalDeltaSec} />
            <span className="ms-1 text-[11px] font-semibold">שנ׳/ק״מ</span>
          </span>
        )}
      </div>

      {/* Says what is plotted AND which way is good, because a pace axis is the one
          chart where a reader can be confidently wrong. */}
      <p className="flex items-center gap-1.5 text-[11px] text-ink-500">
        <TrendingUp className="h-3 w-3 shrink-0" />
        קצב סף לפי טסט {trend.protocol === '30min' ? '30 דקות' : trend.protocol} · גבוה בגרף = מהיר יותר
      </p>

      <TrendLine points={points} />

      {/* The table under the graph. The graph shows the shape; this is where the coach
          reads the actual numbers, and the mockup asks for both. */}
      <div className="space-y-1">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-1 text-[10px] font-semibold text-ink-400">
          <span>תאריך</span><span className="text-end">מרחק</span>
          <span className="text-end">קצב</span><span className="text-end">שינוי</span>
        </div>
        {/* Newest first — the opposite of the graph, which is drawn oldest-to-newest.
            Deliberate: a line is read left to right, a table is read from the top, and
            the row anybody wants first is the most recent test. */}
        {[...points].reverse().map(point => (
          <div
            key={point.testId}
            className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-pill bg-page px-2 py-1.5 text-[11px] tabular-nums"
          >
            <span className="text-ink-700"><bdi dir="ltr">{isoToShort(point.date)}</bdi></span>
            <span className="text-end text-ink-500">
              <bdi dir="ltr">{(point.distanceM / 1000).toFixed(2)}</bdi>
            </span>
            <span className="text-end font-semibold text-ink-900">
              <bdi dir="ltr">{point.paceSec === null ? '—' : formatPace(point.paceSec)}</bdi>
            </span>
            <span className={cn('text-end font-semibold', point.directionPrev ? DIRECTION_TONE[point.directionPrev] : 'text-ink-400')}>
              {point.deltaPrevSec === null ? 'בסיס' : <DeltaText sec={point.deltaPrevSec} />}
            </span>
          </div>
        ))}
      </div>

      {/* Named, never silently dropped: a graph missing a test the coach knows he
          recorded looks like data loss, and the reason is what makes it readable later. */}
      {excluded.length > 0 && (
        <div className="rounded-card bg-band-2/10 px-3 py-2">
          <p className="text-[11px] text-band-2-ink">
            {excluded.length === 1 ? 'טסט אחד לא נכנס לגרף' : <><bdi dir="ltr">{excluded.length}</bdi> טסטים לא נכנסו לגרף</>}
            {': '}
            {excluded.map(e => `${isoToShort(e.date)} — ${e.reason}`).join(' · ')}
          </p>
        </div>
      )}

      {points.length > 1 && spanDays !== null && totalDeltaSec !== null && (
        <p className="text-[11px] leading-relaxed text-ink-500">
          <bdi dir="ltr">{Math.abs(Math.round(totalDeltaSec))}</bdi> שניות לקילומטר
          {' '}{totalDeltaSec < 0 ? 'מהר יותר' : 'לאט יותר'} על פני
          {' '}<bdi dir="ltr">{Math.round(spanDays / 30)}</bdi> חודשים,
          {' '}לפי <bdi dir="ltr">{points.length}</bdi> טסטים.
        </p>
      )}
    </div>
  );
}

/** `2026-09-14` → `14.09.26`. */
function isoToShort(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year.slice(2)}`;
}

/** The fetching wrapper. `athleteId` may be the caller's own — the route allows that. */
export function AthleteImprovement({
  athleteId,
  protocol = '30min',
  heading,
  subtitle,
}: {
  athleteId: string;
  protocol?: string;
  heading?: string;
  subtitle?: string;
}) {
  const [trend, setTrend] = useState<TrendSeries | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const res = await fetch(
          `/api/academy/tests?athleteId=${encodeURIComponent(athleteId)}&protocol=${encodeURIComponent(protocol)}`,
          { headers: await apiHeaders() },
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setState('error'); return; }
        // Migration 105 not applied yet. Said out loud rather than shown as "no tests" —
        // the club HAS tests, they are in a spreadsheet, and telling Ofer he has none
        // would send him looking for a bug in the wrong place.
        if (data?.tableMissing) { setState('missing'); return; }
        setTrend(data.trend as TrendSeries);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [athleteId, protocol]);

  if (state === 'loading') return <p className="py-6 text-center text-xs text-ink-400">טוען…</p>;
  if (state === 'missing') {
    return (
      <p className="py-6 text-center text-xs text-ink-400">
        מרשם הטסטים עוד לא הוקם במסד הנתונים.
      </p>
    );
  }
  if (state === 'error' || !trend) {
    return <p className="py-6 text-center text-xs text-accent-red-ink">לא הצלחנו לטעון את גרף השיפור</p>;
  }
  return <ImprovementChart trend={trend} heading={heading} subtitle={subtitle} />;
}
