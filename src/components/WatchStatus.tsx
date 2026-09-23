'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Watch, Check, Upload, Loader2 } from 'lucide-react';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';

interface WatchState {
  garminConnected: boolean;
  weekStartDate: string;
  hasPlan: boolean;
  onWatch: string[];
}

/**
 * "Is this on my watch?", on the card that shows the session it's about.
 *
 * The state already existed — `workout_deliveries` records, per athlete per date,
 * whether Garmin confirmed the workout — and was visible only to coaches
 * (bc77a4a2). This is the athlete's half: the answer where they will actually
 * read it, plus the one tap that fixes a no.
 *
 * Three things it deliberately does NOT do:
 *
 *  - It does not render while the answer is unknown. A row that says "not on your
 *    watch" for the second before the fetch lands is worse than silence: somebody
 *    reads it, taps, and re-pushes a week that was already there.
 *  - It does not appear for an athlete with no Garmin account. There is no watch,
 *    the button could do nothing, and "not on your watch" would read as a fault.
 *  - It claims nothing stronger than Garmin confirmed. `onWatch` is built from
 *    'success' rows only, which are written after a workout is read back off the
 *    account — never from "the POST didn't throw". A watch that hasn't synced yet
 *    still hasn't got it, and that is the one gap this can't close: the honest
 *    claim is "Garmin has it for that day", which is what the copy says.
 */
export function WatchStatus({ date }: { date: string }) {
  const t = useTranslations('watchStatus');
  const { data, mutate } = useApi<WatchState>('/api/my-watch');
  const [pushing, setPushing] = useState(false);
  const [failed, setFailed] = useState(false);

  const push = async () => {
    setPushing(true);
    setFailed(false);
    try {
      const res = await fetch('/api/my-watch', { method: 'POST', headers: await bearerHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      // The route answers with the same shape GET does, read back after the push
      // — so the row redraws from what the delivery table says, not from the
      // assumption that a 200 means it landed.
      await mutate(await res.json(), { revalidate: false });
    } catch {
      setFailed(true);
    } finally {
      setPushing(false);
    }
  };

  // Unknown, no watch, or no plan to put on it — say nothing at all.
  if (!data || !data.garminConnected || !data.hasPlan) return null;

  const onWatch = data.onWatch.includes(date);

  if (onWatch) {
    return (
      <span className="inline-flex min-h-[44px] items-center gap-1.5 px-3 rounded-xl text-xs font-bold text-accent-900 bg-accent-600/10">
        <Check className="h-3.5 w-3.5" /> {t('onWatch')}
      </span>
    );
  }

  return (
    <button
      onClick={push}
      disabled={pushing}
      className="inline-flex min-h-[44px] items-center gap-1.5 px-3 rounded-xl text-xs font-bold text-ink-500 hover:text-ink-900 bg-page/50 hover:bg-ink-300/40 transition-colors disabled:opacity-60"
    >
      {pushing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : failed ? (
        <Watch className="h-3.5 w-3.5" />
      ) : (
        <Upload className="h-3.5 w-3.5" />
      )}
      {pushing ? t('sending') : failed ? t('failed') : t('sendToWatch')}
    </button>
  );
}
