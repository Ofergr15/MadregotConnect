'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ClipboardList, Newspaper, User } from 'lucide-react';
import { useOnboarding, markOnboarding } from '@/lib/onboarding/use-onboarding';
import { TOUR_HOME, canStartTour, tourExitTarget } from '@/lib/onboarding/first-run-order';
import { FIRST_RUN_EVENT, readFirstRunStage, setFirstRunStage } from '@/lib/onboarding/first-run-flow';
import { useOnboardingV2 } from '@/lib/install/v2';
import { useInstallStep } from './InstallStepProvider';
import { useApi } from '@/lib/api';
import { APP_VERSION } from '@/lib/version';
import type { WhatsNewRelease } from '@/lib/release-notes';
import { tourLatest, type TourLatestItem } from '@/lib/whats-new/tour-latest';
import { WHATS_NEW_KEY, markSeen, readWhatsNewLedger } from '@/lib/whats-new/ledger';
import { trackOnb } from '@/lib/onboarding/track';
import { JOURNEY, JourneyCard, JourneyHero, JourneyRow, JourneyScreen, PrimaryButton } from './journey-ui';

// ═════════════════════════════════════════════════════════════════════════════
// The first-run guided tour. Runs once, ever (onboarding_tour_seen_at), for
// everyone — all 28 club members are on the platform but none has been shown
// around it, so "new members only" would mean 26 of them never get this.
//
// A welcome sheet naming the four screens, then a spotlight over the real tabs —
// feed → program (or academy) → profile — one line each, then "what's new
// lately", ending on the feed.
//
// It used to run on /dashboard/profile and spotlight cards there ("your next
// workout") while the profile tab was the one lit up, and it ended on the
// profile (journey audit, 2026-10-10). The tabs are on every screen, on the
// phone in the BottomTabBar and on a computer in the Header's nav — both carry
// `data-tour="tab-<tab>"`, and the tour picks whichever copy is visible.
//
// It never taps anything on the athlete's behalf and it writes nothing except
// the "seen" stamp. Skippable at every step.
//
// The spotlight is drawn as an empty div positioned over the target with
// `box-shadow: 0 0 0 9999px`, so the target itself is never touched — no cloning
// it into a portal (which would show stale data) and no mutating its styles
// (which would leak if the tour unmounted mid-step).
// ═════════════════════════════════════════════════════════════════════════════

interface TourStep {
  /** Matches a `data-tour` attribute in the DOM. */
  anchor: string;
  titleKey: string;
  bodyKey: string;
  /** Corner radius of the cut-out. Absent: read off the element (a round header
   *  button and a square tab-bar slot need different ones). */
  radius?: number;
  /** Fixed elements must not be scrolled to — scrollIntoView on the tab bar
   *  yanks the page for no reason, since it's already in view by definition. */
  isFixed?: boolean;
}

// An academy member's bar has Academy where Program would be (nav-items
// athletePrimaryOrder); whichever of the two is on screen is the one shown.
const STEPS: TourStep[] = [
  { anchor: 'tab-feed', titleKey: 'tourTabFeedTitle', bodyKey: 'tourTabFeedBody', isFixed: true },
  { anchor: 'tab-program', titleKey: 'tourTabProgramTitle', bodyKey: 'tourTabProgramBody', isFixed: true },
  { anchor: 'tab-academy', titleKey: 'tourTabAcademyTitle', bodyKey: 'tourTabAcademyBody', isFixed: true },
  { anchor: 'tab-profile', titleKey: 'tourTabProfileTitle', bodyKey: 'tourTabProfileBody', isFixed: true },
];

/**
 * The VISIBLE element carrying an anchor. Each tab is in the DOM twice — the
 * Header's nav (hidden below md) and the BottomTabBar (md:hidden) — and a plain
 * querySelector would return the hidden header copy on a phone.
 */
