'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, RotateCcw } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { apiHeaders } from '@/lib/api';
import { formatTime } from '@/lib/academy/benchmark';

/**
 * Correcting a personal record by hand.
 *
 * Every PR the app shows is derived from the run history, which is why two
 * reports exist: "my records here aren't correct" (a798197f) and "the personal
 * records — you can't update them, there are old results" (affd459d). The athlete
 * owns the answer to "what is your 10K?", and until now had no way to say it.
 *
 * ── WHY THIS LISTS EVERY BUCKET, INCLUDING THE EMPTY ONES ────────────────────
 * The card on the profile only draws buckets that have a time (`seconds != null`),
 * so an edit affordance hung off the tiles would reach exactly the records that
 * are already there. Both halves of the report are the other case: a race run
 * before joining the club has no tile at all, and a bogus derived best that was
 * hidden must be reachable again to bring it back. So the sheet lists the four
 * buckets, present or not, and every row is editable.
 *
 * Three actions per bucket, because there are three ways a derived best is wrong:
 * state the real time, hide a best the watch invented, or undo either and go back
 * to what the runs say. "Back to automatic" is deliberately always available —
 * a correction the athlete cannot take back is a worse trap than the wrong number.
 */

interface PrRow {
  key: string;
  label: string;
  seconds: number | null;
  date: string | null;
  source?: 'auto' | 'manual';
  note?: string | null;
}

/** ISO date for an <input type="date"> — the stored value may carry a time. */
function dateValue(date: string | null): string {
  return date ? date.slice(0, 10) : '';
}

export function PrEditSheet({
  open,
  onOpenChange,
  athleteId,
  prs,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  athleteId: string;
  /** ALL buckets, not just the achieved ones — see the note above. */
  prs: PrRow[];
  onSaved: () => void;
}) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');

  const [editing, setEditing] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [achievedOn, setAchievedOn] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = (pr: PrRow) => {
    setEditing(pr.key);
    // Pre-filled with what's on screen: most corrections are a few seconds off a
    // chip time, and retyping a whole time to change one digit is how a typo gets
    // in. A derived date is offered too, but only the date part.
    setTime(pr.seconds != null ? formatTime(pr.seconds) : '');
    setAchievedOn(dateValue(pr.date));
    setNote(pr.note || '');
    setError(null);
  };

  const close = () => {
    setEditing(null);
    setError(null);
    onOpenChange(false);
  };

  /**
   * The route answers a refusal with a `code`, not a sentence, so the wording is
   * chosen here — the API must not be the thing that decides what Hebrew the
   * athlete reads. An unrecognised code falls back to the generic message rather
   * than printing an English enum at them.
   */
  const messageFor = (code: string | undefined, fallback: string): string => {
    switch (code) {
      case 'unparseable': return t('prErrorFormat');
      case 'too-fast': return t('prErrorTooFast');
      case 'too-slow': return t('prErrorTooSlow');
      case 'not-migrated': return t('prErrorNotReady');
      default: return fallback;
    }
  };

  const send = async (init: RequestInit, url: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: await apiHeaders(true) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(messageFor(data.code, data.error || t('prSaveFailed')));
        return;
      }
      setEditing(null);
      onSaved();
    } catch {
      setError(t('prSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const save = (bucketKey: string, hidden: boolean) =>
    send(
      {
        method: 'PUT',
        body: JSON.stringify({
          athleteId,
          bucketKey,
          time: hidden ? undefined : time,
          achievedOn: hidden ? null : achievedOn || null,
          note: note.trim() || null,
          hidden,
        }),
      },
      '/api/athletes/prs',
    );

  const restore = (bucketKey: string) =>
    send(
      { method: 'DELETE' },
      `/api/athletes/prs?athleteId=${encodeURIComponent(athleteId)}&bucketKey=${encodeURIComponent(bucketKey)}`,
    );

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange(true); }} title={t('editPrs')}>
      <div className="space-y-3 pb-2">
        <p className="text-sm text-ink-400">{t('editPrsHint')}</p>

        {prs.map((pr) => (
          <div key={pr.key} className="rounded-tile bg-page/50 p-3">
            <button
              type="button"
              onClick={() => (editing === pr.key ? setEditing(null) : startEditing(pr))}
              className="flex w-full items-center justify-between gap-3 text-start"
            >
              <span className="text-sm font-bold text-ink-700">{pr.label}</span>
              <span className="flex items-center gap-2">
                {pr.source === 'manual' && (
                  <span className="rounded-md bg-brand-600/10 px-1.5 py-0.5 text-3xs font-bold text-brand-600">
                    {t('prManual')}
                  </span>
                )}
                {/* dir="ltr": a time is not RTL text — bidi moves the colon. */}
                <span dir="ltr" className="text-base font-bold tabular-nums text-ink-700">
                  {pr.seconds != null ? formatTime(pr.seconds) : '—'}
                </span>
              </span>
            </button>

            {editing === pr.key && (
              <div className="mt-3 space-y-3 border-t border-page pt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ink-400">{t('prTime')}</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="41:58"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full rounded-lg border border-page/50 bg-card px-3 py-2.5 text-sm tabular-nums text-ink-700 placeholder-ink-400 focus:border-brand-600/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ink-400">{t('prDate')}</label>
                    <input
                      type="date"
                      value={achievedOn}
                      onChange={(e) => setAchievedOn(e.target.value)}
                      className="w-full rounded-lg border border-page/50 bg-card px-3 py-2.5 text-sm text-ink-700 focus:border-brand-600/50 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-400">{t('prNote')}</label>
                  <input
                    type="text"
                    maxLength={200}
                    placeholder={t('prNotePlaceholder')}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full rounded-lg border border-page/50 bg-card px-3 py-2.5 text-sm text-ink-700 placeholder-ink-400 focus:border-brand-600/50 focus:outline-none"
                  />
                </div>

                {error && <p className="text-xs font-bold text-band-3-ink">{error}</p>}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy || !time.trim()}
                    onClick={() => save(pr.key, false)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {tc('save')}
                  </button>
                  {/* Hide is for the third case: the watch produced a best out of a
                      bad GPS lock, so there is no truer time to type. */}
                  <button
                    type="button"
                    disabled={busy || pr.seconds == null}
                    onClick={() => save(pr.key, true)}
                    className="rounded-lg bg-page px-3 py-2 text-sm font-bold text-ink-700 disabled:opacity-40"
                  >
                    {t('prHide')}
                  </button>
                  {pr.source === 'manual' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => restore(pr.key)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-ink-400 disabled:opacity-40"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('prRestoreAuto')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
