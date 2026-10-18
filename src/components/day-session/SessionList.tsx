'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, X } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import { CARD, SectionLabel } from '@/components/academy/book/ui';
import { numberRuns, type DaySession } from '@/lib/day-session/model';
import { workoutSummary } from '@/lib/day-session/workout';

/**
 * THE COACH'S ONE-DAY SESSIONS, EACH IN ITS OWN BOX (Ofer, 2026-10-18,
 * mockups/day-session-manage) — the screen opens here. Each box says what the session is
 * and where it stands (on the feed, on how many watches, nutrition), and holds the two
 * actions on it: edit opens the form on that date, delete asks first and says what will
 * happen.
 *
 * Delete takes the session off the watches FIRST, one runner at a time, each removal checked
 * back with Garmin (api/day-session/remove), and shows every answer as it comes. Only then
 * is the row deleted. When some watch could not be reached the coach sees who, and chooses:
 * try those again, or delete anyway.
 */

interface ListAnswer { setup: boolean; sessions: DaySession[]; watches: Record<string, number> }
interface Holder { athleteId: string; name: string; apple: boolean }
type RunnerState = 'waiting' | 'working' | 'removed' | 'failed';

const AT_ONCE = 3;
const RICH_RUN = (text: string) => numberRuns(text).map((r, i) => (r.ltr ? <bdi key={i} dir="ltr">{r.text}</bdi> : <span key={i}>{r.text}</span>));

export function SessionList({ today, tomorrow, dateLabel, onEdit, onNew }: {
  today: string;
  tomorrow: string;
  dateLabel: (date: string) => string;
  onEdit: (date: string) => void;
  onNew: () => void;
}) {
  const t = useTranslations('daySession');
  const tc = useTranslations('common');
  const dayNames = tc.raw('dayNames') as string[];
  const { data, mutate } = useApi<ListAnswer>('/api/day-session?list=1');
  const [deleting, setDeleting] = useState<DaySession | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const when = (d: string) => (d === today ? t('today') : d === tomorrow ? t('tomorrow') : dateLabel(d));

  return (
    <>
      <SectionLabel>{t('listHeader')}</SectionLabel>
      {data && data.sessions.length === 0 && <p className="px-1 text-sm text-ink-400">{t('listEmpty')}</p>}
      {data?.sessions.map((s) => {
        const watches = data.watches[s.date] ?? 0;
        const summary = workoutSummary(s.steps);
        return (
          <div key={s.id} className={cn(CARD, 'overflow-hidden')}>
            <div className="flex gap-3 p-3.5">
              <div className="flex w-[52px] flex-none flex-col items-center justify-center rounded-xl bg-brand-600/10 py-2">
                <b className="text-sm text-brand-600">{dayNames[new Date(`${s.date}T12:00:00`).getDay()]}</b>
                <bdi dir="ltr" className="text-13 text-ink-500">{s.date.slice(8, 10)}.{s.date.slice(5, 7)}</bdi>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-13 font-bold text-ink-400">
                  {/* Today / tomorrow say something the date box doesn't; a later date would only repeat it. */}
                  {[s.date === today ? t('today') : s.date === tomorrow ? t('tomorrow') : null].filter(Boolean)}
                  {(s.date === today || s.date === tomorrow) && s.startTime && ' · '}
                  {s.startTime && <bdi dir="ltr">{s.startTime}</bdi>}
                </p>
                <p className="text-[21px] font-extrabold leading-tight text-ink-900">{RICH_RUN(s.title || summary)}</p>
                {summary && summary !== s.title && <p className="truncate text-sm text-ink-700">{RICH_RUN(summary)}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip ok={!!s.publishedAt}>{s.publishedAt ? t('chipInFeed') : t('chipHidden')}</Chip>
                  <Chip ok={watches > 0}>⌚ {watches > 0 ? t('chipWatches', { n: watches }) : t('chipNoWatches')}</Chip>
                  {s.nutrition.length > 0 && <Chip>🍌 {t('nutrition')}</Chip>}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 border-t border-[#EFEFF4]">
              <button type="button" onClick={() => onEdit(s.date)} className="min-h-[48px] border-e border-[#EFEFF4] text-[15px] font-extrabold text-brand-600">
                ✎ {t('cardEdit')}
              </button>
              <button type="button" onClick={() => setDeleting(s)} className="min-h-[48px] text-[15px] font-extrabold text-accent-red">
                🗑 {t('cardDelete')}
              </button>
            </div>
          </div>
        );
      })}
      <button type="button" onClick={onNew} className="min-h-[52px] w-full rounded-[22px] border-[1.5px] border-dashed border-brand-600/40 bg-white text-[15px] font-extrabold text-brand-600">
        ＋ {t('newSession')}
      </button>

      {deleting && (
        <DeleteFlow
          session={deleting}
          watches={data?.watches[deleting.date] ?? 0}
          label={`${dayNames[new Date(`${deleting.date}T12:00:00`).getDay()]} ${deleting.date.slice(8, 10)}.${deleting.date.slice(5, 7)}`}
          whenText={when(deleting.date)}
          onClose={() => setDeleting(null)}
          onDeleted={(label) => {
            setDeleting(null);
            setToast(t('deletedDay', { day: label }));
            void mutate();
            setTimeout(() => setToast(null), 4000);
          }}
        />
      )}
      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-[max(24px,env(safe-area-inset-bottom))] z-[320] mx-auto max-w-md rounded-2xl bg-ink-900 px-4 py-3 text-sm text-white shadow-lg">{toast}</div>
      )}
    </>
  );
}

