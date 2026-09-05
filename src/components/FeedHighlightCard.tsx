'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { ChevronRight, Flame, CalendarCheck, TrendingUp, Target } from 'lucide-react';
import { fetchFeedHighlight } from '@/lib/feed-client';
import { VOLUME_TREND_WEEKS, type FeedHighlight } from '@/lib/feed/highlight';

/**
 * The card pinned at the top of the feed: one big number and one sentence saying
 * where it came from.
 *
 * The sentence is the feature. "14" tells a reader nothing; "14 days you ran in,
 * out of the last 30" tells them what is being counted, over what window, without
 * a tap. Every variant here follows the same rule — number, window, next step —
 * in spoken language, no jargon.
 *
 * Which variant shows is decided server-side by `pickHighlight`, so the rotation
 * logic lives in one testable place and this file is only presentation.
 *
 * Renders nothing at all while loading and nothing when there's no highlight: a
 * skeleton in the top slot of the landing page would push the actual feed down on
 * every cold open, which is worse than the card appearing a beat late.
 */

/** Per-variant look. Kept in one table so a new variant can't half-land. */
const LOOKS = {
  challenge: {
    hero: 'from-[#8a2a06] via-band-3 to-[#ff8a4d]',
    icon: Target,
    iconTint: 'text-band-3 border-band-3/30',
    cta: 'bg-band-3 text-card',
    href: '/dashboard/profile?tab=challenges',
  },
  activeDays: {
    hero: 'from-brand-700 via-brand-600 to-band-2',
    icon: CalendarCheck,
    iconTint: 'text-brand-600 border-brand-600/25',
    cta: 'border border-brand-600/30 text-brand-600',
    href: '/dashboard/profile?tab=statistics',
  },
  streak: {
    hero: 'from-[#0d5c2c] via-accent-600 to-accent-400',
    icon: Flame,
    iconTint: 'text-accent-600 border-accent-600/30',
    cta: 'border border-accent-600/30 text-accent-600',
    href: '/dashboard/profile?tab=statistics',
  },
  volume: {
    hero: 'from-brand-700 via-brand-600 to-band-2',
    icon: TrendingUp,
    iconTint: 'text-brand-600 border-brand-600/25',
    cta: 'border border-brand-600/30 text-brand-600',
    href: '/dashboard/profile?tab=statistics',
  },
} as const;

const SPARK_W = 360;
const SPARK_H = 104;

/**
 * The hero chart. Deliberately unlabelled and unscaled — it is a shape that says
 * "this is a trend", and the number below it carries the meaning. Axes and
 * gridlines on a 104px-tall decoration would be noise, and the real charts are one
 * tap away on the Statistics screen.
 */
