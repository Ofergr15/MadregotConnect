'use client';

import { useEffect, useState } from 'react';
import { apiHeaders } from '@/lib/api';
import { isComputer } from '@/lib/install/platform';
import { useOnboarding } from '@/lib/onboarding/use-onboarding';
import { ContinueOnPhone } from '@/components/install/ContinueOnPhone';

// ═════════════════════════════════════════════════════════════════════════════
// The computer's quiet reminder: "the app on your phone isn't installed yet"
// (mockup ~/.cache/madregot/desktop-onb/mockup.html, screen 4). Computer only,
// only for a member who has not opened the app on a phone (lib/onboarding/
// phone-app), "×" hides it for 7 days, and the first phone open removes it for
// good. "Install" opens the same "continue on the phone" screen as /join.
//
// PhoneOpenBeacon is the other half: on a phone it tells the server, once per
// device and member, that the app ran there.
// ═════════════════════════════════════════════════════════════════════════════

const HIDE_KEY = 'mc-phone-strip-hidden-until';
const SENT_KEY = 'mc-phone-open-sent';

export function PhoneAppStrip() {
  const { data } = useOnboarding();
  const [computer, setComputer] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setComputer(isComputer());
    try { setHidden(Number(localStorage.getItem(HIDE_KEY) || 0) > Date.now()); } catch { setHidden(false); }
  }, []);
  if (!computer || hidden || !data || !data.applicable || data.phoneApp?.opened !== false) return null;
  const token = data.phoneApp.link?.match(/\/join\/([^/?#]+)/)?.[1] ?? null;
  const hide = () => {
    try { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 24 * 3600 * 1000)); } catch { /* ignore */ }
    setHidden(true);
  };
  return (
    <>
      <div className="mx-auto mb-3 flex max-w-xl items-center gap-3 rounded-[20px] bg-brand-600/10 px-4 py-3" dir="rtl" data-testid="phone-app-strip">
        <span className="text-xl" aria-hidden>📱</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink-700">האפליקציה בטלפון עוד לא מותקנת</p>
          <p className="text-xs text-ink-500">שם מגיעות ההתראות מהמאמן</p>
        </div>
        {token && (
          <button type="button" onClick={() => setOpen(true)} className="min-h-[38px] rounded-pill border border-page bg-card px-4 text-sm font-bold text-ink-700">
            להתקנה
          </button>
        )}
        <button type="button" onClick={hide} aria-label="להסתיר לשבוע" className="min-h-[38px] px-1 text-lg text-ink-400">×</button>
      </div>
      {open && token && <ContinueOnPhone token={token} onContinueHere={() => setOpen(false)} />}
    </>
  );
}

export function PhoneOpenBeacon() {
  useEffect(() => {
    if (isComputer()) return;
    let id = '';
    try { id = localStorage.getItem('athlete_id') || ''; } catch { return; }
    if (!id) return;
    try { if (localStorage.getItem(SENT_KEY) === id) return; } catch { return; }
    (async () => {
      const res = await fetch('/api/onboarding/phone-open', { method: 'POST', headers: await apiHeaders(true) }).catch(() => null);
      if (res?.ok) { try { localStorage.setItem(SENT_KEY, id); } catch { /* ignore */ } }
    })();
  }, []);
  return null;
}