function Chip({ ok = false, children }: { ok?: boolean; children: React.ReactNode }) {
  return <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', ok ? 'bg-accent-600/10 text-accent-900' : 'bg-page text-ink-500')}>{children}</span>;
}

function DeleteFlow({ session, watches, label, whenText, onClose, onDeleted }: {
  session: DaySession;
  watches: number;
  label: string;
  whenText: string;
  onClose: () => void;
  onDeleted: (label: string) => void;
}) {
  const t = useTranslations('daySession');
  const [stage, setStage] = useState<'confirm' | 'working' | 'partial'>('confirm');
  const [holders, setHolders] = useState<Holder[]>([]);
  const [state, setState] = useState<Record<string, { s: RunnerState; error?: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const summary = workoutSummary(session.steps);

  const deleteRow = async () => {
    const res = await fetch(`/api/day-session?date=${session.date}`, { method: 'DELETE', headers: await apiHeaders() });
    if (!res.ok && res.status !== 404) throw new Error(String(res.status));
    onDeleted(label);
  };

  // Each runner in turn, a few at a time; every answer lands on screen as it comes.
  const removeAll = async (list: Holder[]) => {
    setStage('working');
    setError(null);
    setState((prev) => ({ ...prev, ...Object.fromEntries(list.map((h) => [h.athleteId, { s: 'waiting' as RunnerState }])) }));
    const results: Record<string, boolean> = {};
    let next = 0;
    const headers = await apiHeaders(true);
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, list.length) }, async () => {
      while (next < list.length) {
        const h = list[next++]!;
        setState((prev) => ({ ...prev, [h.athleteId]: { s: 'working' } }));
        let ok = false;
        let why: string | undefined;
        try {
          const res = await fetch('/api/day-session/remove', { method: 'POST', headers, body: JSON.stringify({ date: session.date, athleteId: h.athleteId }) });
          const body = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
          ok = res.ok && body?.status === 'removed';
          why = ok ? undefined : body?.error || t('removeFailedGeneric');
        } catch {
          why = t('removeFailedGeneric');
        }
        results[h.athleteId] = ok;
        setState((prev) => ({ ...prev, [h.athleteId]: ok ? { s: 'removed' } : { s: 'failed', error: why } }));
      }
    }));
    if (Object.values(results).every(Boolean)) {
      try { await deleteRow(); } catch { setError(t('deleteFailed')); setStage('partial'); }
    } else {
      setStage('partial');
    }
  };

  const start = async () => {
    setStage('working');
    try {
      const res = await fetch(`/api/day-session/remove?date=${session.date}`, { headers: await apiHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const list = ((await res.json()) as { holders: Holder[] }).holders;
      setHolders(list);
      if (!list.length) { await deleteRow(); return; }
      await removeAll(list);
    } catch {
      setError(t('deleteFailed'));
      setStage('confirm');
    }
  };

  const done = holders.filter((h) => state[h.athleteId]?.s === 'removed').length;
  const failed = holders.filter((h) => state[h.athleteId]?.s === 'failed');

  return (
    <Sheet open onOpenChange={(o) => { if (!o && stage !== 'working') onClose(); }} title={t('deleteTitle', { day: label })}>
      <div className="px-1 pb-2">
        <div className="mb-3 rounded-xl bg-page/70 px-3 py-2.5">
          <p className="text-sm font-bold text-ink-900">{whenText}{session.startTime && <> · <bdi dir="ltr">{session.startTime}</bdi></>} · {RICH_RUN(session.title || summary)}</p>
          {summary && summary !== session.title && <p className="text-13 text-ink-500">{RICH_RUN(summary)}</p>}
        </div>

        {stage === 'confirm' && (
          <>
            <p className="mb-1 text-xs font-bold text-ink-400">{t('whatHappens')}</p>
            <ul className="mb-2 space-y-1">
              <Line ok>{t('happensFeed')}</Line>
              <Line ok>{watches > 0 ? t('happensWatches', { n: watches }) : t('happensNoWatches')}</Line>
              {session.notifiedAt && <Line>{t('happensPushStays')}</Line>}
            </ul>
            {error && <p className="mb-2 text-center text-sm text-accent-red">{error}</p>}
            <button type="button" onClick={() => void start()} className="mt-2 min-h-[52px] w-full rounded-2xl bg-accent-red text-base font-extrabold text-white">
              {t('deleteDayConfirm', { day: label })}
            </button>
            <button type="button" onClick={onClose} className="mt-1 min-h-[44px] w-full text-sm font-bold text-ink-400">{t('cancel')}</button>
          </>
        )}

        {stage !== 'confirm' && (
          <>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-bold text-ink-900">
                {stage === 'working' ? t('removingFromWatches') : t('removedPartial')}
              </p>
              {holders.length > 0 && <bdi dir="ltr" className="text-sm font-extrabold tabular-nums text-ink-700">{done}/{holders.length}</bdi>}
            </div>
            {holders.length > 0 && (
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-page">
                <div className="h-full rounded-full bg-accent-600 transition-[width]" style={{ width: `${(done / holders.length) * 100}%` }} />
              </div>
            )}
            <ul className="max-h-[40vh] overflow-y-auto">
              {holders.map((h) => {
                const st = state[h.athleteId] ?? { s: 'waiting' };
                return (
                  <li key={h.athleteId} className="flex min-h-[40px] items-center gap-2 border-b border-page text-sm">
                    <span className="grid h-6 w-6 flex-none place-items-center">
                      {st.s === 'removed' ? <Check className="h-4 w-4 text-accent-600" strokeWidth={3} />
                        : st.s === 'failed' ? <X className="h-4 w-4 text-accent-red" strokeWidth={3} />
                          : st.s === 'working' ? <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
                            : <span className="h-1.5 w-1.5 rounded-full bg-ink-300" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate" dir="auto">{h.name}</span>
                    <span className={cn('flex-none text-xs', st.s === 'failed' ? 'text-accent-red' : 'text-ink-400')}>
                      {st.s === 'removed' ? t('runnerRemoved') : st.s === 'failed' ? st.error : st.s === 'working' ? t('runnerWorking') : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
            {error && <p className="mt-2 text-center text-sm text-accent-red">{error}</p>}
            {stage === 'partial' && (
              <>
                {failed.length > 0 && (
                  <button type="button" onClick={() => void removeAll(failed)} className="mt-3 min-h-[50px] w-full rounded-2xl bg-brand-600 text-base font-extrabold text-white">
                    {t('retryFailed', { n: failed.length })}
                  </button>
                )}
                <button type="button" onClick={() => { void deleteRow().catch(() => setError(t('deleteFailed'))); }} className="mt-2 min-h-[48px] w-full rounded-2xl border border-accent-red/40 text-[15px] font-extrabold text-accent-red">
                  {t('deleteAnyway', { n: failed.length })}
                </button>
                <button type="button" onClick={onClose} className="mt-1 min-h-[44px] w-full text-sm font-bold text-ink-400">{t('keepSession')}</button>
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function Line({ ok = false, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex min-h-[32px] items-center gap-2 text-[15px] text-ink-900">
      <span className={cn('grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-xs font-extrabold', ok ? 'bg-accent-600/10 text-accent-900' : 'bg-page text-ink-400')}>
        {ok ? '✓' : '✕'}
      </span>
      {children}
    </li>
  );
}
