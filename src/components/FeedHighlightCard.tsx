'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Check, ChevronRight, X } from 'lucide-react';
import { fetchFeedHighlight } from '@/lib/feed-client';
import {
  WEEK_DAYS,
  weekRemainingKm,
  weekStatus,
  type FeedHighlight,
  type HighlightChallenge,
  type HighlightWeek,
  type WeekStatus,
} from '@/lib/feed/highlight';

/**
 * The card pinned at the top of the feed. It says two things and nothing else:
 *
 *  1. **This week's kilometres out of the week's target** — with the days of the
 *     week underneath, so "18 out of 40" is read against how much week is left.
 *  2. **The active challenge, and whether you've done it.**
 *
 * An earlier version rotated between four metrics. It was cut: a card that shows
 * something different every time you open the app teaches people not to read it.
 *
 * Renders nothing while loading and nothing when there is no highlight — a skeleton
 * in the top slot of the landing page would shove the feed down on every cold open,
 * which is worse than the card arriving a beat late.
 */

/**
 * Where the hidden-until-the-challenge-changes flag lives.
 *
 * A new key, not the old `…feedHighlight.dismissed`: that one keyed the whole card,
 * so anyone who had already tapped the X would have stayed hidden under the new
 * meaning without ever having asked for it.
 */
const DISMISS_KEY = 'madregot.feedHighlight.challengeDismissed';

/**
 * What the X hides, and for how long.
 *
 * The X used to sit on the week block and take the whole card with it. The week's
 * kilometres are the one number the feed exists to put in front of you — offering a
 * button that throws them away is the wrong affordance for it. So the X moved onto
 * the challenge, and hides nothing but the challenge.
 *
 * Dismissal is scoped, not permanent: a different challenge, or finishing the one
 * you're on, brings the section back. A permanent hide with no way to undo it is a
 * trap in an app with no settings screen for it, and "not right now" is almost
 * always what the tap means. `localStorage`, not the server — no migration, and it
 * is a per-device display preference, not data.
 */
function challengeKey(c: HighlightChallenge): string {
  return `${c.id}:${c.done ? 'done' : 'open'}`;
}

/** The status pill's colour. `behind` is deliberately not red — see below. */
const STATUS_LOOK: Record<WeekStatus, string> = {
  met: 'bg-accent-600/10 text-accent-600',
  onTrack: 'bg-brand-600/10 text-brand-600',
  // Muted ink, not accent-red. Being 8 km short on a Tuesday is the normal state of
  // a training week, not an error, and a red badge on the app's landing page every
  // midweek is how a nudge turns into something people learn to ignore.
  behind: 'bg-page text-ink-500',
  noTarget: 'bg-page text-ink-500',
};

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * The week as seven bars, Sunday first, with today marked.
 *
 * Scaled to the athlete's own biggest day rather than to the target, so a light
 * week still has shape. Days that haven't happened yet render as an empty track —
 * the point is to show how much week is left, which is the context that makes
 * "18 out of 40" mean something.
 */
