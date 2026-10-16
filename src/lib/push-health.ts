// ── "Notifications aren't reaching this person" ─────────────────────────────────
//
// Apple accepts a push to an endpoint that no longer reaches anything (201, forever),
// so on the server's side a dead phone looks exactly like a working one. The only
// signal is the receipt the service worker posts when it actually shows a
// notification (push_subscriptions.last_success_at, /api/push/receipt).
//
// lib/push-ghosts.ts removes a dead endpoint when a SIBLING proves it dead. A member
// with ONE device has no sibling: feedback #108 — an iOS 18.6 phone whose last
// receipt was 2026-09-29, every push since recorded as sent (five kudos one morning),
// nothing shown, and nobody told. This is the test for that member, so the app can
// say so to them (a banner with a one-tap re-register) and to staff (the people list).

export const PUSH_DEAD_DAYS = 7;

export interface DeviceReceipt {
  created_at: string;
  last_success_at: string | null;
}

/**
 * Dead = they have devices, none has shown anything in PUSH_DEAD_DAYS, and something
 * WAS sent to them in that time. Without the last condition a quiet week would read
 * as a broken phone; without devices it is "never enabled", a different screen's job.
 */
export function pushLooksDead(devices: DeviceReceipt[], sentInWindow: number, now: number = Date.now()): boolean {
  if (devices.length === 0 || sentInWindow === 0) return false;
  const since = now - PUSH_DEAD_DAYS * 86_400_000;
  // A device registered inside the window hasn't had a week to prove anything.
  if (devices.some((d) => Date.parse(d.created_at) >= since)) return false;
  return devices.every((d) => !d.last_success_at || Date.parse(d.last_success_at) < since);
}

/** The newest receipt across a member's devices, for "last arrived on …". */
export function lastReceipt(devices: DeviceReceipt[]): string | null {
  return devices.reduce<string | null>((best, d) => (d.last_success_at && (!best || d.last_success_at > best) ? d.last_success_at : best), null);
}
