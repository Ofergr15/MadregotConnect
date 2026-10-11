'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Watch, Check, Upload, Loader2, RefreshCw } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { israelClock, watchDayState, type WatchDay } from '@/lib/watch/day-status';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { announceReadOnly, useViewAsReadOnly } from '@/lib/view-as-person';
import { bearerHeaders } from '@/lib/auth/bearer-headers';

interface WatchState {
  garminConnected: boolean;
  weekStartDate: string;
  hasPlan: boolean;
  onWatch: string[];
  /** Absent from a server older than this bundle: then a date in onWatch reads as 'sent'. */
  days?: Record<string, WatchDay>;
}

const GARMIN_CALENDAR = 'https://connect.garmin.com/modern/calendar';

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
  // Greyed while an admin views the app as this runner (lib/view-as-person.ts).
  const readOnly = useViewAsReadOnly();
  const [failed, setFailed] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

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

  // What we know, not what we hope (lib/watch/day-status): the account has it,
  // a later send replaced it, or a run came in stamped with it.
  const day = data.days?.[date] ?? (data.onWatch.includes(date) ? { sentAt: '', updatedAt: null, ran: false } : undefined);
  const state = watchDayState(day);

  if (state === 'ran') {
    return (
      <span className="inline-flex min-h-[44px] items-center gap-1.5 px-3 rounded-xl text-xs font-bold text-accent-900 bg-accent-600/10">
        <Check className="h-3.5 w-3.5" /> {t('ran')}
      </span>
    );
  }

  if (state === 'sent' || state === 'updated') {
    const time = day?.updatedAt ? israelClock(day.updatedAt) : '';
    return (
      <>
        <button
          type="button"
          onClick={() => setHowOpen(true)}
          className={cn(
            'inline-flex min-h-[44px] items-center gap-1.5 px-3 rounded-xl text-xs font-bold',
            state === 'updated' ? 'bg-[#FFF3D6] text-[#8A5A00]' : 'bg-brand-600/10 text-brand-600',
          )}
        >
          {state === 'updated' ? <RefreshCw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {state === 'updated' ? t('updated', { time }) : t('sent')}
          <span className="font-semibold opacity-80">· {state === 'updated' ? t('updatedHint') : t('sentHint')}</span>
        </button>
        <Sheet open={howOpen} onOpenChange={setHowOpen} title={t('sheetTitle')}>
          <div className="space-y-3 pb-2 text-start" dir="auto">
            <p className="text-sm leading-relaxed text-ink-500">{state === 'updated' ? t('sheetUpdated', { time }) : t('sheetBody')}</p>
            <ol className="space-y-2">
              {(['step1', 'step2', 'step3'] as const).map((k, i) => (
                <li key={k} className="flex items-start gap-3 text-sm text-ink-700">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-600">{i + 1}</span>
                  <span className="pt-1">{t(k)}</span>
                </li>
              ))}
            </ol>
            <a href={GARMIN_CALENDAR} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] items-center justify-center rounded-pill bg-brand-600 text-sm font-bold text-white">{t('openGarmin')}</a>
            <button type="button" onClick={() => setHowOpen(false)} className="flex min-h-[44px] w-full items-center justify-center rounded-pill text-sm font-bold text-ink-500">{t('close')}</button>
          </div>
        </Sheet>
      </>
    );
  }

  return (
    <button
      onClick={readOnly ? announceReadOnly : push}
      disabled={pushing}
      aria-disabled={readOnly || undefined}
      className={cn(
        'inline-flex min-h-[44px] items-center gap-1.5 px-3 rounded-xl text-xs font-bold bg-page/50 transition-colors disabled:opacity-60',
        readOnly ? 'text-ink-300' : 'text-ink-500 hover:text-ink-900 hover:bg-ink-300/40',
      )}
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
