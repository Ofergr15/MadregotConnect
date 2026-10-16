'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BellOff, BellRing, X } from 'lucide-react';
import { useApi } from '@/lib/api';
import { useAthleteId } from '@/lib/use-athlete-id';
import { subscribeToPush } from '@/lib/pwa';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { cn } from '@/lib/utils';

// "Notifications aren't reaching this phone" (feedback #108, lib/push-health.ts).
// Shown only when the member HAS devices, none showed anything in a week, and pushes
// were sent to them — so a member who never enabled notifications, or simply had a
// quiet week, never sees it. One tap re-registers this phone (subscribeToPush drops
// the stale subscription and makes a new one) and sends a test, and the banner says
// what the test found rather than assuming. Dismissed, it comes back after 3 days.

const DISMISS_KEY = 'push-dead-dismissed-until';
const DISMISS_MS = 3 * 86_400_000;

type State = 'idle' | 'working' | 'back' | 'unconfirmed' | 'denied';

export function PushDeadBanner() {
  const t = useTranslations('pushDead');
  const athleteId = useAthleteId();
  const [dismissedUntil, setDismissedUntil] = useState(() => {
    if (typeof window === 'undefined') return 0;
    return Number(localStorage.getItem(DISMISS_KEY) || 0);
  });
  const [state, setState] = useState<State>('idle');
  const { data } = useApi<{ dead: boolean }>(
    athleteId ? `/api/push/health?athleteId=${encodeURIComponent(athleteId)}` : null,
    { revalidateOnFocus: false },
  );

  if (!data?.dead && state === 'idle') return null;
  if (state === 'idle' && dismissedUntil > Date.now()) return null;

  const fix = async () => {
    setState('working');
    const res = await subscribeToPush(athleteId);
    if (!res.ok) { setState(res.error === 'permission_denied' ? 'denied' : 'unconfirmed'); return; }
    try {
      const test = await fetch('/api/push/test', { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ athleteId }) });
      const body = await test.json().catch(() => ({}));
      setState((body?.confirmed ?? 0) > 0 ? 'back' : 'unconfirmed');
    } catch {
      setState('unconfirmed');
    }
  };

  const dismiss = () => {
    const until = Date.now() + DISMISS_MS;
    localStorage.setItem(DISMISS_KEY, String(until));
    setDismissedUntil(until);
    setState('idle');
  };

  const ok = state === 'back';
  return (
    <div className={cn('flex items-start gap-3 rounded-[20px] px-4 py-3', ok ? 'bg-accent-600/15' : 'bg-band-3/15')}>
      {ok ? <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-accent-900" /> : <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-band-3-ink" />}
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-bold', ok ? 'text-accent-900' : 'text-band-3-ink')}>
          {ok ? t('backTitle') : t('title')}
        </p>
        <p className={cn('mt-0.5 text-xs', ok ? 'text-accent-900' : 'text-band-3-ink')}>
          {state === 'back' ? t('backBody') : state === 'unconfirmed' ? t('unconfirmedBody') : state === 'denied' ? t('deniedBody') : t('body')}
        </p>
        {(state === 'idle' || state === 'working') && (
          <button
            type="button"
            onClick={fix}
            disabled={state === 'working'}
            className="mt-2 inline-flex min-h-[36px] items-center rounded-full bg-ink-900 px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            {state === 'working' ? t('working') : t('fix')}
          </button>
        )}
      </div>
      {!ok && (
        <button type="button" onClick={dismiss} aria-label={t('dismiss')} className="-m-1 grid h-9 w-9 shrink-0 place-items-center text-band-3-ink">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
