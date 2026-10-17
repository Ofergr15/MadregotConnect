'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Sheet } from '@/components/ui';
import { useApi } from '@/lib/api';
import { formatTime } from '@/lib/academy/benchmark';
import { RecordTimeline } from '@/components/profile/RecordTimeline';
import type { PrBreak, PrRow } from '@/components/profile/PrRecordList';
import { PR_DIST_KEYS } from '@/components/profile/pr-format';

/**
 * "שיא חדש" — once, on the next open after a record broke, for everyone: the members
 * without push, and the ones who swiped the push away. It is the same record the push
 * announced (GET /api/athletes/me/new-record reads that notification's row), drawn
 * with the record screen's own timeline off the stats payload the profile loads.
 *
 * Once per run, per device: dismissing it, or reaching the record screen any other way
 * (the push itself), marks the run seen.
 */
const SEEN_KEY = 'record_seen';

function seen(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[]; } catch { return []; }
}

export function markRecordSeen(activityId: string) {
  try {
    const list = seen().filter(id => id !== activityId);
    // Only the last few matter: the endpoint only ever answers with this week's.
    localStorage.setItem(SEEN_KEY, JSON.stringify([activityId, ...list].slice(0, 20)));
  } catch { /* private mode: it shows again next time, which is harmless */ }
}

interface NewRecordResponse { record: { bucket: string; activityId: string; url: string } | null }
interface Stats { prs: PrRow[]; prHistory?: Record<string, PrBreak[]> }

/** Another sheet already up (What's new, onboarding): wait for it rather than stack. */
const otherSheetOpen = () => typeof document !== 'undefined'
  && !!document.querySelector('[data-vaul-drawer][data-state="open"], [role="dialog"][aria-modal="true"]');

export function NewRecordSheet() {
  const t = useTranslations('records');
  const tp = useTranslations('profile');
  const locale = useLocale();
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => setMe(localStorage.getItem('athlete_id')), []);

  const { data } = useApi<NewRecordResponse>(me ? '/api/athletes/me/new-record' : null, { revalidateOnFocus: true });
  const fresh = data?.record && !seen().includes(data.record.activityId) ? data.record : null;
  // The profile's own payload — SWR shares it with the profile and the record screen.
  const { data: stats } = useApi<Stats>(fresh && me ? `/api/athletes/${me}/stats` : null);
  const breaks = fresh ? stats?.prHistory?.[fresh.bucket] ?? [] : [];

  const [open, setOpen] = useState(false);
  // Only while it is still the record that run set: a later break, or the run taken
  // out of the records, makes it old news.
  const valid = !!fresh && breaks.at(-1)?.activityId === fresh.activityId;
  useEffect(() => {
    if (!valid || open) return;
    let tries = 0;
    const id = setInterval(() => {
      if (!otherSheetOpen()) { setOpen(true); clearInterval(id); }
      else if (++tries > 30) clearInterval(id);
    }, 1500);
    return () => clearInterval(id);
  }, [valid, open]);

  if (!fresh || !valid) return null;
  const last = breaks.at(-1)!;
  const before = breaks.at(-2);
  const gain = before ? before.seconds - last.seconds : null;
  const distance = PR_DIST_KEYS[fresh.bucket] ? tp(PR_DIST_KEYS[fresh.bucket]) : fresh.bucket;
  const close = () => { markRecordSeen(fresh.activityId); setOpen(false); };

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) close(); }}>
      <div className="px-1 pb-2 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-2xl shadow-[0_6px_18px_rgba(245,158,11,0.35)]" aria-hidden>🏆</div>
        <p className="mt-3 text-base font-extrabold text-brand-600">{t('newRecordTitle', { distance })}</p>
        <p dir="ltr" className="text-[52px] font-extrabold leading-none tracking-tight tabular-nums text-ink-900">{formatTime(last.seconds)}</p>
        {gain != null && gain > 0 && (
          <p className="mt-2 inline-block rounded-full bg-accent-600/10 px-3 py-1 text-sm font-bold text-accent-900">
            {gain >= 60 ? <bdi dir="ltr">−{formatTime(gain)}</bdi> : <><bdi dir="ltr">−{gain}</bdi> {tp('recSeconds')}</>} {t('newRecordGain')}
          </p>
        )}
        {breaks.length >= 2 && (
          <div className="-mx-1.5 mt-3">
            <RecordTimeline
              breaks={breaks}
              manualAbove={false}
              manualSeconds={null}
              manualNote={null}
              current
              celebrate
              locale={locale}
              earlierLabel={(n) => tp('recEarlier', { n })}
              enteredLabel={tp('recEntered')}
              ariaLabel={tp('recChartAria', { label: distance })}
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => { close(); router.push(fresh.url); }}
          className="mt-4 min-h-[52px] w-full rounded-2xl bg-brand-600 text-base font-extrabold text-white"
        >
          {t('newRecordCta')}
        </button>
        <button type="button" onClick={close} className="mt-1 min-h-[44px] w-full text-sm font-bold text-ink-400">
          {t('newRecordLater')}
        </button>
      </div>
    </Sheet>
  );
}
