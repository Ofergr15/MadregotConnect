/**
 * One retry/backoff policy for every outbound call (task 166). Sits on top of
 * lib/http/timeout.ts (#209), which gives each call a budget and a typed timeout error.
 *
 * The rule that decides everything: **a call that may already have taken effect is
 * only retried if repeating it is harmless.**
 *
 *  - `idempotent: true` (GETs; a send carrying an idempotency key): retried on network
 *    errors, timeouts, 429 and 5xx.
 *  - `idempotent: false` (a push, an email without a key, a token refresh): retried only
 *    when the other side certainly did NOT act — it refused the connection, or answered
 *    429 / 503 ("not now"). A timeout or a reset mid-request is NOT retried: the push may
 *    already be on the phone.
 *
 * Backoff is exponential with full jitter, capped, and honours `Retry-After`. The
 * attempt counts are small on purpose: these run inside serverless functions with a
 * maxDuration, inside crons that loop over the whole club.
 *
 * Garmin is deliberately 1 attempt (no retry): Garmin SSO locks accounts that log in too
 * often, and a refused credential already has its own back-off (#230). Anthropic's SDK
 * retries by itself; its policy here only sets the SDK's `maxRetries`, so the number lives
 * in one place.
 */
import { OutboundTimeoutError, type OutboundService } from '@/lib/http/timeout';

export interface RetryPolicy {
  /** Total tries, including the first. 1 = never retry. */
  attempts: number;
  baseMs: number;
  maxMs: number;
}

export const RETRY_POLICY: Record<OutboundService, RetryPolicy> = {
  garmin: { attempts: 1, baseMs: 0, maxMs: 0 },
  strava: { attempts: 3, baseMs: 400, maxMs: 4_000 },
  anthropic: { attempts: 3, baseMs: 0, maxMs: 0 }, // → Anthropic SDK maxRetries: 2
  resend: { attempts: 3, baseMs: 300, maxMs: 3_000 },
  webpush: { attempts: 2, baseMs: 300, maxMs: 2_000 },
  apns: { attempts: 2, baseMs: 300, maxMs: 2_000 },
};

/** For SDKs with their own retry loop (Anthropic): retries after the first try. */
export function sdkMaxRetries(service: OutboundService): number {
  return Math.max(0, RETRY_POLICY[service].attempts - 1);
}

/** Error codes meaning the request never reached the server. */
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
/** Error codes meaning the connection broke — the request may or may not have arrived. */
const MAYBE_SENT_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

function errCode(e: unknown): string | undefined {
  const x = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = x?.code ?? x?.cause?.code;
  return typeof c === 'string' ? c : undefined;
}

export type Outcome =
  | { kind: 'ok' }
  | { kind: 'status'; status: number; retryAfterMs?: number | null }
  | { kind: 'error'; error: unknown };

/** Should this outcome be tried again? Pure; the policy table above in one function. */
export function isRetryable(o: Outcome, idempotent: boolean): boolean {
  if (o.kind === 'ok') return false;
  if (o.kind === 'status') {
    if (o.status === 429 || o.status === 503) return true;
    return idempotent && (o.status === 500 || o.status === 502 || o.status === 504);
  }
  const code = errCode(o.error);
  if (code && NOT_SENT_CODES.has(code)) return true;
  if (!idempotent) return false;
  if (o.error instanceof OutboundTimeoutError) return true;
  if (code && MAYBE_SENT_CODES.has(code)) return true;
  // undici's network failure: `TypeError: fetch failed` with the real code on `cause`.
  return o.error instanceof TypeError && /fetch failed/i.test(o.error.message);
}

/** `Retry-After` as ms: delta-seconds or an HTTP date. null when absent/unparseable. */
export function parseRetryAfter(v: string | null | undefined, nowMs = Date.now()): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : null;
}

/** Full-jitter exponential delay before retry number `retry` (1-based), within [0, maxMs]. */
export function backoffMs(policy: RetryPolicy, retry: number, random = Math.random, retryAfterMs?: number | null): number {
  if (retryAfterMs != null) return Math.min(policy.maxMs, Math.max(0, retryAfterMs));
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** (retry - 1));
  return Math.floor(random() * ceiling);
}

export interface RetryOptions {
  idempotent: boolean;
  /** Turns a resolved value into an outcome (e.g. a Response with a 503). Default: always ok. */
  classify?: (value: unknown) => Outcome;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Overrides the service policy (tests, a caller with a tighter budget). */
  policy?: RetryPolicy;
  onRetry?: (info: { service: OutboundService; retry: number; delayMs: number; outcome: Outcome }) => void;
  /** Statuses never worth repeating for this caller (Strava's 429 is a 15-minute window). */
  noRetryStatuses?: readonly number[];
}

/** An SDK error that carries the HTTP answer (web-push's WebPushError: statusCode + headers). */
function statusOfError(e: unknown): Outcome | null {
  const x = e as { statusCode?: unknown; headers?: Record<string, string | undefined> } | null;
  if (typeof x?.statusCode !== 'number') return null;
  return { kind: 'status', status: x.statusCode, retryAfterMs: parseRetryAfter(x.headers?.['retry-after']) };
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs `work` up to the service's attempt count. A resolved value that classifies as
 * retryable is retried; when tries run out the LAST value is returned (a 503 Response stays
 * a Response) and the last error is re-thrown — callers keep their own error handling.
 */
export async function withRetry<T>(service: OutboundService, work: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const policy = opts.policy ?? RETRY_POLICY[service];
  const sleep = opts.sleep ?? realSleep;
  const classify = opts.classify ?? (() => ({ kind: 'ok' }) as Outcome);
  for (let attempt = 1; ; attempt++) {
    let outcome: Outcome;
    let value: T | undefined;
    let thrown: { error: unknown } | null = null;
    try {
      value = await work(attempt);
      outcome = classify(value);
    } catch (error) {
      thrown = { error };
      outcome = statusOfError(error) ?? { kind: 'error', error };
    }
    const blocked = outcome.kind === 'status' && !!opts.noRetryStatuses?.includes(outcome.status);
    if (attempt >= policy.attempts || blocked || !isRetryable(outcome, opts.idempotent)) {
      if (thrown) throw thrown.error;
      return value as T;
    }
    const delayMs = backoffMs(policy, attempt, opts.random, outcome.kind === 'status' ? outcome.retryAfterMs : null);
    opts.onRetry?.({ service, retry: attempt, delayMs, outcome });
    if (delayMs > 0) await sleep(delayMs);
  }
}

/** Classifies a fetch Response by status, reading Retry-After. */
export function classifyResponse(r: unknown): Outcome {
  const res = r as Response;
  if (res.ok) return { kind: 'ok' };
  return { kind: 'status', status: res.status, retryAfterMs: parseRetryAfter(res.headers.get('retry-after')) };
}

/** Logs one line per retry; the default `onRetry` for production call sites. */
export function logRetry(info: { service: OutboundService; retry: number; delayMs: number; outcome: Outcome }): void {
  const what = info.outcome.kind === 'status' ? `status ${info.outcome.status}` : info.outcome.kind === 'error' ? (errCode(info.outcome.error) ?? (info.outcome.error as Error)?.name ?? 'error') : 'ok';
  console.warn(`[retry] ${info.service} retry ${info.retry} in ${info.delayMs} ms after ${what}`);
}
