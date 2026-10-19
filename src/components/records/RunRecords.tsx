'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Info, Trophy } from 'lucide-react';
import { useApi } from '@/lib/api';
import { runRecordsKey } from '@/lib/activity/open-hint';
import { formatTime } from '@/lib/academy/benchmark';
import { recordHref } from '@/components/profile/pr-format';
import { ALL, RemoveRecordSheet, UndoToast, useRecordExclusion, type RecordChange } from './RecordRemoval';

/**
 * "השיאים בריצה הזו" on a run's page: the records this run set, and the way to take
 * the run out of them without deleting it (Ofer, 2026-10-17: "go into the run, see
 * which records it broke, and remove the records without deleting the run").
 *
 * Renders nothing for an ordinary run. A treadmill run says why it never counts; a
 * run already taken out says so and offers to put it back. The remove buttons are
 * the owner's — the write route enforces that on its own.
 */

interface RunRecordsResponse {
  unmeasured: boolean;
  records: Array<{ bucket: string; seconds: number; current: boolean; instead: { seconds: number; date: string } | null }>;
  excludedFrom: string[];
}

export function RunRecords({ athleteId, activityId, owner }: { athleteId: string; activityId: string; owner: boolean }) {
  const t = useTranslations('records');
  const locale = useLocale();
  const { data } = useApi<RunRecordsResponse>(runRecordsKey(athleteId, activityId));
  const ex = useRecordExclusion(owner ? athleteId : null);
  const [asking, setAsking] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);

  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'he-IL', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }),
    [locale],
  );
  // The undo outlives the section: taking out a run's only record empties it.
  const toast = (
    <UndoToast
      show={undo != null}
      message={t('removedToast')}
      onUndo={() => { if (undo) void ex.restore(activityId, undo); setUndo(null); }}
      onGone={() => setUndo(null)}
    />
  );
  if (!data) return toast;
  const label = (bucket: string) => t(`bucket_${bucket}` as never);
  const allOut = data.excludedFrom.includes(ALL);

  if (data.unmeasured) {
    return (
      <>{toast}<section className="rounded-card bg-card p-4">
        <p className="flex items-start gap-2.5 rounded-tile bg-page/60 p-3 text-sm leading-relaxed text-ink-500">
          <Info className="mt-0.5 h-4 w-4 flex-none text-ink-400" aria-hidden />
          {t('runUnmeasured')}
        </p>
      </section></>
    );
  }
  if (allOut) {
    return (
      <>{toast}<section className="flex min-h-[56px] items-center justify-between gap-3 rounded-card bg-card px-4 py-2">
        <span className="text-sm text-ink-500">{t('runExcluded')}</span>
        {owner && (
          <button type="button" disabled={ex.busy} onClick={() => ex.restore(activityId, ALL)} className="min-h-[44px] rounded-full bg-brand-600/10 px-4 text-sm font-bold text-brand-600">
            {t('restore')}
          </button>
        )}
      </section></>
    );
  }
  if (data.records.length === 0) return toast;

  const changesFor = (bucket: string): RecordChange[] =>
    data.records
      .filter(r => bucket === ALL || r.bucket === bucket)
      .map(r => ({ label: label(r.bucket), from: r.seconds, to: r.instead, current: r.current }));
  const confirm = async () => {
    if (!asking) return;
    const done = await ex.remove(activityId, asking);
    if (done) { setUndo(asking); setAsking(null); }
  };

  return (
    <section className="rounded-card bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-base font-extrabold text-ink-900">
        <Trophy className="h-4 w-4 text-amber-500" aria-hidden /> {t('runRecordsTitle')}
      </h2>
      {data.records.map(r => (
        <div key={r.bucket} className="flex min-h-[56px] items-center gap-3 border-b border-page/60 py-2 last:border-b-0">
          <Link href={recordHref(athleteId, r.bucket) ?? '/dashboard/profile'} className="flex min-w-0 flex-1 items-center gap-3 active:opacity-60">
            <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950">
              <Trophy className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-ink-400">{label(r.bucket)}</span>
              <span className="flex items-center gap-2">
                <span dir="ltr" className="text-lg font-extrabold tabular-nums text-ink-900">{formatTime(r.seconds)}</span>
                <span className={r.current ? 'rounded-full bg-brand-600/10 px-2 py-0.5 text-3xs font-bold text-brand-600' : 'text-3xs text-ink-400'}>
                  {r.current ? t('runRecordCurrent') : t('runRecordPast')}
                </span>
              </span>
            </span>
          </Link>
          {owner && (
            <button type="button" onClick={() => { ex.clearError(); setAsking(r.bucket); }} className="min-h-[40px] flex-none rounded-full border border-ink-300/60 px-4 text-sm font-bold text-accent-red">
              {t('runRecordRemove')}
            </button>
          )}
        </div>
      ))}
      {owner && data.records.length > 1 && (
        <button type="button" onClick={() => { ex.clearError(); setAsking(ALL); }} className="mt-3 min-h-[46px] w-full rounded-tile bg-accent-red/10 text-sm font-bold text-accent-red">
          {t('runRecordRemoveAll')}
        </button>
      )}

      <RemoveRecordSheet
        open={asking != null}
        onOpenChange={o => { if (!o) setAsking(null); }}
        title={asking === ALL || asking == null ? t('removeTitleAll') : t('removeTitleOne', { distance: label(asking) })}
        changes={asking ? changesFor(asking) : []}
        busy={ex.busy}
        error={ex.error}
        onConfirm={confirm}
        dateLabel={iso => fmtDate.format(new Date(iso))}
      />
      {toast}
    </section>
  );
}
