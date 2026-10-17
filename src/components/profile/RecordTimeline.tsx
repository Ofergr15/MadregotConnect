'use client';

import { useId } from 'react';
import { formatTime } from '@/lib/academy/benchmark';
import { chartWindow, timelineDateParts, timelineLayout } from '@/lib/prs/record-history';
import { shortMonth } from '@/components/profile/pr-format';

/**
 * The record's timeline (mockups/prs-tab/record-timeline-v3.html, with the edge
 * cases from athletes-simulation.html): one dot per run that broke the record,
 * the time on it and the date under it, faster HIGHER; the last and biggest dot
 * is today's record.
 *
 * Time runs left to right — oldest on the left — even in Hebrew: the SVG's
 * coordinates are absolute and `direction: ltr` keeps its numbers in order. The
 * two Hebrew labels inside it say `direction="rtl"` themselves.
 *
 * Only the last CHART_MAX_POINTS breaks are drawn; the older ones are a dotted
 * stub and "← N earlier" at the start. The list under the chart has them all.
 */
export function RecordTimeline({
  breaks,
  manualAbove,
  manualSeconds,
  manualNote,
  current,
  locale,
  earlierLabel,
  enteredLabel,
  ariaLabel,
  celebrate = false,
}: {
  breaks: Array<{ date: string; seconds: number }>;
  /** Draw the stated time as a dashed line over the dots (it is faster than all of them). */
  manualAbove: boolean;
  manualSeconds: number | null;
  manualNote: string | null;
  /** The last dot is today's record (false when the record is a stated time). */
  current: boolean;
  locale: string;
  earlierLabel: (n: number) => string;
  enteredLabel: string;
  ariaLabel: string;
  /**
   * Ring the newest dot in amber, pulsing: the screen was opened by the "new record"
   * alert for that very run (lib/prs/new-record-alert.ts), or it is that alert's sheet.
   */
  celebrate?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const { points: pts, hidden } = chartWindow(breaks);
  if (pts.length === 0) return null;
  const L = timelineLayout(
    pts.map((p) => p.seconds),
    { hidden, manualAbove, currentIsLast: current },
  );
  const xy = L.points;
  const dates = timelineDateParts(pts.map((p) => p.date));
  const dateLabel = (i: number) =>
    dates[i].day != null
      ? `${dates[i].day} ${shortMonth(dates[i].month, locale)}`
      : `${shortMonth(dates[i].month, locale)} ${String(dates[i].year).slice(2)}`;

  let d = `M${xy[0].x},${xy[0].y}`;
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1];
    const b = xy[i];
    const cx = (a.x + b.x) / 2;
    d += ` C${cx},${a.y} ${cx},${b.y} ${b.x},${b.y}`;
  }
  const last = xy[xy.length - 1];
  const W = L.width;

  return (
    <svg
      viewBox={`0 0 ${W} ${L.height}`}
      className="block w-full"
      style={{ direction: 'ltr' }}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={`rt-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1525FF" stopOpacity=".18" />
          <stop offset="1" stopColor="#1525FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={12} x2={W - 12} y1={L.axisY} y2={L.axisY} stroke="#E2E2E2" strokeWidth={2} strokeLinecap="round" />

      {hidden > 0 && (
        <>
          {/* RTL text's "end" is its LEFT edge: the label grows rightwards from x. */}
          <text x={10} y={L.axisY + 40} direction="rtl" textAnchor="end" fontSize={11} fill="#5F5F5F" fontWeight={600}>
            ← {earlierLabel(hidden)}
          </text>
          <line
            x1={12}
            x2={L.padLeft - 12}
            y1={xy[0].y}
            y2={xy[0].y}
            stroke="#1525FF"
            strokeWidth={3}
            strokeDasharray="2 5"
            strokeLinecap="round"
            opacity={0.5}
          />
        </>
      )}

      {manualAbove && L.manualY != null && manualSeconds != null && (
        <>
          <line x1={12} x2={W - 12} y1={L.manualY} y2={L.manualY} stroke="#5F5F5F" strokeWidth={1.5} strokeDasharray="5 4" />
          {/* RTL "start" is the right edge: the label runs leftwards from the chart's right side. */}
          <text x={W - 12} y={L.manualY - 7} direction="rtl" textAnchor="start" fontSize={11.5} fontWeight={700} fill="#5F5F5F">
            {enteredLabel}{' '}
            <tspan direction="ltr" unicodeBidi="embed">{formatTime(manualSeconds)}</tspan>
            {manualNote ? ` · ${manualNote}` : ''}
          </text>
        </>
      )}

      <path d={`${d} L${last.x},${L.axisY} L${xy[0].x},${L.axisY} Z`} fill={`url(#rt-${uid})`} />
      <path d={d} fill="none" stroke="#1525FF" strokeWidth={3} strokeLinecap="round" />

      {pts.map((p, i) => {
        const { x, y, current: cur } = xy[i];
        return (
          <g key={`${p.date}-${i}`}>
            <line
              x1={x}
              x2={x}
              y1={y + (cur ? 10 : 7)}
              y2={L.axisY}
              stroke="#1525FF"
              strokeOpacity={0.15}
              strokeDasharray="3 3"
            />
            {cur && celebrate && (
              <circle cx={x} cy={y} r={10} fill="#f59e0b" opacity={0.45} className="motion-safe:animate-ping" style={{ transformOrigin: `${x}px ${y}px` }} />
            )}
            {cur && <circle cx={x} cy={y} r={14} fill={celebrate ? '#f59e0b' : '#1525FF'} opacity={celebrate ? 0.22 : 0.14} />}
            <circle cx={x} cy={y} r={cur ? 8 : 6} fill={cur ? '#1525FF' : '#fff'} stroke="#1525FF" strokeWidth={3} />
            <text
              x={x}
              y={y - (cur ? 18 : 14)}
              textAnchor="middle"
              fontSize={cur ? 15 : 13}
              fontWeight={800}
              fill={cur ? '#1525FF' : '#1D1E26'}
            >
              {formatTime(p.seconds)}
            </text>
            <circle cx={x} cy={L.axisY} r={3.5} fill={cur ? '#1525FF' : '#BBBBBB'} />
            <text
              x={x}
              y={L.axisY + 22}
              textAnchor="middle"
              fontSize={11.5}
              fontWeight={cur ? 800 : 500}
              fill={cur ? '#1525FF' : '#5F5F5F'}
            >
              {dateLabel(i)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
