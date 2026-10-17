'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { useAthleteId } from '@/lib/use-athlete-id';
import { BackNav, LoadingBlock } from '@/components/ui';
import { formatTime } from '@/lib/academy/benchmark';
import { recordScreenModel } from '@/lib/prs/record-history';
import { teammateHref } from '@/lib/athletes/profile-link';
import { cn } from '@/lib/utils';
import { RecordTimeline } from '@/components/profile/RecordTimeline';
import { RemoveRecordSheet, UndoToast, useRecordExclusion, type RecordChange } from '@/components/records/RecordRemoval';
import { markRecordSeen } from '@/components/records/NewRecordSheet';
import type { PrBreak, PrRow } from '@/components/profile/PrRecordList';
import { PR_DIST_KEYS, PR_RETURN_KEY, longDay, monthYear, prPace } from '@/components/profile/pr-format';

/**
 * One personal record, and how it got there (mockups/prs-tab/record-timeline-v3.html
 * and the edge cases in athletes-simulation.html, approved 2026-10-17).
 *
 * The record big, its pace and date under it; the timeline of every run that
 * broke it; and the same runs as a list, with what each one took off — tapping a
 * row opens that run.
 *
 * Under /dashboard/teammate/[id] because a record belongs to a profile, and any
 * member may open any member's profile and runs (/api/athletes/[id]/stats is
 * requireMember). Reads that same payload, which the profile has already loaded,
 * so opening this from the PRs tab costs no request.
 *
 * The edge cases, each one from a real athlete in the simulation:
 * - twelve breaks: the chart draws the last six and says "6 earlier"; the list has all;
 * - a stated record older than the watch: a dashed line over the watch's breaks,
 *   and the list starts with it, dashed, going nowhere;
 * - one break: no chart — a single dot reads as a bug — but a sentence;
 * - nothing at this distance: says so.
 */

interface Stats {
  prs: PrRow[];
  prHistory?: Record<string, PrBreak[]>;
  /** Runs taken out of each distance (migration 146), to put back from here. */
  prExcluded?: Record<string, Array<{ activityId: string; name: string | null; date: string }>>;
}

interface RunRecordsResponse {
  records: Array<{ bucket: string; seconds: number; current: boolean; instead: { seconds: number; date: string } | null }>;
}

const METERS: Record<string, number> = { '5k': 5000, '10k': 10000, hm: 21097, fm: 42195 };