function findAnchor(anchor: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`));
  return all.find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null;
}

/** Padding around the highlighted element, so the cut-out breathes. */
const HOLE_PAD = 4;
/** Roughly how tall a callout gets — decides whether it sits above or below. */
const CALLOUT_H = 210;
/** How long to let the screen (and the nav's permission read) land before snapshotting. */
const SETTLE_MS = 900;
/** The nav renders once its permissions resolve; look again this many times before giving up. */
const SETTLE_TRIES = 3;

// The four athlete tabs, in the order the tab bar reads them
// (BottomTabBar's ATHLETE_PRIMARY_ORDER), with the same icons and the same names
// as the bar itself — the point of this sheet is that the bar becomes readable,
// which a different set of words for the same tab would undo.
const WELCOME_SCREENS = [
  { icon: Newspaper, labelKey: 'tourScreenFeed', bodyKey: 'tourScreenFeedBody' },
  { icon: ClipboardList, labelKey: 'tourScreenProgram', bodyKey: 'tourScreenProgramBody' },
  { icon: User, labelKey: 'tourScreenProfile', bodyKey: 'tourScreenProfileBody' },
];

type Phase = 'idle' | 'welcome' | 'preparing' | 'steps' | 'latest' | 'done';

export function FirstRunTour({ onActiveChange }: { onActiveChange?: (active: boolean) => void }) {
  const t = useTranslations('setup');
  const router = useRouter();
  const pathname = usePathname();
  const { data, mutate } = useOnboarding();
  const { answered: installAnswered } = useInstallStep();

  const [phase, setPhase] = useState<Phase>('idle');

  const v2 = useOnboardingV2();

  const [stageTick, setStageTick] = useState(0);
  /** The steps whose anchors actually exist, snapshotted once. */
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  // The tour's last screen: what's new lately, straight from What's new
  // (lib/whats-new/tour-latest) — nothing to keep up to date by hand.
  const locale = useLocale();
  const { data: wn } = useApi<{ releases: WhatsNewRelease[] }>('/api/whats-new', { revalidateOnFocus: false });
  const latest: TourLatestItem[] = useMemo(
    () => (wn ? tourLatest(wn.releases ?? [], APP_VERSION, locale === 'en' ? 'en' : 'he') : []),
    [wn, locale],
  );
  const [exitTarget, setExitTarget] = useState<string | null>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number; radius: number } | null>(null);

  // Arm on the first read that says this person hasn't seen it — and not before
  // the install step has been answered ("add to the home screen, THEN start
  // setting things up"; see first-run-order.ts). `phase` guards re-arming: once
  // dismissed, a later revalidate must not bring it back.

  // FirstRunFlow announces its hand-off; re-check then rather than on the next render.
  useEffect(() => {
    const on = () => setStageTick((n) => n + 1);
    window.addEventListener(FIRST_RUN_EVENT, on);
    return () => window.removeEventListener(FIRST_RUN_EVENT, on);
  }, []);

  useEffect(() => {
    onActiveChange?.(phase === 'welcome' || phase === 'preparing' || phase === 'steps' || phase === 'latest');
  }, [phase, onActiveChange]);

  const finish = useCallback(async () => {
    setPhase('done');
    // Ends FirstRunFlow's sequence (onboarding v2). Harmless when v2 is off: nothing
    // reads the stage then.
    const id = localStorage.getItem('athlete_id');
    if (id) setFirstRunStage(id, 'done');
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

  useEffect(() => {
    if (phase !== 'idle') return;
    if (!canStartTour(data, installAnswered)) return;
    // Onboarding v2: the tour is step two of FirstRunFlow's sequence. It waits for
    // the hand-off, and skips its own welcome sheet — the flow already welcomed them.
    if (v2) {
      if (readFirstRunStage(localStorage.getItem('athlete_id')) !== 'tour') return;
      start();
      return;
    }
    setPhase('welcome');
  }, [data, phase, installAnswered, v2, stageTick, start]);

  // Snapshot which steps are real. Done once, after the destination screen has
  // had a moment to render, so the "3 of 4" counter can't claim a step that will
  // never appear: the tab bar is md:hidden (absent on desktop) and both the
  // workout card and the week strip are absent for an athlete with no plan yet.
  useEffect(() => {
    if (phase !== 'preparing') return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      tries += 1;
      const present = STEPS.filter((step) => findAnchor(step.anchor));
      if (present.length === 0) {
        if (tries < SETTLE_TRIES) { timer = setTimeout(look, SETTLE_MS); return; }
        finish();
        return;
      }
      setSteps(present);
      setIndex(0);
      setPhase('steps');
      trackOnb('tour_start', { once: true, meta: { steps: present.length } });
    };
    timer = setTimeout(look, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [phase, finish]);

  /** End on "what's new lately" when there is any. True when it took over. */
  const toLatest = useCallback((target: string | null) => {
    if (latest.length === 0) return false;
    // Shown here, so the What's new sheet does not announce the same three again.
    try {
      const ledger = readWhatsNewLedger(localStorage.getItem(WHATS_NEW_KEY));
      localStorage.setItem(WHATS_NEW_KEY, JSON.stringify(markSeen(ledger, latest.map((i) => i.slug))));
    } catch { /* private mode */ }
    setExitTarget(target);
    setPhase('latest');
    trackOnb('latest_shown', { meta: { slugs: latest.map((i) => i.slug) } });
    return true;
  }, [latest]);

  const advance = useCallback(() => {
    if (index + 1 < steps.length) {
      setIndex(index + 1);
      return;
    }
    // Ending on the setup card used to leave the athlete facing a card they
    // still had to find and tap themselves; now the last press opens the
    // checklist itself (see tourExitTarget).
    const target = tourExitTarget(steps, index);
    trackOnb('tour_done');
    if (toLatest(target)) return;
    if (target) router.push(target);
    finish();
  }, [index, steps, finish, router, toLatest]);

  /** "Skip" mid-tour still ends on what's new: one screen, and nobody misses the launch's news. */
  const skip = useCallback(() => {
    trackOnb('tour_skipped', { meta: { at: index + 1, of: steps.length } });
    if (!toLatest(null)) finish();
  }, [toLatest, finish, index, steps.length]);

  const leaveLatest = useCallback((href?: string) => {
    // "לפיד, בואו נרוץ" lands on the feed — the first run ends there.
    const to = href || exitTarget || (pathname !== TOUR_HOME ? TOUR_HOME : null);
    if (to) router.push(to);
    finish();
  }, [exitTarget, finish, router, pathname]);

  const step = phase === 'steps' ? steps[index] : null;

  // Bring the target into view once per step.
  useEffect(() => {
    if (!step || step.isFixed) return;
    findAnchor(step.anchor)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
      const el = findAnchor(step.anchor);
      const r = el?.getBoundingClientRect();
      const css = el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 : 0;
      const next = r ? { top: r.top, left: r.left, width: r.width, height: r.height, radius: Math.max(css, 16) } : null;
      const sig = next ? `${Math.round(next.top)}:${Math.round(next.left)}:${Math.round(next.width)}:${Math.round(next.height)}:${Math.round(next.radius)}` : '';
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
  if (phase === 'latest') {
    // The tour's last screen in the journey's one look (journey-ui): the sunset
    // header, one card per item with its own icon and a chevron that says it
    // opens, and the one primary pill back to the feed.
    return (
      <div className="fixed inset-0 z-[60] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="tour-latest-title" data-testid="tour-latest">
        <JourneyScreen
          hero={<JourneyHero compact eyebrow={t('tourLatestKicker')} title={<span id="tour-latest-title">{t('tourLatestTitle')}</span>} subtitle={t('tourLatestBody')} />}
          actions={<PrimaryButton onClick={() => leaveLatest()}>{t('tourLatestDone')}</PrimaryButton>}
        >
          {latest.map((item) => (
            <button key={item.slug} type="button" onClick={() => { trackOnb('latest_clicked', { meta: { slug: item.slug } }); leaveLatest(item.href); }} className="block w-full text-start active:opacity-70">
              <JourneyCard className="border border-[#EDE3DC] py-2">
                <JourneyRow
                  icon={item.icon}
                  title={item.title}
                  sub={item.body}
                  end={<ChevronLeft className="mt-2.5 h-5 w-5 shrink-0" style={{ color: JOURNEY.muted }} aria-hidden />}
                />
              </JourneyCard>
            </button>
          ))}
        </JourneyScreen>
      </div>
    );
  }

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
            className="mt-1.5 flex min-h-[46px] w-full items-center justify-center text-[15px] font-bold underline underline-offset-2"
            style={{ color: JOURNEY.soft }}
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
  // Width and x. On a phone this is the full width less the 18px gutters, exactly
  // as before. On a computer it used to be the WHOLE window (1400px of copy under
  // a 520px column); now it is the target's width (360..560), centred under it.
  const calloutW = Math.min(viewportW - 36, Math.max(hole?.width ?? 0, 360), 560);
  const calloutLeft = hole
    ? Math.min(Math.max(hole.left + hole.width / 2 - calloutW / 2, 18), viewportW - 18 - calloutW)
    : (viewportW - calloutW) / 2;
  const placedStyle: React.CSSProperties = { ...calloutStyle, left: calloutLeft, width: calloutW };

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
            borderRadius: step.radius ?? (box ? box.radius + HOLE_PAD : 16),
            // Neutral ink, not the old navy: the scrim STAYS dark (a spotlight tour needs
            // the cut-out to be the only lit thing on screen) but it now dims towards the
            // light system's ink-900 rather than a blue-black. The cut-out itself is
            // edged with a thin white ring — the old thick grey frame (the page showing
            // through a wide padding) read as a second card around the target.
            boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.95), 0 0 0 9999px rgba(29, 30, 38, 0.78)',
          }}
        />
      ) : (
        // The anchor vanished mid-step (a re-render, or data that emptied out).
        // Dim everything and keep the copy rather than dropping the step — the
        // words still make sense, and the tour must not deadlock.
        <div className="absolute inset-0 bg-ink-900/[0.78]" />
      )}

      <div
        className="absolute rounded-[20px] bg-card px-4 py-3.5 text-start shadow-[0_18px_40px_-14px_rgba(0,0,0,0.6)]"
        style={placedStyle}
      >
        <span
          aria-hidden="true"
          className="absolute h-3.5 w-3.5 rotate-45 bg-card"
          style={below ? { top: -7, left: arrowLeft - calloutLeft } : { bottom: -7, left: arrowLeft - calloutLeft }}
        />
        <p className="text-13 font-bold" style={{ color: JOURNEY.tag }}>
          {t('tourStepOf', { step: index + 1, total: steps.length })}
        </p>
        <h3 className="mt-1 text-[18px] font-black" style={{ color: JOURNEY.ink }}>{t(step.titleKey)}</h3>
        <p className="mt-1 text-[15px] leading-relaxed" style={{ color: JOURNEY.soft }}>{t(step.bodyKey)}</p>

        <div className="mt-3.5 flex items-center gap-2.5">
          <span className="me-auto flex items-center gap-1.5">
            {steps.map((s, i) => (
              <span
                key={s.anchor}
                className={i === index ? 'block h-1.5 w-4 rounded-pill' : 'block h-1.5 w-1.5 rounded-full'}
                style={{ background: i === index ? JOURNEY.dusk : JOURNEY.line }}
              />
            ))}
          </span>
          {index + 1 < steps.length && (
            <button type="button" onClick={skip} className="min-h-[44px] px-3 text-[15px] font-bold underline underline-offset-2" style={{ color: JOURNEY.soft }}>
              {t('tourSkip')}
            </button>
          )}
          <button
            type="button"
            onClick={advance}
            className="inline-flex min-h-[44px] items-center rounded-full px-6 text-[15px] font-black text-white active:opacity-90"
            style={{ background: `linear-gradient(135deg, ${JOURNEY.dusk} 0%, #5B3FC4 100%)` }}
          >
            {index + 1 < steps.length ? t('tourNext') : t('tourFinish')}
          </button>
        </div>
      </div>
    </div>
  );
}
