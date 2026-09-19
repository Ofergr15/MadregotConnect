'use client';

import { useEffect, useState } from 'react';
import { Share2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { israelNow, israelToday } from '@/lib/utils';
import { fetchActivities } from '@/lib/activities-client';
import {
  buildLast7Report, formatReportHours, formatReportPace,
  type Last7Report, type ReportActivity,
} from '@/lib/reports/last-7-days';
import {
  isWeekSummaryWindow, weekSummaryAnchor, weekSummaryDismissKey,
} from '@/lib/reports/week-summary-window';
import { WeekShareSheet } from '@/components/profile/WeekShareSheet';

// ═════════════════════════════════════════════════════════════════════════════
// LAST WEEK, AT THE TOP OF THE FEED — SATURDAY 18:00 → SUNDAY 10:00
//
// The same report as the Saturday push and the same report as the profile card
// (buildLast7Report over the athlete's own activities), put where it will
// actually be seen in the hours when the week has just closed. It is a share
// surface first: the numbers are a preview of the card, and the button under
// them is the reason the block exists.
//
// Three things it deliberately does not do:
//
//   · it does not add an endpoint — /api/activities already returns distance,
//     duration, elevation_gain and calories, so the fold happens here;
//   · it does not draw the bars the profile card draws. This is a strip at the
//     top of someone else's content, and a chart here would push the feed down
//     for sixteen hours a week;
//   · it does not survive the window. Outside Saturday 18:00 → Sunday 10:00 it
//     renders nothing at all, which is also why it is mounted inside an
//     `empty:mb-0` wrapper — no gap on the other six days.
//
// The dismissal is keyed to the SATURDAY (weekSummaryAnchor), not to "today":
// the window straddles midnight, so a key of today's date would let a card
// closed at 23:00 come straight back at 08:00.
// ═════════════════════════════════════════════════════════════════════════════

export function WeekSummaryCard() {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const [report, setReport] = useState<Last7Report | null>(null);
  const [athleteName, setAthleteName] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    const { weekday, hour } = israelNow();
    if (!isWeekSummaryWindow({ weekday, hour })) return;

    const anchor = weekSummaryAnchor(israelToday(), weekday);
    if (localStorage.getItem(weekSummaryDismissKey(anchor))) return;
    setDismissed(false);
    setAthleteName(localStorage.getItem('athlete_name') || null);

    let cancelled = false;
    (async () => {
      try {
        // Eight days, not seven: `since` is a date-only floor, so a day of slack
        // keeps the oldest day whole whichever side of midnight we are on.
        const res = await fetchActivities({ selfOnly: true, sinceDays: 8 });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const acts = (data.activities || []) as ReportActivity[];
        // The report ends on the Saturday even when it is read on Sunday
        // morning: the week being summarised is the one that just closed.
        const built = buildLast7Report(acts, anchor);
        if (!cancelled && built.runs > 0) setReport(built);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = () => {
    const { weekday } = israelNow();
    localStorage.setItem(weekSummaryDismissKey(weekSummaryAnchor(israelToday(), weekday)), '1');
    setDismissed(true);
  };

  // A week with no runs is nothing to lead the feed with, let alone share.
  if (dismissed || !report) return null;

  const fd = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  return (
    <section className="rounded-card bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink-700">{t('last7Title')}</h2>
          <p className="mt-0.5 text-xs font-light text-ink-400 tabular-nums">
            <bdi dir="ltr">{fd(report.from)} – {fd(report.to)}</bdi>
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label={tc('close')}
          className="-me-1 -mt-1 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-page hover:text-ink-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1 border-t border-page pt-3">
        <Total value={String(Math.round(report.km * 10) / 10)} label={t('last7Km')} />
        <Total value={formatReportHours(report.seconds)} label={t('last7Hours')} />
        <Total
          value={report.paceSeconds ? formatReportPace(report.paceSeconds) : '–'}
          label={t('last7Pace')}
        />
        <Total value={String(report.runs)} label={t('last7Runs')} />
      </div>

      <button
        onClick={() => setSharing(true)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-bold text-white transition-all active:scale-[0.98]"
      >
        <Share2 className="h-4 w-4" />
        {t('weekShareAction')}
      </button>

      {sharing && (
        <WeekShareSheet report={report} athleteName={athleteName} onClose={() => setSharing(false)} />
      )}
    </section>
  );
}

function Total({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      {/* bdi so a pace's colon keeps its digits in order inside an RTL block. */}
      <span className="block text-lg font-bold tabular-nums text-ink-700">
        <bdi dir="ltr">{value}</bdi>
      </span>
      <span className="block text-4xs font-light text-ink-400">{label}</span>
    </div>
  );
}
