'use client';

// The installed app's first open (onboarding v2). The icon was added from the
// member's own join link, so it opens here with their token: "hi Noa", one tap
// sends a code to the address the club already has, the code goes in, and they
// are inside — signed in once, in the app itself, where an iPhone keeps the login
// and can show notifications. Strava stays available underneath.
//
// Without a link (or with one nobody knows) this is the email-code sign-in: the
// address is typed here and the same /api/auth/email-code flow runs on it. It
// never sends anyone to "/" — that is the marketing page.
//
// The journey's one look (components/onboarding/journey-ui). "ההתקנה הצליחה" and
// the install step's ✓ are claimed ONLY when this really runs installed.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase/client';
import { ONBOARDING_V2_KEY } from '@/lib/install/v2';
import { useIsComputer } from '@/lib/install/use-computer';
import { isIosDevice, isStandalone } from '@/lib/pwa';
import { trackOnb } from '@/lib/onboarding/track';
import {
  JOURNEY, JourneyCard, JourneyHero, JourneyScreen, JourneyTracker, PrimaryButton, SecondaryButton,
} from '@/components/onboarding/journey-ui';

type Who = { firstName: string | null; maskedEmail: string };

/** How long "שליחת קוד חדש" waits after a send. */
const RESEND_SECONDS = 30;

