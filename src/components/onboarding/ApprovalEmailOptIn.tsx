'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { JOURNEY, SecondaryButton } from '@/components/onboarding/journey-ui';

// "How should we tell you you're in?" — on the waiting-for-approval screen, for the
// member nothing can reach: signed in with Strava (so the only address on file is
// the synthetic strava_<id>@strava.madregot.local) and, on an iPhone Safari tab,
// no push either. Everyone in that position who waited days was lost (analysis
// 2026-10-10). The address lands on their pending request and the approval mails
// it (POST /api/onboarding/notify-email, /api/admin/approve).
const SAVED_KEY = 'mc-approval-email-saved';

export function ApprovalEmailOptIn() {
  const t = useTranslations('pendingEmail');
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'bad' | 'error'>('idle');

  useEffect(() => {
    try {
      const onFile = localStorage.getItem('athlete_email') || '';
      const synthetic = !onFile || /@strava\.madregot\.local$/i.test(onFile);
      setShow(synthetic && localStorage.getItem(SAVED_KEY) !== '1');
    } catch { setShow(true); }
  }, []);
  if (!show && state !== 'saved') return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('saving');
    try {
      const res = await fetch('/api/onboarding/notify-email', { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ email }) });
      if (res.status === 400) { setState('bad'); return; }
      if (!res.ok) throw new Error(String(res.status));
      try { localStorage.setItem(SAVED_KEY, '1'); } catch { /* ignore */ }
      setState('saved');
    } catch { setState('error'); }
  };

  if (state === 'saved') {
    return <p className="rounded-2xl px-4 py-3 text-[14px] font-bold" style={{ background: JOURNEY.tagBg, color: JOURNEY.ink }} data-testid="approval-email-saved">✓ {t('saved')}</p>;
  }
  return (
    <form onSubmit={save} className="rounded-[20px] bg-white p-4 text-start" dir="rtl" data-testid="approval-email">
      <p className="text-[15px] font-bold" style={{ color: JOURNEY.ink }}>{t('title')}</p>
      <p className="mt-0.5 text-[13px] leading-snug" style={{ color: JOURNEY.soft }}>{t('body')}</p>
      <input
        type="email" inputMode="email" autoComplete="email" dir={email ? 'ltr' : 'rtl'} required value={email}
        onChange={(e) => { setEmail(e.target.value); if (state !== 'idle') setState('idle'); }}
        placeholder={t('placeholder')} aria-label={t('label')}
        className="mt-3 h-[48px] w-full rounded-2xl border px-4 text-base focus:outline-none"
        style={{ borderColor: state === 'bad' ? JOURNEY.red : JOURNEY.line, background: JOURNEY.well, color: JOURNEY.ink }}
      />
      {state === 'bad' && <p className="mt-2 text-[13px] font-bold" style={{ color: JOURNEY.red }}>{t('bad')}</p>}
      {state === 'error' && <p className="mt-2 text-[13px] font-bold" style={{ color: JOURNEY.red }}>{t('error')}</p>}
      {/* Outline, not a second primary pill: nothing on the waiting screen is the
          one thing to do, and this is optional. */}
      <SecondaryButton type="submit" outline disabled={state === 'saving'} className="mt-2">
        {state === 'saving' ? '…' : t('cta')}
      </SecondaryButton>
    </form>
  );
}
