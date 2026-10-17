'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSWRConfig } from 'swr';
import { Check } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { apiHeaders } from '@/lib/api';
import { formatTime } from '@/lib/academy/benchmark';

/**
 * TAKING A RUN OUT OF THE RECORDS — the confirmation, the call and the undo, shared by
 * the run page ("השיאים בריצה הזו") and the record screen's ⋯ menu so the two can't
 * say different things about the same act (migration 146; Ofer, 2026-10-17).
 */

export const ALL = '*';

/** Every record surface reads one of these: refresh them all once a run moves. */
const RECORD_KEYS = /\/records|\/stats|\/api\/athletes\/prs|\/api\/club\/records/;

export function useRecordExclusion(athleteId: string | null) {
  const { mutate } = useSWRConfig();
  const t = useTranslations('records');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (method: 'POST' | 'DELETE', activityId: string, bucketKey: string) => {
    if (!athleteId) return false;
    setBusy(true);
    setError(null);
    try {
      const body = { athleteId, activityId, bucketKey };
      const res = method === 'POST'
        ? await fetch('/api/athletes/prs/exclusions', { method, headers: await apiHeaders(true), body: JSON.stringify(body) })
        : await fetch(`/api/athletes/prs/exclusions?${new URLSearchParams(body)}`, { method, headers: await apiHeaders() });
      if (!res.ok) {
        const code = ((await res.json().catch(() => ({}))) as { code?: string }).code;
        setError(code === 'migration-pending' ? t('removePending') : t('removeFailed'));
        return false;
      }
      await mutate((key: unknown) => typeof key === 'string' && RECORD_KEYS.test(key));
      return true;
    } catch {
      setError(t('removeFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [athleteId, mutate, t]);

  return {
    busy,
    error,
    clearError: () => setError(null),
    remove: (activityId: string, bucketKey: string) => call('POST', activityId, bucketKey),
    restore: (activityId: string, bucketKey: string) => call('DELETE', activityId, bucketKey),
  };
}

export interface RecordChange {
  /** Distance label, already translated. */
  label: string;
  from: number;
  /** The record that would stand instead; null when nothing else qualifies. */
  to: { seconds: number; date: string } | null;
  /** False when this run isn't the current record, so nothing visible moves. */
  current: boolean;
}

export function RemoveRecordSheet({ open, onOpenChange, title, changes, busy, error, onConfirm, dateLabel }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  changes: RecordChange[];
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  dateLabel: (iso: string) => string;
}) {
  const t = useTranslations('records');
  const tc = useTranslations('common');
  const moving = changes.filter(c => c.current);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <div className="px-1 pb-2">
        {moving.length > 0 ? (
          <>
            <p className="mb-3 text-sm text-ink-500">{t('removeIntro')}</p>
            <div className="mb-3 rounded-tile bg-page/60 px-3">
              {moving.map(c => (
                <div key={c.label} className="flex min-h-[48px] items-center gap-2 border-b border-page last:border-b-0">
                  <span className="w-16 flex-none text-xs font-bold text-ink-400">{c.label}</span>
                  {/* Old → new, each time its own LTR run so bidi can't swap them. */}
                  <span dir="ltr" className="text-sm font-bold tabular-nums text-ink-300 line-through">{formatTime(c.from)}</span>
                  <span aria-hidden className="text-ink-300">←</span>
                  {c.to ? (
                    <>
                      <span dir="ltr" className="text-base font-extrabold tabular-nums text-ink-900">{formatTime(c.to.seconds)}</span>
                      <span className="ms-auto text-xs text-ink-400">{dateLabel(c.to.date)}</span>
                    </>
                  ) : (
                    <span className="text-sm text-ink-400">{t('removeNone')}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mb-3 text-sm text-ink-500">{t('removeNoChange')}</p>
        )}
        <p className="mb-4 flex items-start gap-2 rounded-tile bg-accent-600/10 px-3 py-2.5 text-sm text-accent-900">
          <Check className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
          {t('removeKeep')}
        </p>
        {error && <p className="mb-2 text-center text-sm text-accent-red">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="min-h-[52px] w-full rounded-2xl bg-accent-red text-base font-extrabold text-white transition-opacity disabled:opacity-60"
        >
          {t('removeConfirm')}
        </button>
        <button type="button" onClick={() => onOpenChange(false)} className="mt-1 min-h-[44px] w-full text-sm font-bold text-ink-400">
          {tc('cancel')}
        </button>
      </div>
    </Sheet>
  );
}

/** "Removed · Undo", for five seconds — the cheapest way back from a wrong tap. */
export function UndoToast({ show, message, onUndo, onGone }: {
  show: boolean;
  message: string;
  onUndo: () => void;
  onGone: () => void;
}) {
  const t = useTranslations('records');
  useEffect(() => {
    if (!show) return;
    const id = setTimeout(onGone, 5000);
    return () => clearTimeout(id);
  }, [show, onGone]);
  if (!show) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-[max(24px,env(safe-area-inset-bottom))] z-[320] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-ink-900 px-4 py-3 text-sm text-white shadow-lg">
      <span>{message}</span>
      <button type="button" onClick={onUndo} className="min-h-[44px] px-2 font-bold text-primary-300">{t('undo')}</button>
    </div>
  );
}
