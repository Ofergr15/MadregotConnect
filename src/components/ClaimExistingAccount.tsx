'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link2, Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * "כבר יש לי חשבון" — on the waiting-for-approval screen.
 *
 * The last resort in the duplicate story, and the only one that needs nobody else.
 * A member who joined by email months ago signs in with Strava; Strava sends a
 * numeric id and a display name and no address, so their roster row is matched
 * across scripts where the name carries enough signal (see athlete-identity.ts) and
 * merged automatically. When it does not — "Roey Roth" is three consonants, and
 * guessing on that would hand somebody another member's account — they land here,
 * looking at a screen that says "wait for the coach" while their real account sits
 * in the roster with all their history in it.
 *
 * So the screen asks. They type the address they joined with, the link goes to THAT
 * MAILBOX, and clicking it merges the two rows: the typed address is never trusted,
 * it only decides where the proof is sent. See /api/auth/claim-member.
 *
 * Folded shut by default. Most people on this screen really are new and waiting for
 * an approval, and an email field is the wrong thing to put in front of them —
 * opening it is one tap for the few who need it.
 */
export default function ClaimExistingAccount() {
  const t = useTranslations('claimAccount');
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/claim-member', {
        method: 'POST',
        // The bearer token is required: the route has to know WHICH Strava sign-in
        // is asking, and that only comes from the session.
        headers: await apiHeaders(true),
        body: JSON.stringify({ email }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) {
        // 'ok' for a match and for no match alike — the route will not say which,
        // so that a signed-in stranger cannot use this to test whether an address
        // belongs to a club member. Only the failures that the person can act on
        // have their own words.
        if (res.status === 429) throw new Error(t('errTooMany'));
        if (out.error === 'bad-email') throw new Error(t('errBadEmail'));
        if (out.error === 'email-failed' || out.error === 'claim-unavailable') {
          throw new Error(t('errEmailFailed'));
        }
        throw new Error(t('errGeneric'));
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errGeneric'));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div dir="rtl" className="mt-5 pt-5 border-t border-page text-start">
        <p className="flex items-center gap-2 text-sm font-bold text-ink-900">
          <MailCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('sentTitle')}
        </p>
        {/* Deliberately does not say whether the address matched anybody: the
            route does not tell this component, and it must not — see its header. */}
        <p className="mt-1.5 text-13 text-ink-500 leading-relaxed">{t('sentBody')}</p>
        <p className="mt-1.5 text-3xs text-ink-400 leading-relaxed">{t('sentHint')}</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="mt-5 pt-5 border-t border-page text-start">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-start gap-2 text-start w-full active:opacity-70"
        >
          <Link2 className="h-4 w-4 shrink-0 mt-0.5 text-ink-400" aria-hidden="true" />
          <span>
            <span className="block text-sm font-bold text-ink-900">{t('prompt')}</span>
            <span className="block mt-0.5 text-3xs text-ink-400">{t('start')} →</span>
          </span>
        </button>
      ) : (
        <form onSubmit={submit}>
          <p className="text-sm font-bold text-ink-900">{t('prompt')}</p>
          {/* The explanation opens WITH the field, not behind another tap: this asks
              for an email address on a screen that already told them to wait, and
              "why are you asking" has to be answered before they type. */}
          <p className="mt-1 text-3xs text-ink-400 leading-relaxed">{t('promptBody')}</p>
          <label htmlFor="claim-email" className="block mt-3 text-3xs font-semibold text-ink-500">
            {t('emailLabel')}
          </label>
          <input
            id="claim-email"
            type="email"
            dir="ltr"
            required
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
            className="mt-1 w-full min-h-[44px] bg-page border border-ink-300 rounded-2xl px-4 py-3 text-base text-ink-700 placeholder-ink-400 text-left focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
          {error && <p className="mt-2 text-3xs font-semibold text-accent-red-ink">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <Button type="submit" disabled={busy || !email} className={cn('flex-1', busy && 'opacity-70')}>
              {busy ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('sending')}
                </span>
              ) : (
                t('submit')
              )}
            </Button>
            <button
              type="button"
              onClick={() => { setOpen(false); setError(null); }}
              disabled={busy}
              className="h-11 px-4 rounded-pill text-13 font-semibold text-ink-400 active:bg-page disabled:opacity-40"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
