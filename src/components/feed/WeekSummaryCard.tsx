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
import { ShareSheet } from '@/components/ShareSheet';

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
    // The one dark block in a feed of white cards, and the same gradient the story
    // it produces is drawn on — abstract rather than photographic on his call: a
    // photo of somebody running is a claim about whose week this is, and the block
    // belongs to whoever is reading it.
    <section className="relative overflow-hidden rounded-card bg-gradient-to-br from-[#2f45ff] to-[#1b1150] p-4 text-white">
      {/* Two soft lights, the only decoration — cheap, no asset, and they survive
          any width because they are sized in percentages. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(120% 90% at 85% -10%, rgba(255,255,255,.28), transparent 60%), '
            + 'radial-gradient(90% 80% at 0% 110%, rgba(93,255,208,.18), transparent 60%)',
        }}
      />

      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-bold">{t('last7Title')}</h2>
          <p className="mt-0.5 text-xs font-light text-white/60 tabular-nums">
            <bdi dir="ltr">{fd(report.from)} – {fd(report.to)}</bdi>
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label={tc('close')}
          className="-me-1 -mt-1 rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative mt-3 grid grid-cols-4 gap-1 border-t border-white/15 pt-3">
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
        className="relative mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white/15 py-2.5 text-sm font-bold text-white backdrop-blur-sm transition-all hover:bg-white/25 active:scale-[0.98]"
      >
        <Share2 className="h-4 w-4" />
        {t('weekShareAction')}
      </button>

      {sharing && (
        <ShareSheet
          subject={{ kind: 'week', report, athleteName }}
          onClose={() => setSharing(false)}
        />
      )}
    </section>
  );
}

function Total({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      {/* bdi so a pace's colon keeps its digits in order inside an RTL block. */}
      <span className="block text-lg font-bold tabular-nums">
        <bdi dir="ltr">{value}</bdi>
      </span>
      <span className="block text-4xs font-light text-white/60">{label}</span>
    </div>
  );
}
