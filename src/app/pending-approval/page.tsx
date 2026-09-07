'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import { signOutEverywhere } from '@/lib/auth/sign-out';
import { apiHeaders } from '@/lib/api';
import { Card, EmptyState, Button, Spinner } from '@/components/ui';
import { ApprovalPushOptIn } from '@/components/PushOptIn';
import ClaimExistingAccount from '@/components/ClaimExistingAccount';
import { InstallStepProvider } from '@/components/onboarding/InstallStepProvider';
import { AddToHomeScreen } from '@/components/onboarding/AddToHomeScreen';

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

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <Card className="max-w-md text-center">
        <div className="flex items-center justify-center">
          <img src="/images/logo.png" alt="Madregot" className="h-10 w-10 object-contain brightness-0 invert" />
          <span className="text-lg font-bold text-ink-700 ms-3">Madregot</span>
        </div>

        <EmptyState
          icon={Clock}
          titleAs="h1"
          title={t('waitingApproval')}
          description={t('approvalMessage')}
          action={<Button variant="secondary" onClick={handleBackHome}>{t('backHome')}</Button>}
          className="mx-auto"
        />

        {/* The promise the screen can actually keep, in place of the email it
            couldn't send. Swaps to "letting you in" for the moment between the
            poll answering and the page navigating, so the last thing they see is
            an explanation rather than an unexplained reload. */}
        <p className="mt-1 flex items-center justify-center gap-2 text-xs font-light text-ink-400" dir="rtl">
          {lettingIn ? (
            <>
              <Spinner size={12} tone="ink" />
              {t('approvalLettingYouIn')}
            </>
          ) : (
            t('approvalWatching')
          )}
        </p>

        {/* Under the "waiting for approval" message, because for some of the people
            reading it that message is simply wrong: they are already members, and
            the only reason they are here is that their Strava name could not be
            matched to their roster row. This is their way back to their own
            account without anybody's help. */}
        <ClaimExistingAccount />

        {/* The one useful thing to do with the wait — and on iOS the precondition
            for ever being notified about anything, this approval included. */}
        <AddToHomeScreen />
      </Card>
      <ApprovalPushOptIn />
    </div>
  );
}

export default function PendingApprovalPage() {
  // The provider this route was missing. Everything about the install step is
  // device-local state plus one `beforeinstallprompt` listener, so mounting a
  // second provider outside the (app) shell costs nothing and is what makes both
  // AddToHomeScreen and the push offer function here at all.
  return (
    <InstallStepProvider>
      <PendingApproval />
    </InstallStepProvider>
  );
}
