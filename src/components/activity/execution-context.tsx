'use client';

/**
 * Getting accuracy rings onto a list of cards without a request per card.
 *
 * A card doesn't know what else is on screen, and the feed and the activities
 * screen both paginate, so neither parent can hand down a ready list of ids. So
 * cards ASK — `useExecutionSummary(id, mayISeeIt)` — and this provider collects
 * the asks for one frame and turns them into a single batched GET. Scrolling a
 * second page in adds one more request, not twenty.
 *
 * `enabled` is the ownership rule, and it is the caller's to state: a runner sees
 * a ring on their own runs, staff see everyone's. Passing false means the id is
 * never even requested — and /api/plan-execution enforces the same rule again, so
 * a card that got the flag wrong leaks nothing.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiHeaders } from '@/lib/api';
import { toExecutionSummary } from '@/lib/plan-execution/verdict';
import type { ExecutionSummary, ExecutionVerdict } from '@/lib/plan-execution/verdict';

/** `null` = asked, and the server has no score for this run (or wouldn't say). */
type Entry = ExecutionSummary | null;

interface ExecutionContextValue {
  summaries: Map<string, Entry>;
  request: (activityId: string) => void;
  /** Overwrite one cached entry with a freshly computed, better answer. */
  publish: (summary: ExecutionSummary) => void;
}

const ExecutionContext = createContext<ExecutionContextValue | null>(null);

/** One frame's worth of card mounts, coalesced. */
const BATCH_DELAY_MS = 60;
/** Matches MAX_BATCH in the route — a longer list is split across calls. */
const MAX_IDS_PER_CALL = 60;

export function ExecutionScoreProvider({ children }: { children: React.ReactNode }) {
  const [summaries, setSummaries] = useState<Map<string, Entry>>(() => new Map());
  const pending = useRef<Set<string>>(new Set());
  const asked = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const ids = [...pending.current].slice(0, MAX_IDS_PER_CALL);
    if (!ids.length) return;
    for (const id of ids) pending.current.delete(id);

    try {
      const res = await fetch(`/api/plan-execution?ids=${ids.join(',')}`, {
        headers: await apiHeaders(),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { summaries?: ExecutionSummary[] };
      setSummaries((prev) => {
        const next = new Map(prev);
        // Everything asked for is resolved, including the ids that came back
        // absent — otherwise a teammate's card would sit on a loading skeleton
        // for the whole session waiting for an answer that will never come.
        for (const id of ids) next.set(id, null);
        for (const summary of data.summaries || []) next.set(summary.activityId, summary);
        return next;
      });
    } catch {
      // A network failure shouldn't burn the id: forget it was asked so the next
      // card mount (or the next page load) tries again.
      for (const id of ids) asked.current.delete(id);
    }

    // More than one call's worth arrived at once (a long list, or fast scrolling).
    if (pending.current.size > 0) void flush();
  }, []);

  const request = useCallback((activityId: string) => {
    if (!activityId || asked.current.has(activityId)) return;
    asked.current.add(activityId);
    pending.current.add(activityId);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, BATCH_DELAY_MS);
  }, [flush]);

  /**
   * The batch path grades from stored laps only; opening a run fetches the laps
   * it was missing and can come back with a materially different answer (the
   * whole reason the ring is per-rep). Without this the feed would keep showing
   * the older number after you'd been shown the better one on the same run.
   */
  const publish = useCallback((summary: ExecutionSummary) => {
    asked.current.add(summary.activityId);
    setSummaries((prev) => {
      const current = prev.get(summary.activityId);
      if (current
        && current.score === summary.score
        && current.direction === summary.direction
        && current.status === summary.status) {
        return prev;
      }
      const next = new Map(prev);
      next.set(summary.activityId, summary);
      return next;
    });
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ summaries, request, publish }), [summaries, request, publish]);
  return <ExecutionContext.Provider value={value}>{children}</ExecutionContext.Provider>;
}

/**
 * The score for one run: `undefined` while it's still being fetched (or when the
 * caller may not see it), `null` when there is none, otherwise the summary.
 */
export function useExecutionSummary(
  activityId: string | null | undefined,
  enabled: boolean,
): ExecutionSummary | null | undefined {
  const ctx = useContext(ExecutionContext);

  useEffect(() => {
    if (!enabled || !activityId || !ctx) return;
    ctx.request(activityId);
  }, [ctx, activityId, enabled]);

  if (!enabled || !activityId || !ctx) return undefined;
  return ctx.summaries.get(activityId);
}

/**
 * The full verdict for one run — the detail screen's own fetch, not batched.
 *
 * `revision` exists for one specific reason: per-rep verdicts need the watch's
 * laps, which are cached the first time anyone opens the run. So the detail screen
 * bumps this once its own details fetch has landed, and the section fills in its
 * rep-by-rep view on the same visit instead of the next one.
 */
export function useExecutionVerdict(
  activityId: string | null | undefined,
  { enabled, revision = 0 }: { enabled: boolean; revision?: number },
): { verdict: ExecutionVerdict | null; loading: boolean; error: string | null } {
  const [verdict, setVerdict] = useState<ExecutionVerdict | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optional: the feedback screen renders this outside the app shell's provider.
  const ctx = useContext(ExecutionContext);
  const publish = ctx?.publish;

  useEffect(() => {
    if (!enabled || !activityId) {
      setVerdict(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/plan-execution?activityId=${activityId}`, {
          headers: await apiHeaders(),
        });
        if (!res.ok) throw new Error(res.status === 403 ? 'forbidden' : 'failed');
        const data = (await res.json()) as { verdict?: ExecutionVerdict };
        if (cancelled) return;
        setVerdict(data.verdict ?? null);
        setError(null);
        // Hand the better answer back to the feed's cache.
        if (data.verdict && publish) publish(toExecutionSummary(data.verdict));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activityId, enabled, revision, publish]);

  return { verdict, loading, error };
}
