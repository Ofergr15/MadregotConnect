'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldOff, Clock } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { getSupabase } from '@/lib/supabase/client';
import { clearIdentityKeys } from '@/lib/auth/identity-keys';

/**
 * The door, when the person holding a valid session is not a member.
 *
 * There are two ways to be signed in and still not belong in the app, and the
 * server tells them apart in /api/auth/me's `membership`:
 *   'none'     — the session verified, but no athletes row answers to its email
 *                (never joined, or their row was archived/renamed)
 *   'inactive' — a row exists and is not active: invited-but-unfinished, or
 *                access that was removed
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
export function AccessBlocked({ membership }: { membership: 'none' | 'inactive' }) {
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
    try {
      await getSupabase().auth.signOut();
    } catch {
      // A failed sign-out must not trap them on this screen — the local identity
      // is what the shell reads, so clearing it is the part that matters.
    }
    clearIdentityKeys();
    window.location.href = '/';
  };

  const pending = membership === 'inactive';
  const Icon = pending ? Clock : ShieldOff;

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

          <h1 className="text-lg font-bold text-ink-700">
            {pending ? t('pendingTitle') : t('noneTitle')}
          </h1>
          <p className="mt-2 max-w-[300px] text-sm leading-relaxed text-ink-400">
            {pending ? t('pendingBody') : t('noneBody')}
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
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              {pending ? t('pendingHint') : t('noneHint')}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