export default function WelcomePage() {
  const router = useRouter();
  // On a computer nothing was installed: no "installed 🎉", no install step.
  const computer = useIsComputer();
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [token, setToken] = useState('');
  const [who, setWho] = useState<Who | null>(null);
  const [unknown, setUnknown] = useState(false);
  // The unknown-link sign-in: the address typed here.
  const [typedEmail, setTypedEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last verify failed: red frame on the code field until they type again.
  const [wrong, setWrong] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStandalone(isStandalone());
    setIos(isIosDevice());
    const t = new URLSearchParams(window.location.search).get('t') || '';
    setToken(t);
    trackOnb('welcome_open', { token: t || null, once: true });
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

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // By the link when there is one the API knows; by the typed address otherwise
  // (the route reads `email` only when no token is given).
  const post = (body: object) => fetch('/api/auth/email-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(unknown ? { email: typedEmail.trim(), ...body } : { token, ...body }),
  });

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null); setWrong(false); setBusy(true);
    try {
      const res = await post({ action: 'send' });
      if (res.status === 429) throw new Error('נשלחו כבר כמה קודים. נסו שוב בעוד רבע שעה.');
      if (res.status === 400) throw new Error('הכתובת לא נראית תקינה.');
      if (!res.ok) throw new Error('לא הצלחנו לשלוח. נסו שוב.');
      setSent(true); setCode(''); setCooldown(RESEND_SECONDS);
    } catch (err) { setError(err instanceof Error ? err.message : 'משהו השתבש'); } finally { setBusy(false); }
  };

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null); setBusy(true);
    let failed = false;
    try {
      const res = await post({ action: 'verify', code });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error === 'wrong-code' ? (data.left ? `הקוד לא נכון. נשארו עוד ${data.left} ניסיונות.` : 'הקוד לא נכון. בקשו קוד חדש.') : 'הקוד פג תוקף. בקשו קוד חדש.');
      if (data.session?.access_token && data.session?.refresh_token) {
        await getSupabase().auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
      }
      localStorage.setItem('athlete_id', data.athleteId);
      localStorage.setItem('athlete_name', data.name || '');
      // The name they gave on the form, for the first-run welcome inside the app.
      if (who?.firstName) localStorage.setItem('mc-first-name', who.firstName);
      localStorage.setItem('athlete_email', data.email);
      if (data.groupId) localStorage.setItem('athlete_group_id', data.groupId); else localStorage.removeItem('athlete_group_id');
      router.replace('/feed');
    } catch (err) {
      failed = true;
      setError(err instanceof Error ? err.message : 'משהו השתבש');
      // A wrong code is cleared, framed red and focused again, so the next try is a
      // fresh six digits rather than editing the wrong ones.
      setWrong(true); setCode('');
    } finally {
      setBusy(false);
      if (failed) requestAnimationFrame(() => codeRef.current?.focus());
    }
  };

  // The address the code goes to: masked by the link, or the one they typed.
  const to = unknown ? typedEmail.trim() : who?.maskedEmail || '';
  const tip = computer ? 'אפשר להעתיק מהמייל ולהדביק כאן' : ios ? 'באייפון הוא יופיע מעל המקלדת, לוחצים עליו' : null;
  // On a phone browser tab nothing is installed either: no install step, no ✓ on it.
  const noInstallStep = computer || !standalone;

  const hero = (
    <JourneyHero
      eyebrow={standalone && !computer ? 'ההתקנה הצליחה 🎉' : 'מועדון הריצה של מדרגות'}
      title={who?.firstName ? `שלום, ${who.firstName} 👋` : 'ברוכים הבאים 👋'}
      subtitle={unknown && !sent ? 'נכנסים עם המייל שאיתו נרשמתם' : 'נשאר רק להיכנס, פעם אחת'}
    />
  );

  if (sent) {
    return (
      <form onSubmit={verify}>
        <JourneyScreen
          testId="welcome"
          hero={hero}
          actions={
            <>
              <PrimaryButton type="submit" disabled={busy || code.length !== 6}>{busy ? 'בודקים…' : 'כניסה'}</PrimaryButton>
              <SecondaryButton outline onClick={() => send()} disabled={busy || cooldown > 0} className="mt-1">
                {cooldown > 0 ? `שליחת קוד חדש (0:${String(cooldown).padStart(2, '0')})` : 'שליחת קוד חדש'}
              </SecondaryButton>
              <p className="pt-1 text-center text-[13px]" style={{ color: JOURNEY.soft }}>לא הגיע? כדאי לבדוק בספאם</p>
            </>
          }
        >
          <JourneyTracker done={3} computer={noInstallStep} />
          <JourneyCard className="text-center">
            <p className="text-[15px] leading-relaxed" style={{ color: JOURNEY.body }}>
              שלחנו קוד אל <bdi dir="ltr" className="font-bold">{to}</bdi>
            </p>
            {/* The route answers the same for an address it does not know; say so. */}
            {unknown && <p className="mt-0.5 text-[13px]" style={{ color: JOURNEY.soft }}>אם הכתובת רשומה במועדון, הקוד כבר בדרך</p>}
            {tip && <p className="mt-0.5 text-[13px]" style={{ color: JOURNEY.soft }}>{tip}</p>}
            <input
              ref={codeRef}
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} dir="ltr" autoFocus
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); if (wrong) setWrong(false); }}
              placeholder="• • • • • •"
              aria-label="קוד הכניסה"
              aria-invalid={wrong || undefined}
              className="mt-3 h-[64px] w-full rounded-2xl border-2 px-4 text-center text-[30px] font-black tracking-[0.3em] placeholder:font-normal placeholder:text-[#D9CFC8] focus:outline-none"
              style={{ borderColor: wrong ? JOURNEY.red : JOURNEY.line, background: JOURNEY.well, color: JOURNEY.ink }}
            />
            {error && <p role="alert" className="mt-2 text-[14px] font-bold" style={{ color: JOURNEY.red }}>{error}</p>}
          </JourneyCard>
        </JourneyScreen>
      </form>
    );
  }

  if (unknown) {
    return (
      <form onSubmit={send}>
        <JourneyScreen
          testId="welcome-unknown"
          hero={hero}
          actions={
            <>
              <PrimaryButton type="submit" disabled={busy || !typedEmail.trim()}>{busy ? 'שולחים…' : 'שלחו לי קוד'}</PrimaryButton>
              <SecondaryButton href="/register?onb=v2">עוד לא נרשמתם? להרשמה</SecondaryButton>
              {/* Strava's sign-in lives on the landing page. */}
              <SecondaryButton href="/">נכנסים עם Strava</SecondaryButton>
            </>
          }
        >
          <JourneyTracker done={3} computer={noInstallStep} />
          <JourneyCard>
            <label htmlFor="welcome-email" className="mb-1 block text-[13px] font-bold" style={{ color: JOURNEY.soft }}>
              נשלח קוד של 6 ספרות למייל שאיתו נרשמתם
            </label>
            <input
              id="welcome-email" type="email" inputMode="email" autoComplete="email" required
              value={typedEmail}
              onChange={(e) => setTypedEmail(e.target.value)}
              dir={typedEmail ? 'ltr' : 'rtl'}
              placeholder="המייל שלכם"
              className={`h-[52px] w-full rounded-2xl border px-4 text-base focus:outline-none ${typedEmail ? 'text-left' : 'text-right'}`}
              style={{ borderColor: JOURNEY.line, background: JOURNEY.well, color: JOURNEY.ink }}
            />
            {error && <p role="alert" className="mt-2 text-[14px] font-bold" style={{ color: JOURNEY.red }}>{error}</p>}
          </JourneyCard>
        </JourneyScreen>
      </form>
    );
  }

  return (
    <form onSubmit={send}>
      <JourneyScreen
        testId="welcome"
        hero={hero}
        actions={
          <>
            <PrimaryButton type="submit" disabled={busy || !who}>{busy ? 'שולחים…' : 'שלחו לי קוד'}</PrimaryButton>
            {/* Another address = the typed-address sign-in right here; Strava is offered on that screen. */}
            <SecondaryButton onClick={() => { setError(null); setUnknown(true); }}>נכנסים אחרת (Strava / מייל אחר)</SecondaryButton>
          </>
        }
      >
        <JourneyTracker done={3} computer={noInstallStep} />
        <JourneyCard className="text-center">
          <p className="text-[14px]" style={{ color: JOURNEY.soft }}>נשלח לכם קוד של 6 ספרות אל</p>
          {who && <bdi dir="ltr" className="mt-0.5 block text-[16px] font-bold" style={{ color: JOURNEY.ink }}>{who.maskedEmail}</bdi>}
          {error && <p role="alert" className="mt-2 text-[14px] font-bold" style={{ color: JOURNEY.red }}>{error}</p>}
        </JourneyCard>
      </JourneyScreen>
    </form>
  );
}
