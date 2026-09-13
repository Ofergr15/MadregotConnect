import { type SetupState, type SetupTaskKey } from '@/lib/onboarding/setup-tasks';

// ═════════════════════════════════════════════════════════════════════════════
// THE 15-MINUTE SNAPSHOT
//
// A quarter of an hour after the app first opens for somebody, tell them what is
// set up and what isn't — each item marked, one by one. It exists because the
// club cannot otherwise SAMPLE whether a new member finished the process: the
// entry queue shows who is stuck, but only if an admin happens to look, and the
// entry nudge is a manual button somebody has to press days later.
//
// Fifteen minutes is chosen, not arbitrary. It is long enough that the first-run
// sheets (home screen → notifications → checklist) have played out and short
// enough that they are still holding the phone, which is the only moment "you
// have three things left" is a small favour rather than a chore.
//
// Three rules this module exists to keep:
//
//   1. NOTHING IS SENT TO SOMEBODY WHO FINISHED. `allDone` means silence. A
//      congratulation nobody asked for is the same interruption as a nag.
//   2. ONE CHANNEL, NEVER TWO. Push for whoever has a subscription, email for
//      whoever doesn't — the same rule as the entry nudge. Both channels for one
//      prod is how a reminder starts reading as spam.
//   3. ONCE. Ever. The caller is responsible for the ledger; this module gives
//      it a stable key to write.
//
// Pure: no network, no clock of its own (`nowMs` is passed in), so the whole
// decision is testable — src/__tests__/setupSnapshot.test.ts.
// ═════════════════════════════════════════════════════════════════════════════

/** How long after the app first opened the snapshot is due. */
export const SNAPSHOT_DELAY_MINUTES = 15;

/**
 * How late is still acceptable.
 *
 * The tick runs every 5 minutes, so a 15-minute point needs a window, not an
 * instant. 25 minutes gives it two chances: a single skipped or slow tick
 * (`cron_tick_locks` drops duplicates, a cold start can eat a minute) can't lose
 * the send. Past that it is dropped rather than sent late — a "you just got in"
 * message that lands an hour later is describing somebody else's session.
 */
export const SNAPSHOT_LATEST_MINUTES = 25;

/** The ledger key, so the cron and any test agree on what "already sent" means. */
export function snapshotLedgerTag(athleteId: string): string {
  return `setupSnapshot:${athleteId}`;
}

export interface SnapshotTiming {
  /** `athletes.first_seen_at` — when the app first opened for them. */
  firstSeenAt: string | null;
}

/** Is this athlete inside the 15–25 minute window right now? */
export function snapshotDue(timing: SnapshotTiming, nowMs: number): boolean {
  if (!timing.firstSeenAt) return false;
  const first = Date.parse(timing.firstSeenAt);
  if (!Number.isFinite(first)) return false;
  const age = (nowMs - first) / 60_000;
  return age >= SNAPSHOT_DELAY_MINUTES && age <= SNAPSHOT_LATEST_MINUTES;
}

export type SnapshotChannel = 'push' | 'email' | 'none';

/**
 * Which single channel carries it.
 *
 * `email` must already be a REAL address — `realEmail()` at the call site, never
 * a `strava_<id>@strava.madregot.local` synthetic, which nothing delivers to.
 */
export function snapshotChannel(reach: { hasPush: boolean; email: string | null }): SnapshotChannel {
  if (reach.hasPush) return 'push';
  if (reach.email) return 'email';
  return 'none';
}

/** Is there anything worth saying? Finished means silence. */
export function snapshotWorthSending(setup: SetupState): boolean {
  return !setup.allDone;
}

export interface SnapshotRow {
  key: SetupTaskKey;
  done: boolean;
  /** The declared data source, for the one row where "chose Garmin, not synced" is the point. */
  source?: string;
}

/**
 * The checklist as the message shows it: what's done first, what's missing after.
 *
 * Done-first on purpose. The mail is meant to read as "here is where you are",
 * and opening with three red crosses reads as a telling-off — which is a good way
 * to get a new member to stop opening our mail.
 */
export function snapshotRows(setup: SetupState): SnapshotRow[] {
  const row = (t: SetupState['tasks'][number]): SnapshotRow => ({
    key: t.key,
    done: t.done,
    ...(t.meta?.source ? { source: t.meta.source } : {}),
  });
  return [
    ...setup.tasks.filter((t) => t.done).map(row),
    ...setup.tasks.filter((t) => !t.done).map(row),
  ];
}
