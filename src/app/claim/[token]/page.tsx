'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Link2, Loader2 } from 'lucide-react';
import { Card, Button } from '@/components/ui';

/**
 * /claim/[token] — the click at the end of the claim email (migration 098).
 *
 * A page with a button rather than a link that just works, and the button is the
 * whole reason this page exists: the token authorises a MERGE of two accounts, and
 * mail clients pre-fetch links. Several fetch every URL in a message for previews or
 * for malware scanning, which would consume the claim before the member had read the
 * sentence explaining what it does — and, since the token is single-use, leave the
 * real click looking like an expired link. So nothing happens until somebody presses
 * something, and the POST is what carries the token.
 *
 * No session is required here. The mail is read on whatever device is nearest,
 * usually not the phone with the app installed, and requiring the Strava session on
 * this page would defeat the one path built for members the app cannot recognise.
 * Arriving in the right mailbox IS the proof.
 */
export default function ClaimPage() {
  const { token } = useParams<{ token: string }>();
  const t = useTranslations('claimAccount');
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const [name, setName] = useState<string | null>(null);
  /** True when somebody — the approver, or the member's own next Strava login —
   *  already folded these two rows together. Success, with nothing done. */
  const [already, setAlready] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setState('working');
    setError(null);
    try {
      const res = await fetch('/api/auth/claim-member/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 410 covers expired, already used and never existed — the route will not
        // distinguish them, and for the person reading this the answer is the same:
        // ask the app for a new link.
        if (res.status === 410) throw new Error(t('errExpired'));
        if (res.status === 409) throw new Error(t('errRefused'));
        throw new Error(t('errGeneric'));
      }
      setName(out.athleteName || null);
      setAlready(!!out.alreadyMerged);
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errGeneric'));
      setState('idle');
    }
  };

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4" dir="rtl">
      <Card className="max-w-md w-full text-center">
        <div className="flex items-center justify-center">
          <img src="/images/logo.png" alt="Madregot" className="h-10 w-10 object-contain brightness-0 invert" />
          <span className="text-lg font-bold text-ink-700 ms-3">Madregot</span>
        </div>

        {state === 'done' ? (
          <div className="mt-6">
            <CheckCircle2 className="h-10 w-10 mx-auto text-brand-600" aria-hidden="true" />
            <h1 className="mt-3 text-lg font-extrabold text-ink-900">{t('doneTitle')}</h1>
            {/* The name, when the merge returned one: it is the confirmation that
                this landed on the right account, which is the one thing the reader
                cannot verify for themselves from here. */}
            {name && <p className="mt-1 text-sm font-semibold text-ink-700">{name}</p>}
            <p className="mt-2 text-13 text-ink-500 leading-relaxed">
              {already ? t('alreadyDone') : t('doneBody')}
            </p>
            <a
              href="/"
              className="mt-5 inline-flex items-center justify-center h-11 px-6 rounded-pill bg-ink-900 text-white text-sm font-semibold"
            >
              {t('openApp')}
            </a>
          </div>
        ) : (
          <div className="mt-6">
            <Link2 className="h-10 w-10 mx-auto text-ink-400" aria-hidden="true" />
            <h1 className="mt-3 text-lg font-extrabold text-ink-900">{t('confirmTitle')}</h1>
            <p className="mt-2 text-13 text-ink-500 leading-relaxed">{t('confirmBody')}</p>
            {error && <p className="mt-3 text-3xs font-semibold text-accent-red-ink leading-relaxed">{error}</p>}
            <Button onClick={confirm} disabled={state === 'working'} className="mt-5 w-full">
              {state === 'working' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('confirmWorking')}
                </span>
              ) : (
                t('confirmCta')
              )}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