export default function RecordPage() {
  const { id, bucket } = useParams<{ id: string; bucket: string }>();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('profile');
  const viewerId = useAthleteId();
  const own = !!viewerId && viewerId === id;

  const { data: stats, error } = useApi<Stats>(id ? `/api/athletes/${id}/stats` : null);
  const tr = useTranslations('records');

  // Opened from the "new record" alert (`?new=<run>`): celebrate that run, once.
  const newRun = useSearchParams()?.get('new') ?? null;
  useEffect(() => { if (newRun) markRecordSeen(newRun); }, [newRun]);

  // Taking a run out of this record (migration 146), from the ⋯ on its row. The
  // sheet's "goes back to" comes from the route the run page uses, so the two places
  // can't tell different stories.
  const ex = useRecordExclusion(own ? id : null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const { data: runRecords } = useApi<RunRecordsResponse>(removing && id ? `/api/athletes/${id}/records/run/${removing}` : null);
  const toast = (
    <UndoToast
      show={undo != null}
      message={tr('removedToast')}
      onUndo={() => { if (undo) void ex.restore(undo, bucket); setUndo(null); }}
      onGone={() => setUndo(null)}
    />
  );

  const label = PR_DIST_KEYS[bucket] ? t(PR_DIST_KEYS[bucket]) : bucket;
  const back = () => {
    // Back to the PRs tab it came from; a deep link has nowhere to go back to.
    try {
      sessionStorage.setItem(PR_RETURN_KEY, id);
    } catch {
      /* lands on Overview */
    }
    if (window.history.length > 1) router.back();
    else router.push(own ? '/dashboard/profile' : teammateHref(id) || '/feed');
  };

  const header = (
    <div className="flex items-center justify-between">
      <BackNav label={t('recBack')} onBack={back} className="mb-0" />
      <h1 className="text-[17px] font-extrabold text-ink-900">{label}</h1>
      <span className="w-[72px]" aria-hidden />
    </div>
  );

  if (!stats && !error) return <LoadingBlock className="min-h-[60vh]" />;

  const record = stats?.prs.find((p) => p.key === bucket);
  const breaks = stats?.prHistory?.[bucket] ?? [];
  const model = recordScreenModel(record ?? { seconds: null, date: null }, breaks);

  if (!record || model.empty) {
    return (
      <div className="mx-auto max-w-lg space-y-3 pb-8">
        {header}
        {toast}
        <section className="rounded-card bg-card px-4 py-6 text-center">
          <p className="text-sm font-bold text-ink-400">{t('recNone', { label })}</p>
        </section>
      </div>
    );
  }

  const seconds = record.seconds as number;
  const meters = record.meters ?? METERS[bucket] ?? 5000;
  const gain = (s: number) =>
    s >= 60 ? (
      // The minus and the number as one left-to-right run, or bidi puts the minus after it.
      <bdi dir="ltr">−{formatTime(s)}</bdi>
    ) : (
      <>
        <bdi dir="ltr">−{s}</bdi> {t('recSeconds')}
      </>
    );

  const lastBreak = breaks.at(-1);
  const celebrating = !!newRun && lastBreak?.activityId === newRun;
  const celebrateGain = celebrating && breaks.length >= 2 ? breaks.at(-2)!.seconds - lastBreak!.seconds : null;
  const removalChanges: RecordChange[] = (runRecords?.records ?? [])
    .filter((r) => r.bucket === bucket)
    .map((r) => ({ label, from: r.seconds, to: r.instead, current: r.current }));
  const excludedHere = own ? stats?.prExcluded?.[bucket] ?? [] : [];

  return (
    <div className="mx-auto max-w-lg space-y-3 pb-8">
      {header}

      {celebrating && lastBreak && (
        <p className="flex min-h-[40px] items-center justify-center gap-2 rounded-tile bg-gradient-to-b from-amber-100 to-amber-200 px-3 text-sm font-extrabold text-amber-900">
          {tr('newRecordBanner', { date: longDay(lastBreak.date, locale) })}
          {celebrateGain != null && celebrateGain > 0 && <span>· {gain(celebrateGain)}</span>}
        </p>
      )}

      <section className="rounded-card bg-card px-4 pb-2.5 pt-5 text-center">
        <p className="text-sm font-bold text-ink-400">{own ? t('recYours') : t('recTheirs')}</p>
        <p dir="ltr" className="mt-1 text-[56px] font-extrabold leading-[1.05] tracking-[-1.5px] tabular-nums text-ink-900">
          {formatTime(seconds)}
        </p>
        <p className="text-sm text-ink-400">
          <bdi dir="ltr">{prPace(seconds, meters)}</bdi> {t('prPerKm')}
          {record.date ? (
            <>
              {' · '}
              {longDay(record.date, locale)}
            </>
          ) : null}
        </p>
        {model.manual && (
          <span className="mt-2 inline-block rounded-pill bg-page/50 px-3 py-1 text-xs font-bold text-ink-400" dir="auto">
            {t('prEnteredByHand')}
            {record.note ? ` · ${record.note}` : ''}
          </span>
        )}

        {model.body === 'chart' && (
          <div className="-mx-1.5 mt-4">
            <RecordTimeline
              breaks={breaks}
              manualAbove={model.manualAbove}
              manualSeconds={seconds}
              manualNote={record.note ?? null}
              current
              locale={locale}
              earlierLabel={(n) => t('recEarlier', { n })}
              enteredLabel={t('recEntered')}
              ariaLabel={t('recChartAria', { label })}
              celebrate={celebrating}
            />
          </div>
        )}
        {model.body === 'single' && (
          <p className="mx-auto mb-2 mt-4 max-w-[300px] text-[13px] text-ink-400">
            {own ? t('recFirst') : t('recFirstPeer')}
          </p>
        )}
      </section>

      <section className="rounded-card bg-card px-4 py-3">
        <h2 className="mb-1 text-[15px] font-extrabold text-ink-900">
          {model.manual
            ? own
              ? t('recRecordsYou')
              : t('recRecordsPeer')
            : own
              ? t('recBrokenYou', { count: model.breakCount })
              : t('recBrokenPeer', { count: model.breakCount })}
        </h2>
        <ul>
          {model.rows.map((row, i) => {
            const body = (
              <>
                <span
                  className={cn(
                    'h-3 w-3 shrink-0 rounded-full border-[3px]',
                    row.kind === 'manual'
                      ? 'border-dashed border-ink-400 bg-card'
                      : row.current
                        ? 'border-brand-600 bg-brand-600'
                        : 'border-brand-600 bg-card',
                  )}
                />
                <span className="w-[84px] shrink-0 text-[13px] text-ink-400">
                  {row.date ? monthYear(row.date, locale) : ''}
                </span>
                <span className="shrink-0">
                  <span dir="ltr" className="text-[17px] font-extrabold tabular-nums text-ink-900">
                    {formatTime(row.seconds)}
                  </span>
                  {row.gain != null && row.gain > 0 && (
                    <span className="ms-1.5 text-xs font-bold text-accent-900">{gain(row.gain)}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-end text-xs text-ink-400" dir="auto">
                  {row.kind === 'manual'
                    ? record.note || t('prEnteredByHand')
                    : row.run?.activityName || t('prRunFallback')}
                </span>
              </>
            );
            const cls = 'flex min-h-[48px] min-w-0 flex-1 items-center gap-3 py-2';
            const runId = row.kind === 'run' ? row.run?.activityId ?? null : null;
            const href = runId ? `/dashboard/activities/${runId}` : null;
            return (
              <li key={`${row.kind}-${row.date}-${i}`} className="flex items-center border-b border-page/70 last:border-b-0">
                {href ? (
                  <Link href={href} className={cn(cls, 'active:opacity-60')}>
                    {body}
                    <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
                  </Link>
                ) : (
                  <div className={cls}>
                    {body}
                    <span className="w-4 shrink-0" aria-hidden />
                  </div>
                )}
                {/* The owner's way out for a run that shouldn't count — straight to the
                    confirmation; opening the run is what the row itself does. */}
                {own && runId && (
                  <button
                    type="button"
                    aria-label={tr('menuRemove')}
                    onClick={() => { ex.clearError(); setRemoving(runId); }}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-black text-ink-400 active:bg-page/60"
                  >
                    ⋯
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {excludedHere.length > 0 && (
        <section className="rounded-card bg-card px-4 py-3">
          <h2 className="mb-1 text-sm font-extrabold text-ink-900">{tr('excludedTitle')}</h2>
          <ul>
            {excludedHere.map((r) => (
              <li key={r.activityId} className="flex min-h-[48px] items-center gap-3 border-b border-page/70 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-sm text-ink-500" dir="auto">
                  {r.name || t('prRunFallback')} · {longDay(r.date, locale)}
                </span>
                <button
                  type="button"
                  disabled={ex.busy}
                  onClick={() => ex.restore(r.activityId, bucket)}
                  className="min-h-[40px] rounded-full bg-brand-600/10 px-4 text-sm font-bold text-brand-600"
                >
                  {tr('restore')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RemoveRecordSheet
        open={removing != null}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title={tr('removeTitleOne', { distance: label })}
        changes={removalChanges}
        busy={ex.busy || (removing != null && !runRecords)}
        error={ex.error}
        onConfirm={async () => {
          if (!removing) return;
          if (await ex.remove(removing, bucket)) { setUndo(removing); setRemoving(null); }
        }}
        dateLabel={(iso) => longDay(iso, locale)}
      />
      {toast}
    </div>
  );
}
