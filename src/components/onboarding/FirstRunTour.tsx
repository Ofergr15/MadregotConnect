'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, ClipboardList, Newspaper, User } from 'lucide-react';
import { useOnboarding, markOnboarding } from '@/lib/onboarding/use-onboarding';

// ═════════════════════════════════════════════════════════════════════════════
// The first-run guided tour. Runs once, ever (onboarding_tour_seen_at), for
// everyone — all 28 club members are on the platform but none has been shown
// around it, so "new members only" would mean 26 of them never get this.
//
// A welcome sheet naming the four screens, then a spotlight over each of a few
// things that are ACTUALLY on the page, then a hand-off to the setup card, which
// is the one piece that outlives the tour.
//
// It never taps anything on the athlete's behalf and it writes nothing except
// the "seen" stamp. Skippable at every step.
//
// The spotlight is drawn as an empty div positioned over the target with
// `box-shadow: 0 0 0 9999px`, so the target itself is never touched — no cloning
// it into a portal (which would show stale data) and no mutating its styles
// (which would leak if the tour unmounted mid-step).
// ═════════════════════════════════════════════════════════════════════════════

/** Where the tour runs. Anywhere else and step 1 would have nothing to point at. */
const TOUR_HOME = '/dashboard/profile';

interface TourStep {
  /** Matches a `data-tour` attribute in the DOM. */
  anchor: string;
  titleKey: string;
  bodyKey: string;
  /** Corner radius of the cut-out, matching the element underneath. */
  radius: number;
  /** Fixed elements must not be scrolled to — scrollIntoView on the tab bar
   *  yanks the page for no reason, since it's already in view by definition. */
  isFixed?: boolean;
}

const STEPS: TourStep[] = [
  { anchor: 'upcomingWorkout', titleKey: 'tourWorkoutTitle', bodyKey: 'tourWorkoutBody', radius: 25 },
  { anchor: 'weekStrip', titleKey: 'tourWeekTitle', bodyKey: 'tourWeekBody', radius: 14 },
  { anchor: 'tabbar', titleKey: 'tourTabsTitle', bodyKey: 'tourTabsBody', radius: 0, isFixed: true },
  { anchor: 'setupCard', titleKey: 'tourSetupTitle', bodyKey: 'tourSetupBody', radius: 25 },
];

/** Padding around the highlighted element, so the cut-out breathes. */
const HOLE_PAD = 6;
/** Roughly how tall a callout gets — decides whether it sits above or below. */
const CALLOUT_H = 190;
/** How long to let the profile screen's own reads land before snapshotting. */
const SETTLE_MS = 900;

// The four athlete tabs, in the order the tab bar reads them
// (BottomTabBar's ATHLETE_PRIMARY_ORDER), with the same icons and the same names
// as the bar itself — the point of this sheet is that the bar becomes readable,
// which a different set of words for the same tab would undo.
const WELCOME_SCREENS = [
  { icon: Newspaper, labelKey: 'tourScreenFeed', bodyKey: 'tourScreenFeedBody' },
  { icon: Activity, labelKey: 'tourScreenDashboard', bodyKey: 'tourScreenDashboardBody' },
  { icon: ClipboardList, labelKey: 'tourScreenProgram', bodyKey: 'tourScreenProgramBody' },
  { icon: User, labelKey: 'tourScreenProfile', bodyKey: 'tourScreenProfileBody' },
];

type Phase = 'idle' | 'welcome' | 'preparing' | 'steps' | 'done';