function WeekBars({ week, label }: { week: HighlightWeek; label: (i: number) => string }) {
  const max = Math.max(...week.dailyKm, 1);
  return (
    <div className="mt-3 flex items-end gap-1.5" aria-hidden="true">
      {week.dailyKm.map((km, i) => {
        const future = i + 1 > week.daysElapsed;
        const today = i + 1 === week.daysElapsed;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full h-9 flex items-end rounded-tile bg-page overflow-hidden">
              <div
                className={`w-full rounded-tile ${km > 0 ? 'bg-brand-600' : ''}`}
                style={{ height: km > 0 ? `${Math.max(12, (km / max) * 100)}%` : 0 }}
              />
            </div>
            {/* Three legible weights instead of two-plus-a-hairline. A future
                day used to be ink-300, which is the border value (1.92:1) and
                is not a colour any text can be read in — aria-hidden hides
                this row from a screen reader but does nothing for the person
                squinting at it outdoors. Future stays the lightest of the
                three, so it still reads as "hasn't happened yet". */}
            <span
              className={`text-4xs ${today ? 'font-bold text-ink-700' : future ? 'text-ink-400' : 'text-ink-500'}`}
            >
              {label(i)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The challenge, as the card's second half.
 *
 * It used to be a 13px name over a 1px bar in the corner of the week card, which
 * read as a footnote — nobody's monthly 100 km is a footnote. So it gets its own
 * tinted panel, a 44px icon tile, its own eyebrow saying what it is, and a bar at
 * the same weight as the week's. Same one tap through to the challenges screen.
 *
 * Two colourways, one layout: band-3 (the challenge orange) while it's open,
 * accent green once it's done, so "finished" is legible at arm's length without
 * reading a word of it.
 */
function ChallengeRow({ challenge, onHide }: { challenge: HighlightChallenge; onHide: () => void }) {
  const t = useTranslations('feedHighlight');
  const locale = useLocale();
  const name = locale === 'he' ? challenge.nameHe : challenge.nameEn;
  const unit = t(`unit_${challenge.metric}` as 'unit_distance_km');
  const pct =
    challenge.target > 0
      ? Math.min(100, Math.max(0, (challenge.current / challenge.target) * 100))
      : 0;
  const done = challenge.done;

  // Ink on a wash of itself, per the band-N-ink / accent-900 note in the Tailwind
  // config — the plain band-3 fails AA on its own 5% tint.
  const look = done
    ? { panel: 'bg-accent-600/[0.07]', press: 'active:bg-accent-600/15', ink: 'text-accent-900', fill: 'bg-accent-600' }
    : { panel: 'bg-band-3/[0.07]', press: 'active:bg-band-3/15', ink: 'text-band-3-ink', fill: 'bg-band-3' };

  return (
    <div className={`relative ${look.panel}`}>
      {/* A sibling of the Link, not a child of it: a button nested inside an anchor
          is a tap you have to cancel to make work, and cancelling it is how you end
          up on the challenges screen when you meant to close the section. Declared
          after the Link so it paints above without needing a z-index. */}
      <button
        type="button"
        onClick={onHide}
        aria-label={t('dismissChallenge')}
        // Generous hit area on a small glyph — a missed tap opens the challenges
        // screen instead.
        // ink-400 rather than the ink-300 hairline value: an unlabelled glyph
        // is the entire control, so 1.92:1 isn't enough to find it.
        className="absolute top-1 end-1 grid place-items-center w-9 h-9 text-ink-400 active:text-ink-700"
      >
        <X className="h-4 w-4" />
      </button>

      <Link
        href="/dashboard/profile?tab=challenges"
        className={`block px-4 py-3.5 transition-colors ${look.press}`}
      >
        {/* pe-7 keeps the days-left pill and the chevron clear of the X. */}
        <div className="flex items-center gap-3 pe-7">
          <span
            className={`shrink-0 grid place-items-center w-11 h-11 rounded-tile bg-card text-xl ${
              done ? 'border border-accent-600/25' : 'border border-band-3/25'
            }`}
          >
            {challenge.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={challenge.iconUrl} alt="" className="w-6 h-6 object-contain" />
            ) : (
              challenge.icon
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p className={`text-4xs font-bold ${look.ink}`}>{t('challengeEyebrow')}</p>
            <p className="mt-0.5 truncate text-sm font-black leading-tight text-ink-900">{name}</p>
          </div>

          {done ? (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-pill bg-accent-600/15 px-2 py-1 text-4xs font-bold text-accent-900">
              <Check className="h-3 w-3" />
              {t('challengeDone')}
            </span>
          ) : (
            <span className="shrink-0 rounded-pill bg-card px-2 py-1 text-4xs font-bold text-ink-500 tabular-nums">
              {challenge.daysLeft === 0
                ? t('lastDay')
                : challenge.daysLeft === 1
                  ? t('oneDayLeft')
                  : t('daysLeftShort', { count: challenge.daysLeft })}
            </span>
          )}

          <ChevronRight className="shrink-0 h-4 w-4 text-ink-300 rtl:rotate-180" />
        </div>

        <div className="mt-3 h-2 rounded-pill bg-card overflow-hidden">
          <div className={`h-full rounded-pill ${look.fill}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-2xs text-ink-500 tabular-nums">
            {done
              ? t('challengeFinished')
              : t('challengeProgress', { current: challenge.current, target: challenge.target, unit })}
          </p>
          <span className={`shrink-0 text-2xs font-bold tabular-nums ${look.ink}`}>
            {Math.round(pct)}%
          </span>
        </div>
      </Link>
    </div>
  );
}

export function FeedHighlightCard() {
  const t = useTranslations('feedHighlight');
  const [highlight, setHighlight] = useState<FeedHighlight | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Read here rather than in an initialiser: this component mounts during SSR
    // hydration and localStorage doesn't exist there.
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY));
    } catch {
      // Private-mode Safari throws on localStorage. Then the card just shows.
    }
    fetchFeedHighlight()
      .then(({ highlight: h }) => { if (!cancelled) setHighlight(h); })
      // Silent: the feed below is the page, and this card failing is not news.
      .catch(() => { /* no card */ });
    return () => { cancelled = true; };
  }, []);

  if (!highlight) return null;

  const { week, challenge } = highlight;
  // The week half has no X at all. Only the challenge section can be hidden, and
  // only until the challenge itself changes.
  const chKey = challenge ? challengeKey(challenge) : null;
  const showChallenge = !!challenge && dismissed !== chKey;

  const hideChallenge = () => {
    if (!chKey) return;
    try {
      window.localStorage.setItem(DISMISS_KEY, chKey);
    } catch {
      // Can't persist it — still hide it for this session.
    }
    setDismissed(chKey);
  };

  const status = weekStatus(week);
  const bar = week.targetMin > 0 ? week.targetMin : week.targetMax;
  const pct = bar > 0 ? Math.min(100, Math.max(0, (week.km / bar) * 100)) : 0;
  const remaining = weekRemainingKm(week);
  const daysLeft = WEEK_DAYS - week.daysElapsed;

  // The sentence under the number. Built from keys rather than server-side so it
  // reads naturally in both languages.
  const explain =
    status === 'noTarget'
      ? t('weekNoTarget')
      : status === 'met'
        ? t('weekMet', { target: bar })
        : daysLeft === 0
          ? t('weekLastDay', { km: remaining })
          : t('weekRemaining', { km: remaining, days: daysLeft });

  return (
    <div className="bg-card rounded-card border border-page overflow-hidden">
      <Link href="/dashboard/profile?tab=statistics" className="block px-4 pt-3.5 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xs font-bold text-ink-400">{t('weekEyebrow')}</span>
          <span
            className={`rounded-pill px-2 py-[2px] text-4xs font-bold ${STATUS_LOOK[status]}`}
          >
            {t(`weekStatus_${status}` as 'weekStatus_met')}
          </span>
        </div>

        <p className="mt-1 flex items-baseline gap-1 text-ink-900 tabular-nums">
          <span className="text-28 font-black leading-none">{week.km}</span>
          {bar > 0 && (
            <span className="text-13 font-bold text-ink-400">
              {t('outOfTarget', { target: bar })}
            </span>
          )}
          <span className="text-13 font-bold text-ink-500">{t('unit_distance_km')}</span>
        </p>

        {bar > 0 && (
          <div className="mt-2.5 h-1.5 rounded-pill bg-page overflow-hidden">
            <div
              className={`h-full rounded-pill ${status === 'met' ? 'bg-accent-600' : 'bg-brand-600'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        <p className="mt-2 text-2xs text-ink-500">{explain}</p>

        <WeekBars week={week} label={(i) => t(`day_${DAY_KEYS[i]}` as 'day_sun')} />
      </Link>

      {showChallenge && challenge && (
        <>
          {/* Full-bleed, not inset: the challenge is a section of the card now,
              not a row appended to the week. */}
          <div className="border-t border-page" />
          <ChallengeRow challenge={challenge} onHide={hideChallenge} />
        </>
      )}
    </div>
  );
}
