'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldOff, Clock } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { getSupabase } from '@/lib/supabase/client';
import { signOutEverywhere } from '@/lib/auth/sign-out';
import type { BlockedMembership } from '@/lib/auth/membership';

/**
 * The door, when the person holding a valid session is not a member.
 *
 * There are three ways to be signed in and still not belong in the app, and the
 * server tells them apart in /api/auth/me's `membership` (see membershipFor):
 *   'none'     — the session verified, but no athletes row answers to its email
 *                (never joined, or their row was archived/renamed)
 *   'pending'  — a row that has never been approved: they just signed in for the
 *                first time and the coach has not let them in yet
 *   'inactive' — a row that was approved once and is not active now: access
 *                removed, or a /join that was never finished
 *
 * 'pending' and 'inactive' were one screen until a Strava sign-in started landing
 * as 'pending' — before that, the only way to be non-active was to have LOST
 * access, so "your access is not active, an admin can turn it back on" covered
 * both. It is the wrong first sentence to say to somebody who just joined, and it
 * sends them to ask for help with something that is simply in progress.
 *
 * The waiting screen is also the one the (app) layout re-polls, so it changes by
 * itself the moment the coach approves — which is why its copy promises that
 * instead of promising an email.
 *
 * Why this is a screen and not an error: before it, such an account got the
 * FULL signed-in shell — header, composer, tab bar — because the layout only
 * checked that a session existed. Every card inside then failed on its own, and
 * the feed printed the raw server string "No membership found for this account"
 * in English, under a "נסה שוב" button that could only ever fail again. A person
 * who has lost access needs one honest sentence and one thing to do.
 *
 * No Header and no BottomTabBar are rendered around this (see the (app) layout):
 * navigation you aren't allowed to use is a worse lie than no navigation.
 */
export function AccessBlocked({ membership }: { membership: BlockedMembership }) {
  const t = useTranslations('blocked');
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // WHICH account is blocked is the single most useful fact here: the common
  // cause is being signed in as the wrong one (a second Strava account, a work
  // Google). Synthetic addresses are hidden — `strava_1234@strava.madregot.local`
  // is an internal artefact and telling someone that is their email is a lie.
  useEffect(() => {
    getSupabase()
      .auth.getUser()
      .then(({ data }) => {
        const address = data?.user?.email || null;
        setEmail(address && !address.endsWith('.local') ? address : null);
      })
      .catch(() => {});
  }, []);

  const signOut = async () => {
    setSigningOut(true);
    // Clears the device cookie too, which is the part that used to be missing:
    // without it the landing page minted a new session on arrival and put them
    // straight back on this very screen.
    await signOutEverywhere();
    window.location.href = '/';
  };

  // One key prefix per state, so the three messages can't be mixed up by an
  // inverted boolean the way `pending ? … : …` was starting to.
  const state = membership === 'pending' ? 'pending' : membership === 'inactive' ? 'revoked' : 'none';
  // A clock means "this is in progress"; the crossed shield means "this is not".
  const Icon = state === 'pending' ? Clock : ShieldOff;

  return (
    <div className="min-h-[100dvh] bg-page flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <div className="flex items-center justify-center">
          <img src="/images/logo.png" alt="Madregot" className="h-9 w-9 object-contain" />
        </div>

        <div className="flex flex-col items-center px-2 pt-8 pb-2">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-card bg-page">
            <Icon className="h-6 w-6 text-ink-400" />
          </div>

          <h1 className="text-lg font-bold text-ink-700">{t(`${state}Title`)}</h1>
          <p className="mt-2 max-w-[300px] text-sm leading-relaxed text-ink-400">
            {t(`${state}Body`)}
          </p>

          {email && (
            // ltr + a tile, because an email address inside RTL Hebrew text
            // otherwise renders with its punctuation flipped to the wrong end.
            <p
              dir="ltr"
              className="mt-4 max-w-full truncate rounded-tile bg-page px-3 py-1.5 text-xs text-ink-500"
            >
              {email}
            </p>
          )}

          <div className="mt-6 flex w-full flex-col items-center gap-2">
            <Button onClick={signOut} disabled={signingOut} className="w-full max-w-[260px]">
              {signingOut ? t('signingOut') : t('switchAccount')}
            </Button>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">{t(`${state}Hint`)}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
