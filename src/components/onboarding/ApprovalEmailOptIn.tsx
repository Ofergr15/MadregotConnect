'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { bearerHeaders } from '@/lib/auth/bearer-headers';

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
    return <p className="mt-3 rounded-2xl bg-accent-600/10 px-4 py-3 text-sm text-accent-700" data-testid="approval-email-saved">✓ {t('saved')}</p>;
  }
  return (
    <form onSubmit={save} className="mt-3 rounded-2xl bg-card p-4 text-start" dir="rtl" data-testid="approval-email">
      <p className="text-sm font-bold text-ink-700">{t('title')}</p>
      <p className="mt-0.5 text-xs text-ink-500">{t('body')}</p>
      <div className="mt-3 flex gap-2">
        <input
          type="email" inputMode="email" autoComplete="email" dir="ltr" required value={email}
          onChange={(e) => { setEmail(e.target.value); if (state !== 'idle') setState('idle'); }}
          placeholder="you@example.com" aria-label={t('label')}
          className="min-h-[48px] min-w-0 flex-1 rounded-2xl border border-ink-300 bg-page px-3 text-base text-ink-700"
        />
        <button type="submit" disabled={state === 'saving'} className="min-h-[48px] rounded-pill bg-brand-600 px-5 text-sm font-bold text-white disabled:opacity-50">
          {state === 'saving' ? '…' : t('cta')}
        </button>
      </div>
      {state === 'bad' && <p className="mt-2 text-xs font-semibold text-accent-red">{t('bad')}</p>}
      {state === 'error' && <p className="mt-2 text-xs font-semibold text-accent-red">{t('error')}</p>}
    </form>
  );
}
