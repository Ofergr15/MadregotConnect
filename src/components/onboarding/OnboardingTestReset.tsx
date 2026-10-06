'use client';

// `?onb=reset` for the super user: forget the first run on this account and this
// device, so the whole onboarding (install, tour, notifications, the setup card,
// what's new) can be walked again as a new member would. The server half is
// POST /api/onboarding { resetForTest } and refuses anyone else. Notification
// permission itself cannot be reset from a page: removing the home-screen icon
// does that on an iPhone.

import { useEffect } from 'react';
import { mutate } from 'swr';
import { useIsSuperUser } from '@/lib/impersonation';
import { apiHeaders } from '@/lib/api';
import { ONBOARDING_KEY } from '@/lib/onboarding/use-onboarding';

const LOCAL_KEYS = /^(pwa_install_|push_step_|setup_nudge:|mc:whatsNew|mc-install-video-seen)/;

export function OnboardingTestReset() {
  const superUser = useIsSuperUser();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('onb') !== 'reset' || !superUser) return;
    url.searchParams.delete('onb');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    (async () => {
      const res = await fetch('/api/onboarding', { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify({ resetForTest: true }) });
      if (!res.ok) return;
      for (const k of Object.keys(localStorage)) if (LOCAL_KEYS.test(k)) localStorage.removeItem(k);
      sessionStorage.clear();
      localStorage.setItem('mc-onb-v2', '1');
      await mutate(ONBOARDING_KEY);
      window.location.reload();
    })().catch(() => {});
  }, [superUser]);
  return null;
}