function Spark({ values, mode }: { values: number[]; mode: 'line' | 'bars' }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pad = 14;
  const usable = SPARK_W - pad * 2;

  if (mode === 'bars') {
    const gap = 8;
    const barW = Math.max(4, (usable - gap * (values.length - 1)) / values.length);
    return (
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {values.map((v, i) => {
          const h = Math.max(6, (v / max) * 42);
          return (
            <rect
              key={i}
              x={pad + i * (barW + gap)}
              y={SPARK_H - 20 - h}
              width={barW}
              height={h}
              rx="4"
              fill="#fff"
              opacity={0.55 + 0.45 * (i / (values.length - 1))}
            />
          );
        })}
      </svg>
    );
  }

  const pts = values.map((v, i) => {
    const x = pad + (i * usable) / (values.length - 1);
    const y = SPARK_H - 22 - (v / max) * 52;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="feedHighlightFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.26" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`M ${pts.join(' L ')} L ${SPARK_W - pad},${SPARK_H} L ${pad},${SPARK_H} Z`}
        fill="url(#feedHighlightFill)"
      />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The challenge variant gets a bar, not a line: it is the one metric with a
 *  target, and a bar against a target is read instantly. */
function TargetBar({ current, target }: { current: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 0;
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <rect x="16" y="56" width={SPARK_W - 32} height="11" rx="5.5" fill="#fff" opacity="0.28" />
      <rect x="16" y="56" width={((SPARK_W - 32) * pct) / 100} height="11" rx="5.5" fill="#fff" />
    </svg>
  );
}

export function FeedHighlightCard() {
  const t = useTranslations('feedHighlight');
  const locale = useLocale();
  const [highlight, setHighlight] = useState<FeedHighlight | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFeedHighlight()
      .then(({ highlight: h }) => { if (!cancelled) setHighlight(h); })
      // Silent: the feed below is the page, and this card failing is not news.
      .catch(() => { /* no card */ });
    return () => { cancelled = true; };
  }, []);

  if (!highlight) return null;

  const look = LOOKS[highlight.kind];
  const Icon = look.icon;

  // ── the four sentences ──────────────────────────────────────────────────────
  let eyebrow: string;
  let badge: string | null = null;
  let headline: string;
  let explain: string;
  let cta: string;
  let chart: React.ReactNode;

  switch (highlight.kind) {
    case 'challenge': {
      const c = highlight.challenge!;
      const name = locale === 'he' ? c.nameHe : c.nameEn;
      const unit = t(`unit_${c.metric}` as 'unit_distance_km');
      eyebrow = name;
      badge = c.daysLeft === 0 ? t('lastDay') : t('daysLeft', { count: c.daysLeft });
      headline = t('challengeHeadline', { current: c.current, target: c.target, unit });
      explain = c.onTrack
        ? t('challengeOnTrack', { remaining: Math.round((c.target - c.current) * 10) / 10, unit })
        : t('challengeBehind', { remaining: Math.round((c.target - c.current) * 10) / 10, unit });
      cta = t('challengeCta');
      chart = <TargetBar current={c.current} target={c.target} />;
      break;
    }
    case 'activeDays': {
      const a = highlight.activeDays!;
      eyebrow = t('progressEyebrow');
      badge = t('windowDays', { count: a.window });
      headline = t('activeDaysHeadline', { count: a.days });
      explain = a.isBest
        ? t('activeDaysBest', { count: a.days, window: a.window })
        : t('activeDaysExplain', { count: a.days, window: a.window });
      cta = t('statsCta');
      chart = <Spark values={highlight.spark} mode="line" />;
      break;
    }
    case 'streak': {
      const s = highlight.streak!;
      eyebrow = t('streakEyebrow');
      badge = s.longest > s.weeks ? t('streakBest', { count: s.longest }) : null;
      headline = t('streakHeadline', { count: s.weeks });
      explain = t('streakExplain', { count: s.weeks });
      cta = t('statsCta');
      chart = <Spark values={highlight.spark} mode="bars" />;
      break;
    }
    case 'volume': {
      const v = highlight.volume!;
      eyebrow = t('weekEyebrow');
      badge = v.averageKm > 0 ? t('vsAverage') : null;
      headline = t('volumeHeadline', { km: v.km });
      // ±3% is inside the noise of one extra warm-up lap; below that the honest
      // sentence is "level", not a direction.
      explain =
        v.averageKm <= 0
          ? t('volumeNoAverage', { km: v.km })
          : v.deltaPct >= 3
            ? t('volumeAbove', { pct: Math.abs(v.deltaPct), average: v.averageKm, weeks: VOLUME_TREND_WEEKS })
            : v.deltaPct <= -3
              ? t('volumeBelow', { pct: Math.abs(v.deltaPct), average: v.averageKm, weeks: VOLUME_TREND_WEEKS })
              : t('volumeLevel', { average: v.averageKm, weeks: VOLUME_TREND_WEEKS });
      cta = t('statsCta');
      chart = <Spark values={highlight.spark} mode="bars" />;
      break;
    }
  }

  return (
    <Link
      href={look.href}
      className="block bg-card rounded-card border border-page overflow-hidden active:scale-[0.99] transition-transform"
      aria-label={`${headline} — ${explain}`}
    >
      <div className={`relative h-[104px] bg-gradient-to-br ${look.hero}`}>
        {chart}
        <span className="absolute top-3 start-4 flex items-center gap-1.5 text-xs font-bold text-card/95">
          <Icon className="h-3.5 w-3.5" />
          <span className="truncate max-w-[190px]">{eyebrow}</span>
        </span>
        {badge && (
          <span className="absolute top-2.5 end-3.5 rounded-pill bg-card/20 px-2.5 py-[3px] text-[10.5px] font-bold text-card">
            {badge}
          </span>
        )}
      </div>

      <div className="flex gap-3 px-4 pt-4">
        <div
          className={`shrink-0 grid place-items-center w-10 h-10 rounded-full border ${look.iconTint}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <p className="text-[22px] leading-tight font-black text-ink-900 tabular-nums">{headline}</p>
          <p className="mt-1 text-13 text-ink-500 leading-relaxed">{explain}</p>
        </div>
      </div>

      <div
        className={`m-4 flex items-center justify-center gap-1.5 rounded-pill py-2.5 text-13 font-bold ${look.cta}`}
      >
        {cta}
        <ChevronRight className="h-4 w-4 rtl:rotate-180" />
      </div>
    </Link>
  );
}
