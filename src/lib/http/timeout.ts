/**
 * One timeout policy for every outbound call (Garmin, Strava, Anthropic, Resend, web push, APNs).
 *
 * A hung upstream used to hold a serverless function until Vercel killed it, and the cron run
 * that called it lost every athlete after the hung one. Each service gets a budget here, and a
 * call that runs past it fails with `OutboundTimeoutError` — a typed error the caller can tell
 * apart from a real HTTP failure (`code === 'outbound_timeout'`, `service`, `timeoutMs`).
 */
export type OutboundService = 'garmin' | 'strava' | 'anthropic' | 'resend' | 'webpush' | 'apns';

/** Milliseconds. Anthropic is long on purpose: a plan parse legitimately runs for minutes. */
export const OUTBOUND_TIMEOUT_MS: Record<OutboundService, number> = {
  garmin: 20_000,
  strava: 15_000,
  anthropic: 240_000,
  resend: 10_000,
  webpush: 10_000,
  apns: 10_000,
};

export class OutboundTimeoutError extends Error {
  readonly code = 'outbound_timeout';
  constructor(readonly service: OutboundService, readonly timeoutMs: number) {
    super(`${service} did not answer within ${timeoutMs} ms`);
    this.name = 'OutboundTimeoutError';
  }
}

export function isOutboundTimeoutError(e: unknown): e is OutboundTimeoutError {
  return e instanceof OutboundTimeoutError;
}

/** True for the shapes a timeout takes in fetch (AbortSignal.timeout), axios and the Anthropic SDK. */
export function looksLikeTimeout(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: unknown; code?: unknown; message?: unknown };
  if (err.name === 'TimeoutError' || err.name === 'APIConnectionTimeoutError') return true;
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'outbound_timeout') return true;
  return typeof err.message === 'string' && /timeout|timed out/i.test(err.message);
}

/** Re-throws a timeout-shaped error as `OutboundTimeoutError`; anything else unchanged. */
export function asOutboundError(e: unknown, service: OutboundService, timeoutMs = OUTBOUND_TIMEOUT_MS[service]): unknown {
  if (e instanceof OutboundTimeoutError) return e;
  return looksLikeTimeout(e) ? new OutboundTimeoutError(service, timeoutMs) : e;
}

/** `fetch` with the service's budget. Merges with a caller's own signal if one is passed. */
export async function fetchWithTimeout(
  service: OutboundService,
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = OUTBOUND_TIMEOUT_MS[service],
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetch(input, { ...init, signal });
  } catch (e) {
    if (timeout.aborted) throw new OutboundTimeoutError(service, timeoutMs);
    throw e;
  }
}

/**
 * Races a promise against the budget, for SDKs that take no signal (Resend, web-push).
 * The underlying request is not cancelled — the caller just stops waiting for it.
 */
export function withTimeout<T>(
  service: OutboundService,
  work: Promise<T>,
  timeoutMs = OUTBOUND_TIMEOUT_MS[service],
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OutboundTimeoutError(service, timeoutMs)), timeoutMs);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
