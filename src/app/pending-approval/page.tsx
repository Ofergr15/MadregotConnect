'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { signOutEverywhere } from '@/lib/auth/sign-out';
import { apiHeaders } from '@/lib/api';
import { Spinner } from '@/components/ui';
import { ApprovalPushOptIn } from '@/components/PushOptIn';
import ClaimExistingAccount from '@/components/ClaimExistingAccount';
import { InstallStepProvider } from '@/components/onboarding/InstallStepProvider';
import { useIsComputer } from '@/lib/install/use-computer';
import {
  JOURNEY, JourneyCard, JourneyHero, JourneyRow, JourneyScreen, JourneyTracker, NextCard, SecondaryButton,
} from '@/components/onboarding/journey-ui';
import { ApprovalEmailOptIn } from '@/components/onboarding/ApprovalEmailOptIn';

// How often to ask whether they have been let in yet. The (app) layout uses 30s
// for the same question on the same endpoint; this screen is faster because it is
// the only thing the person is looking at, and the wait is measured in the seconds
// between an approver's press and their own screen changing.
const POLL_MS = 12_000;

/**
 * The waiting screen — and, until this rewrite, a dead end.
 *
 * What it did wrong, all of it observed on production 2026-09-07:
 *
 *  1. It never re-checked anything. A person approved while looking at this screen
 *     stayed on it indefinitely; the real last step of joining the club was "close
 *     the app and open it again", which nobody thinks to do and nothing suggested.
 *     Its own copy made that worse by promising an email — and for a Strava sign-in
 *     there IS no address to mail (the row is keyed on strava_<id>@…local), so the
 *     one instruction on screen was to go and wait for something that could not
 *     arrive. It now polls and forwards itself, and says so instead.
 *
 *  2. It could not offer "add to home screen". InstallStepProvider and
 *     InstallPrompt are mounted only in (app)/layout, which this route is not
 *     inside — so useInstallStep() fell through to its FALLBACK ("answered: true,
 *     canOffer: false") and no install offer was reachable here at all. On an
 *     iPhone that also silently disabled the push offer below, because a
 *     subscription made from a Safari tab is page-origin forever and PushOptIn
 *     refuses to create one. Net effect on the single most common device: a screen
 *     that offered nothing, told you to wait for an email that was never sent, and
 *     could not notify you either way.
 *
 * Both waiting screens now behave the same way, which is the other half of the
 * fix: AccessBlocked('pending') polls in the (app) shell and this one polls here.
 */
function PendingApproval() {
  const t = useTranslations('onboarding');
  const [lettingIn, setLettingIn] = useState(false);
  // On a computer there is nothing to install: the tracker drops that step.
  const computer = useIsComputer();

  const handleBackHome = async () => {
    await signOutEverywhere();
    window.location.href = '/';
  };

  // Poll /api/auth/me — the same endpoint and the same `membership` answer the
  // (app) layout blocks on, so the two screens cannot disagree about who is a
  // member. Written by hand rather than with useApi because the interesting event
  // is a one-way transition (not-active → active) that ends in a full page load,
  // not a re-render, and because it must survive the answer changing shape.
  //
  // Why a whole page load and not router.push: this session's identity is cached
  // in localStorage by /auth/resolve, and after an admin LINK the row it points at
  // no longer exists — it was merged away (migration 097). Landing on /feed with a
  // stale athlete_id would show a working shell full of failed reads. Going through
  // '/' re-resolves the identity first, which is the only correct entry.
  const stopped = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      if (stopped.current) return;
      try {
        const res = await fetch('/api/auth/me', { headers: await apiHeaders(true) });
        if (res.ok) {
          const data = (await res.json()) as { membership?: string };
          if (data.membership === 'active') {
            stopped.current = true;
            setLettingIn(true);
            window.location.href = '/';
            return;
          }
        }
      } catch {
        // Offline, or the endpoint is having a bad minute. Say nothing and ask
        // again — a failed poll is not news, and an error on this screen would
        // read as "your approval failed".
      }
      timer = setTimeout(check, POLL_MS);
    };

    check();
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // The same screen as "we got it" (register/RegisterReceived): one look, one
  // tracker, nothing to do but wait — and the install guide is NOT here: it is
  // shown once, after approval (journey spec 2026-10-10).
  return (
    <>
      <JourneyScreen
        testId="pending-approval"
        hero={<JourneyHero eyebrow={t('pendingEyebrow')} title={t('pendingTitle')} subtitle={t('pendingSubtitle')} />}
      >
        <JourneyTracker done={1} computer={computer} />
        <NextCard label={t('pendingNextLabel')} title={t('pendingNextTitle')}>{t('pendingNextBody')}</NextCard>

        {/* The promise the screen can actually keep, in place of the email it
            couldn't send. Swaps to "letting you in" for the moment between the
            poll answering and the page navigating, so the last thing they see is
            an explanation rather than an unexplained reload. */}
        <p className="flex items-center justify-center gap-2 text-center text-[13px]" style={{ color: JOURNEY.soft }} dir="rtl">
          {lettingIn ? (
            <>
              <Spinner size={12} tone="ink" />
              {t('approvalLettingYouIn')}
            </>
          ) : (
            t('approvalWatching')
          )}
        </p>

        <JourneyCard>
          <JourneyRow icon="⌚" title={t('pendingWatchTitle')} sub={t('pendingWatchSub')} />
        </JourneyCard>

        {/* For the one member nothing else can reach: a Strava sign-in has no real
            address, and an iPhone Safari tab gets no push (analysis 2026-10-10).
            Renders only when the address on file is synthetic. */}
        <ApprovalEmailOptIn />

        {/* Last, because for some of the people reading this screen it is simply
            wrong: they are already members, and the only reason they are here is
            that their Strava name could not be matched to their roster row. This
            is their way back to their own account without anybody's help. */}
        <JourneyCard className="py-3 [&>div]:mt-0 [&>div]:border-t-0 [&>div]:pt-0">
          <ClaimExistingAccount />
        </JourneyCard>
        {/* Nothing to press while waiting. The one way out says what it does: it
            signs out (it used to read "back to the home page"). */}
        <SecondaryButton onClick={handleBackHome}>{t('pendingSignOut')}</SecondaryButton>
      </JourneyScreen>
      <ApprovalPushOptIn />
    </>
  );
}

export default function PendingApprovalPage() {
  // The provider this route was missing. Everything about the install step is
  // device-local state plus one `beforeinstallprompt` listener, so mounting a
  // second provider outside the (app) shell costs nothing and is what makes the
  // push offer function here at all. (The install box itself is gone from this
  // screen: the guide is shown once, after approval.)
  return (
    <InstallStepProvider>
      <PendingApproval />
    </InstallStepProvider>
  );
}
