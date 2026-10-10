'use client';

import { useState } from 'react';
import { Qr } from '@/components/install/InstallGuide';
import { joinLinkV2 } from '@/lib/install/flag';

// ═════════════════════════════════════════════════════════════════════════════
// "CONTINUE ON THE PHONE" — the end of /join on a COMPUTER (lib/install/platform
// isComputer). Mockup: ~/.cache/madregot/desktop-onb/mockup.html, screen 1.
//
// Ofer, 2026-10-09: a computer is never blocked, but the member is asked, clearly
// and once, to carry on on the phone — that is where the coach's notifications,
// the workout reminders and the watch sync live. So: why the phone, two ways to
// get there (scan the code, or have the link mailed to the address the club
// already has), and an honest way to keep going on the computer, which signs in
// with an email code at /welcome.
//
// It replaces, on a computer only, the bare "install it on the phone" QR screen
// and the "you're connected — Garmin" screen that followed it. On a phone the
// install guide is exactly what it was.
// ═════════════════════════════════════════════════════════════════════════════

const WHY: Array<[string, string, string]> = [
  ['🔔', 'התראות מהמאמן', 'תגובה למשוב, הודעות מהקבוצה, kudos'],
  ['⏰', 'תזכורת יום לפני אימון', 'ואישור הגעה בלחיצה אחת'],
  ['⌚', 'סנכרון מהשעון', 'Garmin ו-Strava, הריצה מופיעה בלי לעשות כלום'],
];

export function ContinueOnPhone({ token, firstName, onContinueHere }: { token: string; firstName?: string | null; onContinueHere: () => void }) {
  const [mail, setMail] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [to, setTo] = useState('');
  const link = typeof window === 'undefined' ? '' : joinLinkV2(window.location.origin, token, true);

  const sendLink = async () => {
    setMail('sending');
    try {
      const res = await fetch('/api/join/phone-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || String(res.status));
      setTo(d.to || '');
      setMail('sent');
    } catch {
      setMail('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-page" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="cop-title" data-testid="continue-on-phone">
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="flex w-full max-w-[880px] flex-col-reverse gap-8 rounded-[26px] bg-card p-8 shadow-[0_10px_40px_rgba(0,0,0,0.08)] md:flex-row md:items-stretch md:p-10">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold text-brand-600">✓ הפרטים נשמרו{firstName ? ` · ${firstName}, את/ה בפנים` : ''}</p>
            <h1 id="cop-title" className="mt-1.5 text-[30px] font-black leading-tight text-ink-700">ממשיכים בטלפון</h1>
            <p className="mt-1 text-[15px] text-ink-500">מדרגות בנויה לטלפון. שם המאמן יכול לכתוב לך, והריצות נכנסות לבד.</p>
            <ul className="mt-3">
              {WHY.map(([icon, title, sub], i) => (
                <li key={title} className={`flex items-start gap-3 py-2.5 ${i ? 'border-t border-page' : ''}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-600/10 text-lg" aria-hidden>{icon}</span>
                  <span><b className="block text-[15px] text-ink-700">{title}</b><span className="text-13 text-ink-500">{sub}</span></span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
              <button
                type="button"
                onClick={sendLink}
                disabled={mail === 'sending' || mail === 'sent'}
                className="min-h-[52px] rounded-pill border border-page bg-card px-6 text-base font-black text-ink-700 shadow-sm disabled:opacity-60"
              >
                {mail === 'sending' ? 'שולח…' : mail === 'sent' ? '✓ נשלח למייל' : '✉️ שלחו לי את הקישור למייל'}
              </button>
              <button type="button" onClick={onContinueHere} className="min-h-[44px] text-sm font-bold text-ink-500 underline underline-offset-2">
                אמשיך במחשב בינתיים
              </button>
            </div>
            {mail === 'sent' && <p className="mt-2 text-13 text-ink-500">שלחנו{to ? <> ל-<bdi dir="ltr">{to}</bdi></> : ''}. פותחים את המייל בטלפון ולוחצים על הקישור.</p>}
            {mail === 'error' && <p className="mt-2 text-13 font-semibold text-accent-red">לא הצלחנו לשלוח עכשיו. אפשר לסרוק את הקוד, או לנסות שוב.</p>}
          </div>
          <div className="flex w-full shrink-0 flex-col items-center rounded-[22px] bg-page/60 p-6 text-center md:w-[260px]">
            {link && <Qr url={link} />}
            <b className="mt-3 text-[15px] text-ink-700">סורקים עם מצלמת הטלפון</b>
            <span className="mt-0.5 text-13 text-ink-500">והטלפון ידריך אותך בהתקנה, צעד אחר צעד</span>
          </div>
        </div>
      </div>
    </div>
  );
}
