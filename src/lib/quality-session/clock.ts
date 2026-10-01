// The quality session's "now", in Israel, with the super user's time travel:
// `?at=YYYY-MM-DDTHH:MM` on any page that reads it sets the moment for the tab
// (sessionStorage), `?at=off` clears it. Read by the feed row and the screen only.

import { israelNow, israelToday } from '@/lib/utils';
import { parseAt, type QsClock } from './model';

const KEY = 'mc-quality-at';

export function readClock(): QsClock {
  if (typeof window !== 'undefined') {
    try {
      const q = new URLSearchParams(window.location.search).get('at');
      if (q === 'off') sessionStorage.removeItem(KEY);
      else if (q && parseAt(q)) sessionStorage.setItem(KEY, q);
      const at = parseAt(sessionStorage.getItem(KEY));
      if (at) return { ...at, travelling: true };
    } catch { /* storage blocked: the real clock */ }
  }
  const { hour, minute } = israelNow();
  return { date: israelToday(), minutes: hour * 60 + minute, travelling: false };
}
