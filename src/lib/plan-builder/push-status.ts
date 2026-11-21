import { PUSH_BACKOFF_BASE_SEC, PUSH_BACKOFF_MAX_SEC } from './constants';

export type PushState = 'pending' | 'sent' | 'failed' | 'reconnect' | 'backoff' | 'skipped';

/** Map a pushWeekToAthlete error string to a status the coach can act on. */
export function classifyPushError(err: string | null | undefined): { state: PushState; code: string } {
  const e = (err || '').toLowerCase();
  if (/not connected|no garmin|garmin_auth/.test(e)) return { state: 'reconnect', code: 'not_connected' };
  if (/401|403|expired|unauthori|invalid token|oauth|login/.test(e)) return { state: 'reconnect', code: 'auth_expired' };
  if (/429|too many|rate/.test(e)) return { state: 'backoff', code: 'rate_limited' };
  return { state: 'failed', code: 'unknown' };
}

export function nextRetryAt(attempts: number, now = Date.now()): string {
  const sec = Math.min(PUSH_BACKOFF_MAX_SEC, PUSH_BACKOFF_BASE_SEC * 2 ** Math.max(0, attempts - 1));
  return new Date(now + sec * 1000).toISOString();
}
