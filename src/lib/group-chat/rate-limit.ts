// Per-member send rate limit for group chat (task 53).
//
// Two windows: a burst (BURST_MAX in BURST_MS — a loop or a stuck outbox) and a
// sustained cap (HOUR_MAX in an hour — someone flooding a 25-person room, each
// message a push to everyone else). The decision is pure; the store is in-process,
// so on serverless it is best-effort per warm instance — enough to stop a runaway
// client (which hits the same instance in a burst), not a determined abuser
// spreading requests across cold starts. A DB-backed counter is the upgrade path.

export const BURST_MAX = 8;
export const BURST_MS = 60_000;
export const HOUR_MAX = 120;
export const HOUR_MS = 3_600_000;

export type RateDecision = { ok: true } | { ok: false; retryAfterSec: number };

/** Given this member's previous send times (ms), may they send at `now`? */
export function decideRate(sentAt: readonly number[], now: number): RateDecision {
  const inBurst = sentAt.filter((t) => now - t < BURST_MS).sort((a, b) => a - b);
  if (inBurst.length >= BURST_MAX) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((inBurst[inBurst.length - BURST_MAX] + BURST_MS - now) / 1000)) };
  }
  const inHour = sentAt.filter((t) => now - t < HOUR_MS).sort((a, b) => a - b);
  if (inHour.length >= HOUR_MAX) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((inHour[inHour.length - HOUR_MAX] + HOUR_MS - now) / 1000)) };
  }
  return { ok: true };
}

const store = new Map<string, number[]>();

/** Check and, when allowed, record one send for `athleteId`. */
export function takeSendSlot(athleteId: string, now = Date.now()): RateDecision {
  const prev = (store.get(athleteId) ?? []).filter((t) => now - t < HOUR_MS);
  const d = decideRate(prev, now);
  if (d.ok) prev.push(now);
  store.set(athleteId, prev);
  // Bound memory on a long-lived instance: drop members with nothing in the window.
  if (store.size > 5000) for (const [k, v] of store) if (!v.some((t) => now - t < HOUR_MS)) store.delete(k);
  return d;
}

/** Test hook. */
export function resetRateStore(): void {
  store.clear();
}
