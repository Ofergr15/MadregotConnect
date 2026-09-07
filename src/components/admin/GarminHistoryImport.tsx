'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { History, Loader2, CheckCircle2, AlertTriangle, Watch } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { InsetSection, InsetRow, SkeletonList } from '@/components/ui';

// ═════════════════════════════════════════════════════════════════════════════
// IMPORT GARMIN HISTORY — the hand on the lever for lib/garmin/history-backfill.
//
// The sync has only ever asked Garmin for page zero, a hundred activities, so
// every athlete's visible past ends whenever their hundredth-most-recent run
// happened to be. That is not a number anyone can act on from a graph: it has to
// be walked back, per athlete, and somebody has to be able to see it happening
// and stop it. Hence a screen rather than a cron — the first run of this touches
// thousands of rows and the person running it should watch the first athlete
// finish before starting the club.
//
// The paging loop lives HERE, in the browser, and not in the route:
//
//   • The route's ceiling is 300s. A few Garmin pages per request sit comfortably
//     inside it; a whole athlete's decade does not, and a whole club's is not even
//     close. Bounded requests in a loop cannot time out halfway through and leave
//     nobody knowing how far it got — and each one that lands is progress that a
//     later failure cannot take back.
//   • `fromPage` is one number for the whole call, so a single server-side walk
//     over every athlete would advance them all in lockstep — and they exhaust
//     at wildly different depths (the twice-a-day runner is still going when the
//     three-times-a-week runner ran out four pages ago). One athlete at a time
//     is the only shape where "resume from page 7" means anything.
//   • Progress is per athlete and visible while it happens, which is the whole
//     reason this isn't a fire-and-forget button.
//
// Re-running it is free and safe: `garmin_activity_id` de-duplicates, so a
// second walk over the same pages imports nothing and simply confirms the count.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Garmin list pages per request. Four ≈ 400 activities.
 *
 * Two, originally — chosen against a 60s budget the route did not actually have
 * (it declared no ceiling at all, so the platform applied a much shorter default
 * and killed the request with no error body). With the ceiling declared and the
 * per-activity duplicate query gone, the work per page is one Garmin fetch and
 * one batched insert, so fewer, larger requests now beat more, smaller ones.
 */
const PAGES_PER_REQUEST = 4;

/**
 * Attempts per page before the walk gives up on an athlete. A history walk is
 * long enough that a single transient failure — a Garmin hiccup, a cold start,
 * one dropped connection — should not end it, and retrying is free of side
 * effects: the same page re-read imports the same rows, and the unique index
 * throws them away.
 */
const ATTEMPTS_PER_PAGE = 3;

/**
 * How long the browser waits for one request. Below the route's own ceiling on
 * purpose: if a request is going to take longer than this something is wrong with
 * it, and a retry is more likely to succeed than the wait is.
 */
const REQUEST_TIMEOUT_MS = 150_000;

/**
 * Requests per athlete before the loop gives up on its own. 15 × 4 pages clears
 * the backfill's own MAX_PAGE ceiling of 50, so this can only ever stop at the
 * same place the server would — it exists so a server that kept handing back a
 * `nextPage` couldn't spin the browser forever.
 */
const MAX_ROUNDS = 15;

interface AthleteRow {
  id: string;
  name: string;
  hasWatch?: boolean;
}

type HistoryAthlete = {
  athleteId: string;
  name: string | null;
  imported: number;
  scanned: number;
  pagesFetched: number;
  oldestStored: string | null;
  nextPage: number | null;
  error?: string;
};

type HistoryResponse = { athletes?: HistoryAthlete[]; imported?: number; more?: boolean };

type Progress = {
  imported: number;
  pages: number;
  oldest: string | null;
  running: boolean;
  done: boolean;
  /**
   * Where the next attempt should start. Kept even after a failure or a Stop, so
   * pressing Import again continues the walk instead of re-reading from the top —
   * the difference between "carry on" and "start the twenty pages over".
   */
  nextPage: number;
  /** Garmin has no credential for this athlete — the route returned no result row. */
  noGarmin?: boolean;
  error?: string;
};

