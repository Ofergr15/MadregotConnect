'use client';

// The one way into the PWA: your email, then the 6-digit code we mail you
// (POST /api/auth/email-code). Before the move to Frankfurt every member signs in
// once, so this is the whole landing page — one field, one button, no Strava,
// Google or password on this path (those routes still work for deep links).
//
// The confirmation is the same for every address, member or not: "if it is
// registered with us, a code is on its way". The form must never say who is a
// member (route comment + CLAUDE.md). That includes a rate-limit answer, which
// is shown only after a send, in the same words whoever asked.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase/client';
import { postLoginPath } from '@/lib/auth/landing';
import { helpWhatsAppHref } from '@/lib/help-whatsapp';
import { codeDigits, CODE_LENGTH, placeDigits } from '@/lib/auth/code-input';

const post = (body: object) => fetch('/api/auth/email-code', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export function EmailCodeLogin() {
  const router = useRouter();
  const help = helpWhatsAppHref('היי, ניסיתי להיכנס לאפליקציה של מדרגות עם קוד במייל והוא לא מגיע');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await post({ action: 'send', email: email.trim() });
      if (res.status === 429) throw new Error('נשלחו כבר כמה קודים. נסו שוב בעוד רבע שעה.');
      if (res.status === 503) throw new Error('הכניסה עם קוד עוד לא פעילה. כתבו לנו ונכניס אתכם.');
      if (!res.ok) throw new Error('הכתובת לא נראית תקינה');
      setDigits(Array(CODE_LENGTH).fill(''));
      setStep('code');
      setTimeout(() => boxes.current[0]?.focus(), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'משהו השתבש, נסו שוב');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (code: string) => {
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
      setDigits(Array(CODE_LENGTH).fill(''));
      boxes.current[0]?.focus();
      setBusy(false);
    }
  };

  // Typing, pasting, or iOS's one-time-code autofill all land here: whatever
  // arrived is spread from box `i` onwards, focus moves past it, and a full code submits.
  const fill = (i: number, raw: string) => {
    const { next, focus } = placeDigits(digits, i, raw);
    setDigits(next);
    boxes.current[Math.min(focus, CODE_LENGTH - 1)]?.focus();
    const code = codeDigits(next);
    if (code && !busy) void verify(code);
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      const next = [...digits];
      next[i - 1] = '';
      setDigits(next);
      boxes.current[i - 1]?.focus();
    }
  };

  if (step === 'email') {
    return (
      <form onSubmit={send} className="flex w-full flex-col gap-4" aria-label="כניסה עם מייל">
        <label htmlFor="login-email" className="text-lg font-bold text-ink-900">המייל שלכם</label>
        <input
          id="login-email" type="email" inputMode="email" autoComplete="email" dir="ltr" required autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
          className="h-16 rounded-2xl border-2 border-black/10 bg-white px-5 text-xl text-ink-900 focus:border-brand-600 focus:outline-none"
        />
        {error && <p role="alert" className="text-base font-semibold text-accent-red">{error}</p>}
        <button type="submit" disabled={busy || !email.trim()} className="min-h-16 rounded-full bg-brand-600 text-xl font-black text-white disabled:opacity-50">
          {busy ? 'שולח…' : 'שלחו לי קוד'}
        </button>
        <p className="text-center text-sm leading-relaxed text-ink-500">נשלח קוד של 6 ספרות למייל שאיתו נרשמתם.</p>
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <p className="text-base leading-relaxed text-ink-700">
        אם הכתובת <bdi dir="ltr" className="font-bold">{email.trim()}</bdi> רשומה אצלנו, שלחנו אליה קוד. כדאי לבדוק גם בספאם.
      </p>
      <fieldset className="flex justify-between gap-2" dir="ltr" disabled={busy}>
        <legend className="sr-only">קוד בן 6 ספרות</legend>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { boxes.current[i] = el; }}
            aria-label={`ספרה ${i + 1}`}
            inputMode="numeric" pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            value={d}
            onChange={(e) => fill(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={(e) => { e.preventDefault(); fill(0, e.clipboardData.getData('text')); }}
            onFocus={(e) => e.target.select()}
            className="h-16 w-12 rounded-2xl border-2 border-black/10 bg-white text-center text-3xl font-black text-ink-900 focus:border-brand-600 focus:outline-none"
          />
        ))}
      </fieldset>
      {busy && <p className="text-center text-base text-ink-500">בודק…</p>}
      {error && <p role="alert" className="text-base font-semibold text-accent-red">{error}</p>}
      <div className="flex justify-between text-base font-bold text-brand-600">
        <button type="button" className="min-h-11" onClick={() => { setStep('email'); setError(null); }}>→ מייל אחר</button>
        <button type="button" className="min-h-11" onClick={() => send()} disabled={busy}>שליחת קוד חדש</button>
      </div>
      <p className="text-sm leading-relaxed text-ink-500">
        לא מגיע תוך דקה? אולי נרשמתם עם כתובת אחרת — נסו אותה.
        {help && <> <a href={help} target="_blank" rel="noopener noreferrer" className="font-bold text-brand-600 underline">כתבו לנו בווטסאפ</a></>}
      </p>
    </div>
  );
}
