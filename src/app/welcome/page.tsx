'use client';

// The installed app's first open (onboarding v2). The icon was added from the
// member's own join link, so it opens here with their token: "hi Noa", one tap
// sends a code to the address the club already has, the code goes in, and they
// are inside — signed in once, in the app itself, where an iPhone keeps the login
// and can show notifications. Strava stays available underneath.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase/client';
import { ONBOARDING_V2_KEY } from '@/lib/install/v2';
import { Journey } from '@/app/register/RegisterReceived';

type Who = { firstName: string | null; maskedEmail: string };

export default function WelcomePage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [who, setWho] = useState<Who | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t') || '';
    setToken(t);
    // This IS the new flow's app: the rest of v2 (the notifications picture) follows it here.
    try { localStorage.setItem(ONBOARDING_V2_KEY, '1'); } catch { /* private mode */ }
    (async () => {
      const { data } = await getSupabase().auth.getSession();
      if (data.session && localStorage.getItem('athlete_id')) { router.replace('/feed'); return; }
      if (!t) { setUnknown(true); return; }
      const res = await fetch('/api/auth/email-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'who', token: t }) });
      if (!res.ok) { setUnknown(true); return; }
      setWho(await res.json());
    })().catch(() => setUnknown(true));
  }, [router]);

  const post = (body: object) => fetch('/api/auth/email-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) });

  const send = async () => {
    setError(null); setBusy(true);
    try {
      const res = await post({ action: 'send' });
      if (res.status === 429) throw new Error('נשלחו כבר כמה קודים. נסו שוב בעוד רבע שעה.');
      if (!res.ok) throw new Error('לא הצלחנו לשלוח. נסו שוב.');
      setSent(true); setCode('');
    } catch (err) { setError(err instanceof Error ? err.message : 'משהו השתבש'); } finally { setBusy(false); }
  };

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null); setBusy(true);
    try {
      const res = await post({ action: 'verify', code });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error === 'wrong-code' ? (data.left ? `הקוד לא נכון. נשארו עוד ${data.left} ניסיונות.` : 'הקוד לא נכון. בקשו קוד חדש.') : 'הקוד פג תוקף. בקשו קוד חדש.');
      if (data.session?.access_token && data.session?.refresh_token) {
        await getSupabase().auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
      }
      localStorage.setItem('athlete_id', data.athleteId);
      localStorage.setItem('athlete_name', data.name || '');
      localStorage.setItem('athlete_email', data.email);
      if (data.groupId) localStorage.setItem('athlete_group_id', data.groupId); else localStorage.removeItem('athlete_group_id');
      router.replace('/feed');
    } catch (err) { setError(err instanceof Error ? err.message : 'משהו השתבש'); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-viewport bg-page" dir="rtl">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-5 pb-10 pt-[max(22px,env(safe-area-inset-top))]">
        <div className="rounded-[24px] bg-gradient-to-br from-[#2b33ff] via-brand-600 to-[#6a5cff] px-4 pb-5 pt-4 text-center text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo-white.png" alt="מדרגות" className="mx-auto h-14 w-auto" />
          <p className="mt-2 text-2xs font-bold tracking-wide text-white/85">ההתקנה הצליחה 🎉</p>
          <h1 className="mt-0.5 text-2xl font-black">{who?.firstName ? `שלום, ${who.firstName} 👋` : 'ברוכים הבאים 👋'}</h1>
          <p className="mt-0.5 text-13 text-white/90">נשאר רק להיכנס, פעם אחת</p>
        </div>

        <Journey done={3} />

        {unknown ? (
          <div className="rounded-2xl bg-card p-4 text-center">
            <p className="text-sm leading-relaxed text-ink-700">לא זיהינו את הקישור. אפשר להיכנס עם המייל שאיתו נרשמתם.</p>
            <Link href="/" className="mt-3 inline-flex min-h-[48px] items-center justify-center rounded-pill bg-brand-600 px-6 text-sm font-black text-white">לכניסה</Link>
          </div>
        ) : !sent ? (
          <div className="rounded-2xl bg-card p-4 text-center">
            <p className="text-sm leading-relaxed text-ink-700">
              נשלח קוד של 6 ספרות למייל שלך{who ? <><br /><bdi dir="ltr" className="font-bold">{who.maskedEmail}</bdi></> : ''}
            </p>
            {error && <p className="mt-2 text-sm font-semibold text-accent-red">{error}</p>}
            <button type="button" onClick={send} disabled={busy || !who} className="mt-3 min-h-[52px] w-full rounded-pill bg-brand-600 text-base font-black text-white disabled:opacity-50">
              {busy ? 'שולח…' : 'שלחו לי קוד'}
            </button>
          </div>
        ) : (
          <form onSubmit={verify} className="rounded-2xl bg-card p-4 text-center">
            <p className="text-sm leading-relaxed text-ink-700">הקוד בדרך ל-<bdi dir="ltr" className="font-bold">{who?.maskedEmail}</bdi>.<br />באייפון הוא יופיע מעל המקלדת, לוחצים עליו.</p>
            <input
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} dir="ltr" autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456"
              aria-label="קוד הכניסה"
              className="mt-3 h-[64px] w-full rounded-xl border border-page bg-page px-4 text-center text-[30px] font-black tracking-[0.3em] text-ink-700 focus:border-brand-600 focus:outline-none"
            />
            {error && <p className="mt-2 text-sm font-semibold text-accent-red">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6} className="mt-3 min-h-[52px] w-full rounded-pill bg-brand-600 text-base font-black text-white disabled:opacity-50">
              {busy ? 'בודק…' : 'כניסה'}
            </button>
            <button type="button" onClick={send} disabled={busy} className="mt-3 text-sm font-bold text-brand-600">לא הגיע? שליחת קוד חדש · כדאי לבדוק בספאם</button>
          </form>
        )}

        <Link href="/" className="text-center text-xs font-bold text-ink-400 underline underline-offset-2">יש לי Strava / מייל אחר</Link>
      </div>
    </div>
  );
}