/** "12.05.2026" — the oldest run's date, which is the number this screen exists to move. */
function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export function GarminHistoryImport() {
  const t = useTranslations('settings');
  const { data, isLoading } = useApi<{ users?: AthleteRow[] }>('/api/admin/users');
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [busy, setBusy] = useState(false);
  // A ref, not state: the loop below reads it between requests and a state read
  // inside a running async function sees the value it closed over, not the
  // current one — which is exactly the bug that makes a Stop button do nothing.
  const stopRef = useRef(false);
  // The same map as `progress`, readable synchronously — see `set` in runAthlete.
  const progressRef = useRef<Record<string, Progress>>({});

  // Only athletes with a watch connected can have Garmin history. `hasWatch` is
  // true for Strava-only athletes too; those come back with no result row and
  // are labelled as such rather than silently doing nothing.
  const athletes = (data?.users || []).filter((u) => u.hasWatch);

  /**
   * One request for one athlete, one span of pages.
   *
   * The error it throws carries the STATUS and whatever the body said, because
   * the first failure of this screen reported nothing but a bare number — and a
   * bare number cannot distinguish "the platform killed the request" from
   * "Garmin refused the credential", which are opposite problems.
   */
  const patch = async (athleteId: string, fromPage: number): Promise<HistoryResponse> => {
    const headers = await apiHeaders();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(
        `/api/garmin/sync-activities?mode=history&athleteId=${encodeURIComponent(athleteId)}` +
          `&pages=${PAGES_PER_REQUEST}&fromPage=${fromPage}`,
        { method: 'PATCH', headers, signal: abort.signal },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 140)}` : ''}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * `patch` with retries. Re-reading a page is idempotent — same rows, thrown away
   * by the unique index — so the only cost of a retry is one Garmin request, and
   * the alternative is a walk that abandons an athlete's whole remaining history
   * over one bad response.
   */
  const patchWithRetry = async (athleteId: string, fromPage: number): Promise<HistoryResponse> => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= ATTEMPTS_PER_PAGE; attempt++) {
      if (stopRef.current) throw lastError ?? new Error('stopped');
      try {
        return await patch(athleteId, fromPage);
      } catch (e) {
        lastError = e as Error;
        // Back off a little — a cold start or a rate limit both want a pause, and
        // hammering the same page immediately is how one failure becomes three.
        if (attempt < ATTEMPTS_PER_PAGE) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw lastError ?? new Error('failed');
  };

  /**
   * Walk one athlete's history to the end (or until Stop), updating as it goes.
   *
   * Resumes from wherever a previous attempt stopped, and carries that attempt's
   * import count forward, so a failed walk that is retried reads as one walk with
   * an interruption in it rather than two conflicting stories.
   */
  const runAthlete = async (athleteId: string) => {
    const prior = progressRef.current[athleteId];
    let page = prior?.nextPage ?? 1;
    let imported = prior?.imported ?? 0;
    let pages = prior?.pages ?? 0;
    let oldest: string | null = prior?.oldest ?? null;
    const set = (p: Partial<Progress>) => {
      const next: Progress = {
        imported,
        pages,
        oldest,
        running: true,
        done: false,
        nextPage: page,
        ...p,
      };
      // Mirrored into a ref as well as state: a walk started while another one
      // just finished reads this synchronously, and React's state is a render
      // behind.
      progressRef.current = { ...progressRef.current, [athleteId]: next };
      setProgress((prev) => ({ ...prev, [athleteId]: next }));
    };

    set({});
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let json: HistoryResponse;
      try {
        json = await patchWithRetry(athleteId, page);
      } catch (e) {
        set({ running: false, error: (e as Error).message });
        return;
      }
      const result = json.athletes?.[0];
      if (!result) {
        // No row for an athlete we asked for by id means the route's own filter
        // (`garmin_auth is not null`) excluded them.
        set({ running: false, done: true, noGarmin: true });
        return;
      }
      imported += result.imported;
      pages += result.pagesFetched;
      oldest = result.oldestStored;
      if (result.error) {
        set({ running: false, error: result.error });
        return;
      }
      if (result.nextPage == null) {
        set({ running: false, done: true });
        return;
      }
      page = result.nextPage;
      set({});
      if (stopRef.current) {
        set({ running: false });
        return;
      }
    }
    set({ running: false });
  };

  const runOne = async (athleteId: string) => {
    setBusy(true);
    stopRef.current = false;
    try {
      await runAthlete(athleteId);
    } finally {
      setBusy(false);
    }
  };

  const runAll = async () => {
    setBusy(true);
    stopRef.current = false;
    try {
      // Sequentially, on purpose: these all share one Garmin credential pool and
      // running ten walks at once is the fastest way to get the club rate-limited.
      for (const a of athletes) {
        if (stopRef.current) break;
        // Already walked to the end in this sitting — pressing the button again
        // after a failure part-way through the club should pick up the rest, not
        // re-read what already finished.
        if (progressRef.current[a.id]?.done) continue;
        await runAthlete(a.id);
      }
    } finally {
      setBusy(false);
    }
  };

  const totalImported = Object.values(progress).reduce((sum, p) => sum + p.imported, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card p-4">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-brand-600/15 flex items-center justify-center shrink-0">
            <History className="w-4 h-4 text-brand-600" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-700" dir="auto">{t('garminHistoryTitle')}</p>
            <p className="text-xs text-ink-400 mt-0.5" dir="auto">{t('garminHistoryIntro')}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={runAll}
            disabled={busy || athletes.length === 0}
            className={cn(
              'flex items-center gap-2 px-4 min-h-[44px] rounded-xl text-sm font-semibold transition-colors',
              busy || athletes.length === 0
                ? 'bg-page text-ink-400'
                : 'bg-brand-600 text-white hover:bg-brand-700',
            )}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('garminHistoryRunAll', { count: athletes.length })}
          </button>
          {busy && (
            <button
              onClick={() => { stopRef.current = true; }}
              className="px-4 min-h-[44px] rounded-xl border border-accent-red/30 text-accent-red text-sm font-semibold"
            >
              {t('garminHistoryStop')}
            </button>
          )}
        </div>

        {totalImported > 0 && (
          <p className="mt-3 text-xs font-semibold text-accent-600" dir="auto">
            {t('garminHistoryTotal', { count: totalImported })}
          </p>
        )}
      </div>

      {isLoading && !data ? (
        <SkeletonList count={4} />
      ) : (
        <InsetSection header={t('garminHistoryAthletes')}>
          {athletes.length === 0 ? (
            <InsetRow icon={Watch} iconBg="bg-ink-300" label={t('garminHistoryNobody')} />
          ) : (
            athletes.map((a) => {
              const p = progress[a.id];
              return (
                <InsetRow
                  key={a.id}
                  icon={p?.error ? AlertTriangle : p?.done ? CheckCircle2 : Watch}
                  iconBg={p?.error ? 'bg-accent-red' : p?.done ? 'bg-accent-600' : 'bg-ink-400'}
                  label={a.name || a.id}
                  sublabel={
                    p?.error
                      ? p.error
                      : p?.noGarmin
                        ? t('garminHistoryNoGarmin')
                        : p
                          // Page count deliberately not shown: the sublabel is a
                          // single truncating line, and with pages in it the date
                          // — the one number that says whether this worked — was
                          // the part that got cut off.
                          ? t('garminHistoryProgress', {
                              imported: p.imported,
                              date: shortDate(p.oldest),
                            })
                          : undefined
                  }
                  trailing={
                    <button
                      onClick={() => runOne(a.id)}
                      disabled={busy}
                      className={cn(
                        'shrink-0 px-3 min-h-[38px] rounded-lg text-xs font-semibold transition-colors',
                        busy ? 'bg-page text-ink-400' : 'bg-page text-brand-600 hover:bg-brand-600/10',
                      )}
                    >
                      {p?.running ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : p && !p.done ? (
                        // An interrupted walk resumes from its own cursor, so the
                        // button has to say so — "Import" on a half-finished row
                        // reads like starting over.
                        t('garminHistoryResume')
                      ) : (
                        t('garminHistoryRunOne')
                      )}
                    </button>
                  }
                />
              );
            })
          )}
        </InsetSection>
      )}
    </div>
  );
}