export function FirstRunTour({ onActiveChange }: { onActiveChange?: (active: boolean) => void }) {
  const t = useTranslations('setup');
  const router = useRouter();
  const pathname = usePathname();
  const { data, mutate } = useOnboarding();

  const [phase, setPhase] = useState<Phase>('idle');
  /** The steps whose anchors actually exist, snapshotted once. */
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // Arm on the first read that says this person hasn't seen it. `phase` guards
  // re-arming: once dismissed, a later revalidate must not bring it back.
  useEffect(() => {
    if (phase !== 'idle' || !data || !data.applicable || data.tourSeen) return;
    setPhase('welcome');
  }, [data, phase]);

  useEffect(() => {
    onActiveChange?.(phase === 'welcome' || phase === 'preparing' || phase === 'steps');
  }, [phase, onActiveChange]);

  const finish = useCallback(async () => {
    setPhase('done');
    // Fire and forget by design: the tour is already gone from the screen. A
    // failure here (including the 501 before migration 078 is applied) just
    // means it replays next time, which beats blocking a dismissal on a write.
    await markOnboarding({ markTourSeen: true });
    mutate();
  }, [mutate]);

  const start = useCallback(() => {
    setPhase('preparing');
    if (pathname !== TOUR_HOME) router.push(TOUR_HOME);
  }, [pathname, router]);

  // Snapshot which steps are real. Done once, after the destination screen has
  // had a moment to render, so the "3 of 4" counter can't claim a step that will
  // never appear: the tab bar is md:hidden (absent on desktop) and both the
  // workout card and the week strip are absent for an athlete with no plan yet.
  useEffect(() => {
    if (phase !== 'preparing') return;
    const timer = setTimeout(() => {
      const present = STEPS.filter((step) => document.querySelector(`[data-tour="${step.anchor}"]`));
      if (present.length === 0) {
        finish();
        return;
      }
      setSteps(present);
      setIndex(0);
      setPhase('steps');
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [phase, finish]);

  const advance = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= steps.length) {
        finish();
        return i;
      }
      return i + 1;
    });
  }, [steps.length, finish]);

  const step = phase === 'steps' ? steps[index] : null;

  // Bring the target into view once per step.
  useEffect(() => {
    if (!step || step.isFixed) return;
    document.querySelector(`[data-tour="${step.anchor}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [step]);

  // Track the target every frame so the cut-out stays glued to it through the
  // smooth scroll above, through SWR swapping in fresh data, and through any
  // layout shift. Only commits to state when the rounded rect actually moves, so
  // this is not a 60fps re-render.
  const lastSig = useRef('');
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    const tick = () => {
      const el = document.querySelector(`[data-tour="${step.anchor}"]`);
      const r = el?.getBoundingClientRect();
      const next = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      const sig = next ? `${Math.round(next.top)}:${Math.round(next.left)}:${Math.round(next.width)}:${Math.round(next.height)}` : '';
      if (sig !== lastSig.current) {
        lastSig.current = sig;
        setBox(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  if (phase === 'idle' || phase === 'done') return null;

  // ── Welcome ───────────────────────────────────────────────────────────────
  if (phase === 'welcome' || phase === 'preparing') {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col justify-end" dir="rtl">
        <div className="absolute inset-0 bg-ink-900/[0.86]" />
        <div className="relative max-h-[92dvh] overflow-y-auto rounded-t-card bg-card px-4 pb-6 pt-2.5 text-start">
          <div className="mx-auto mb-3.5 h-1 w-9 rounded-pill bg-ink-300" />
          <h2 className="text-xl font-bold text-ink-700">{t('tourWelcomeTitle')}</h2>
          <p className="mt-1.5 text-13 font-light leading-relaxed text-ink-400">{t('tourWelcomeBody')}</p>

          {WELCOME_SCREENS.map(({ icon: Icon, labelKey, bodyKey }) => (
            <div key={labelKey} className="mt-3.5 flex items-start gap-3">
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-brand-600/10">
                <Icon className="h-[17px] w-[17px] text-brand-600" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink-700">{t(labelKey)}</p>
                <p className="mt-0.5 text-xs font-light leading-relaxed text-ink-500">{t(bodyKey)}</p>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={start}
            disabled={phase === 'preparing'}
            className="mt-4 flex min-h-[48px] w-full items-center justify-center rounded-pill bg-brand-600 text-[15px] font-bold text-white active:bg-brand-700 disabled:opacity-60"
          >
            {t('tourStart')}
          </button>
          <button
            type="button"
            onClick={finish}
            className="mt-1.5 flex min-h-[40px] w-full items-center justify-center text-13 font-light text-ink-400"
          >
            {t('tourSkipWelcome')}
          </button>
        </div>
      </div>
    );
  }

  if (!step) return null;

  // ── Spotlight ─────────────────────────────────────────────────────────────
  const viewportH = typeof window === 'undefined' ? 0 : window.innerHeight;
  const viewportW = typeof window === 'undefined' ? 0 : window.innerWidth;
  const hole = box && {
    top: box.top - HOLE_PAD,
    left: box.left - HOLE_PAD,
    width: box.width + HOLE_PAD * 2,
    height: box.height + HOLE_PAD * 2,
  };
  // Below the target when there's room, otherwise above it. `18px` matches the
  // page's own gutter so the callout lines up with the content behind it.
  const below = !!hole && hole.top + hole.height + CALLOUT_H < viewportH;
  const calloutStyle: React.CSSProperties = hole
    ? below
      ? { top: hole.top + hole.height + 14 }
      : { bottom: viewportH - hole.top + 14 }
    : { bottom: 24 };
  // Arrow x is a viewport coordinate, so it needs no RTL mirroring — it points at
  // wherever the element physically is.
  const arrowLeft = hole ? Math.min(Math.max(hole.left + hole.width / 2 - 7, 30), viewportW - 44) : viewportW / 2 - 7;

  return (
    <div className="fixed inset-0 z-[60]" dir="rtl">
      {hole ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={t('tourNext')}
          onClick={advance}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); } }}
          className="absolute cursor-pointer"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            borderRadius: step.radius,
            // Neutral ink, not the old navy: the scrim STAYS dark (a spotlight tour needs
            // the cut-out to be the only lit thing on screen) but it now dims towards the
            // light system's ink-900 rather than a blue-black.
            boxShadow: '0 0 0 9999px rgba(29, 30, 38, 0.78)',
          }}
        />
      ) : (
        // The anchor vanished mid-step (a re-render, or data that emptied out).
        // Dim everything and keep the copy rather than dropping the step — the
        // words still make sense, and the tour must not deadlock.
        <div className="absolute inset-0 bg-ink-900/[0.78]" />
      )}

      <div
        className="absolute inset-x-[18px] rounded-[20px] bg-card px-4 py-3.5 text-start shadow-[0_18px_40px_-14px_rgba(0,0,0,0.6)]"
        style={calloutStyle}
      >
        <span
          aria-hidden="true"
          className="absolute h-3.5 w-3.5 rotate-45 bg-card"
          style={below ? { top: -7, left: arrowLeft - 18 } : { bottom: -7, left: arrowLeft - 18 }}
        />
        <p className="text-3xs font-bold tracking-wide text-brand-600">
          {t('tourStepOf', { step: index + 1, total: steps.length })}
        </p>
        <h3 className="mt-1 text-[17px] font-bold text-ink-700">{t(step.titleKey)}</h3>
        <p className="mt-1.5 text-13 font-light leading-relaxed text-ink-500">{t(step.bodyKey)}</p>

        <div className="mt-3.5 flex items-center gap-2.5">
          <span className="me-auto flex items-center gap-1.5">
            {steps.map((s, i) => (
              <span
                key={s.anchor}
                className={i === index ? 'block h-1.5 w-4 rounded-pill bg-brand-600' : 'block h-1.5 w-1.5 rounded-full bg-ink-300'}
              />
            ))}
          </span>
          {index + 1 < steps.length && (
            <button type="button" onClick={finish} className="min-h-[36px] px-1 text-xs font-light text-ink-400">
              {t('tourSkip')}
            </button>
          )}
          <button
            type="button"
            onClick={advance}
            className="inline-flex min-h-[36px] items-center rounded-pill bg-brand-600 px-4 text-13 font-bold text-white active:bg-brand-700"
          >
            {index + 1 < steps.length ? t('tourNext') : t('tourFinish')}
          </button>
        </div>
      </div>
    </div>
  );
}
