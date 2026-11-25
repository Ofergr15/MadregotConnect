'use client';
import { postLoginPath } from '@/lib/auth/landing';

// "No Strava? Sign in with a code by email" — the way in for a member without
// Strava (lib/auth/email-code). Two steps in one sheet: the address, then the six
// digits. `autocomplete="one-time-code"` lets iOS offer the code from the mail
// notification, so on an iPhone it is usually one tap.

import { helpWhatsAppHref } from '@/lib/help-whatsapp';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase/client';

export function EmailCodeSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const help = helpWhatsAppHref('היי, ניסיתי להיכנס לאפליקציה של מדרגות עם קוד במייל והוא לא מגיע');
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = (body: object) => fetch('/api/auth/email-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await post({ action: 'send', email: email.trim() });
      if (res.status === 429) throw new Error('נשלחו כבר כמה קודים. נסו שוב בעוד רבע שעה.');
      if (res.status === 503) throw new Error('הכניסה עם קוד עוד לא פעילה. בינתיים כתבו לנו ונכניס אתכם.');
      if (!res.ok) throw new Error('הכתובת לא נראית תקינה');
      setStep('code');
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'משהו השתבש, נסו שוב');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await post({ action: 'verify', email: email.trim(), code });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error === 'wrong-code'
          ? (data.left ? `הקוד לא נכון. נשארו עוד ${data.left} ניסיונות.` : 'הקוד לא נכון. בקשו קוד חדש.')
          : 'הקוד פג תוקף. בקשו קוד חדש.');
      }
      // The same adoption as every other login on this page (see /api/admin/login).
      if (data.session?.access_token && data.session?.refresh_token) {
        await getSupabase().auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
      }
      localStorage.setItem('athlete_id', data.athleteId);
      localStorage.setItem('athlete_name', data.name || '');
      localStorage.setItem('athlete_email', data.email);
      if (data.groupId) localStorage.setItem('athlete_group_id', data.groupId);
      else localStorage.removeItem('athlete_group_id');
      router.push(postLoginPath({ role: data.role, isAcademy: data.isAcademy, groupId: data.groupId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'משהו השתבש, נסו שוב');
    } finally {
      setBusy(false);
    }
  };

  return (
    // A top-anchored full-screen layer, not a bottom sheet: on iOS the keyboard pushed the
    // bottom drawer off-screen ("everything jumps up", 25.11). Content at the top never sits
    // under the keyboard.
    !open ? null : (
    <div role="dialog" aria-modal="true" aria-label="כניסה עם המייל" dir="rtl"
      className="fixed inset-0 z-[310] overflow-y-auto bg-page px-5 pb-[env(safe-area-inset-bottom)] pt-[calc(env(safe-area-inset-top)+16px)]">
      <div className="mx-auto flex max-w-md items-center justify-between pb-4">
        <h2 className="text-xl font-black text-ink-700">כניסה עם המייל</h2>
        <button type="button" aria-label="סגירה" onClick={() => onOpenChange(false)} className="min-h-[44px] min-w-[44px] text-2xl text-ink-500">×</button>
      </div>
      <div className="mx-auto max-w-md pb-4">
        {step === 'email' ? (
          <form onSubmit={send} className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-ink-500">כותבים את המייל שאיתו נרשמתם למדרגות, ונשלח אליו קוד של 6 ספרות.</p>
            <input
              type="email" inputMode="email" autoComplete="email" dir="ltr" required autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              className="h-[52px] rounded-xl border border-page bg-card px-4 text-base text-ink-700 focus:border-brand-600 focus:outline-none"
            />
            {error && <p className="text-sm font-semibold text-accent-red">{error}</p>}
            <button type="submit" disabled={busy || !email.trim()} className="min-h-[52px] rounded-pill bg-brand-600 text-base font-black text-white disabled:opacity-50">
              {busy ? 'שולח…' : 'שליחת קוד'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-ink-500">
              אם הכתובת <bdi dir="ltr" className="font-semibold text-ink-700">{email.trim()}</bdi> רשומה אצלנו, קוד בדרך. כדאי לבדוק גם בספאם.
            </p>
            {/* Nothing comes for an address the club doesn't have — say what to do then,
                rather than leave them waiting (Chen Becher, 2026-10-20). */}
            <p className="text-[13px] leading-relaxed text-ink-500">
              לא מגיע תוך דקה? אולי נרשמתם עם כתובת אחרת — אפשר לנסות אותה.
              {help && <> <a href={help} target="_blank" rel="noopener noreferrer" className="font-bold text-brand-600 underline">כתבו לנו בווטסאפ</a></>}
            </p>
            <input
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} dir="ltr" required autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} placeholder="123456"
              className="h-[60px] rounded-xl border border-page bg-card px-4 text-center text-[28px] font-black tracking-[0.3em] text-ink-700 focus:border-brand-600 focus:outline-none"
            />
            {error && <p className="text-sm font-semibold text-accent-red">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6} className="min-h-[52px] rounded-pill bg-brand-600 text-base font-black text-white disabled:opacity-50">
              {busy ? 'בודק…' : 'כניסה'}
            </button>
            <div className="flex justify-between text-sm font-bold text-brand-600">
              <button type="button" onClick={() => { setStep('email'); setError(null); }}>→ מייל אחר</button>
              <button type="button" onClick={() => send()} disabled={busy}>שליחת קוד חדש</button>
            </div>
          </form>
        )}
      </div>
    </div>
    )
  );
}
