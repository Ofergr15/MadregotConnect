'use client';

import { useState } from 'react';
import { Qr } from '@/components/install/InstallGuide';
import { joinLinkV2 } from '@/lib/install/flag';
import { JOURNEY, JourneyHero, JourneyRow, JourneyTracker, PrimaryButton, SecondaryButton } from '@/components/onboarding/journey-ui';

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
  ['🔔', 'התראות מהמאמן', 'תגובה למשוב, הודעות ולייקים מהקבוצה'],
  ['⏰', 'תזכורת יום לפני אימון', 'ואישור הגעה בלחיצה אחת'],
  ['⌚', 'סנכרון מהשעון', 'Garmin ו-Strava, הריצה מופיעה בלי לעשות כלום'],
];

/**
 * `journey`: draw the joining journey's header and tracker (the end of /join, where
 * the details were just saved). Defaults to on when the caller passes `firstName`
 * at all (/join does, possibly null); the in-app "the app on your phone" strip
 * (onboarding/PhoneAppStrip) passes neither, and a member already inside the app
 * is not mid-journey, so it gets the plain header.
 */
export function ContinueOnPhone({ token, firstName, onContinueHere, journey = firstName !== undefined }: {
  token: string; firstName?: string | null; onContinueHere: () => void; journey?: boolean;
}) {
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
    <div className="fixed inset-0 z-[60] overflow-y-auto" style={{ background: JOURNEY.page }} dir="rtl" role="dialog" aria-modal="true" aria-labelledby="cop-title" data-testid="continue-on-phone">
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="w-full max-w-[880px] overflow-hidden rounded-[28px] bg-white shadow-[0_18px_50px_rgba(0,0,0,0.08)]">
          <div className="[&>header]:rounded-none">
            <JourneyHero
              eyebrow={journey ? `✓ ${firstName ? `${firstName}, ` : ''}הפרטים נשמרו` : 'מועדון הריצה של מדרגות'}
              title={<span id="cop-title">ממשיכים בטלפון</span>}
              subtitle="מדרגות בנויה לטלפון. שם המאמן יכול לכתוב לכם, והריצות נכנסות לבד."
            />
          </div>
          {journey && <div className="mx-auto max-w-[520px] px-6 pt-6"><JourneyTracker done={2} computer /></div>}
          <div className="flex flex-col-reverse gap-8 p-6 md:flex-row md:items-stretch md:p-10 md:pt-6">
            <div className="min-w-0 flex-1">
              <ul>
                {WHY.map(([icon, title, sub], i) => (
                  <li key={title} className={i ? 'border-t' : ''} style={{ borderColor: JOURNEY.line }}>
                    <JourneyRow icon={icon} title={title} sub={sub} />
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-col gap-1">
                <PrimaryButton onClick={sendLink} disabled={mail === 'sending' || mail === 'sent'}>
                  {mail === 'sending' ? 'שולחים…' : mail === 'sent' ? '✓ נשלח למייל' : '✉️ שלחו לי את הקישור למייל'}
                </PrimaryButton>
                <SecondaryButton onClick={onContinueHere}>אמשיך במחשב בינתיים</SecondaryButton>
              </div>
              {mail === 'sent' && <p className="mt-2 text-[13px]" style={{ color: JOURNEY.soft }}>שלחנו{to ? <> אל <bdi dir="ltr">{to}</bdi></> : ''}. פותחים את המייל בטלפון ולוחצים על הקישור.</p>}
              {mail === 'error' && <p className="mt-2 text-[13px] font-bold" style={{ color: JOURNEY.red }}>לא הצלחנו לשלוח עכשיו. אפשר לסרוק את הקוד, או לנסות שוב.</p>}
            </div>
            <div className="flex w-full shrink-0 flex-col items-center rounded-[22px] p-6 text-center md:w-[260px]" style={{ background: JOURNEY.well }}>
              {link && <Qr url={link} />}
              <b className="mt-3 text-[15px]" style={{ color: JOURNEY.ink }}>סורקים עם מצלמת הטלפון</b>
              <span className="mt-0.5 text-[13px]" style={{ color: JOURNEY.soft }}>והטלפון ידריך בהתקנה, צעד אחר צעד</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
