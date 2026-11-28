/**
 * Structured logging without PII (task 64).
 *
 * One JSON line per event: `{ level, event, requestId?, ...fields }`. Vercel's log
 * search indexes JSON, so `event:"cron.summary"` or a request id finds every line.
 *
 * NO PII, enforced here rather than by convention:
 *  - keys that name a person or a credential are replaced with "[redacted]"
 *    (email, name, phone, token, password, auth, cookie, address, lat/lng, …);
 *  - any string value that looks like an email address is masked, wherever it sits;
 *  - an Error is reduced to `name` + `message` (scrubbed, capped), plus the first
 *    STACK_FRAMES frames of its stack (each scrubbed the same way) — never its
 *    `config`, since an axios error carries the request body (see the Garmin note
 *    in CLAUDE.md: that body held the password). Network errors (axios / fetch /
 *    socket) get NO stack at all: their stack text can embed the URL and headers.
 * Ids (athlete uuid, activity id) are fine: they are what makes a line actionable.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PII_KEY = /(^|_)(e?mail|name|first_?name|last_?name|full_?name|phone|token|password|passwd|secret|auth|authorization|cookie|address|lat|lng|lon|latitude|longitude|ip|body|garmin_auth|strava_auth)$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAX_STRING = 300;
const MAX_DEPTH = 4;

export function scrubString(s: string): string {
  const masked = s.replace(EMAIL, '[email]');
  return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
}

const STACK_FRAMES = 8;
const NETWORK_CODE = /^(E(CONN(RESET|REFUSED|ABORTED)|TIMEDOUT|NOTFOUND|AI_AGAIN|PIPE|HOSTUNREACH|NETUNREACH)|ERR_(NETWORK|BAD_REQUEST|BAD_RESPONSE|CANCELED)|UND_ERR_\w+)$/;
/** Credentials inside a URL (`https://user:pass@host`) are masked in any stack frame. */
const URL_CREDENTIALS = /(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g;

/**
 * An HTTP / network failure: axios errors (isAxiosError, or a config/request/
 * response attached), fetch's `TypeError: fetch failed`, aborts and socket codes.
 * Their stack may carry the URL and headers, so they never log one.
 */
export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { isAxiosError?: unknown; config?: unknown; request?: unknown; response?: unknown; name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  if (e.isAxiosError === true || e.config !== undefined || e.request !== undefined || e.response !== undefined) return true;
  if (e.name === 'AxiosError' || e.name === 'FetchError' || e.name === 'AbortError') return true;
  if (e.name === 'TypeError' && typeof e.message === 'string' && /fetch failed|network/i.test(e.message)) return true;
  if (typeof e.code === 'string' && NETWORK_CODE.test(e.code)) return true;
  return e.cause !== undefined && e.cause !== err && isNetworkError(e.cause);
}

/** The first STACK_FRAMES "at …" lines, scrubbed; undefined when there are none. */
function stackFrames(stack: unknown): string[] | undefined {
  if (typeof stack !== 'string') return undefined;
  const frames = stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at '))
    .slice(0, STACK_FRAMES)
    .map((l) => scrubString(l.replace(URL_CREDENTIALS, '$1[credentials]@')));
  return frames.length ? frames : undefined;
}

/** The only shape of an error that may be logged. */
export function errorFields(err: unknown): { errorName: string; message: string; code?: string; stack?: string[] } {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    const stack = isNetworkError(err) ? undefined : stackFrames(err.stack);
    return {
      errorName: err.name,
      message: scrubString(err.message || ''),
      ...(typeof code === 'string' ? { code } : {}),
      ...(stack ? { stack } : {}),
    };
  }
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; code?: unknown };
    return {
      errorName: 'Error',
      message: scrubString(typeof o.message === 'string' ? o.message : '[object]'),
      ...(typeof o.code === 'string' ? { code: o.code } : {}),
    };
  }
  return { errorName: 'Error', message: scrubString(String(err)) };
}

export function scrub(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return scrubString(value);
  if (value instanceof Error) return errorFields(value);
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEY.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function formatLog(level: LogLevel, event: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ level, event, ...(scrub(fields) as Record<string, unknown>) });
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = formatLog(level, event, fields);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** A logger with the request id baked in. */
export function logger(requestId: string | null | undefined) {
  const base = requestId ? { requestId } : {};
  return {
    info: (event: string, f: Record<string, unknown> = {}) => log('info', event, { ...base, ...f }),
    warn: (event: string, f: Record<string, unknown> = {}) => log('warn', event, { ...base, ...f }),
    error: (event: string, f: Record<string, unknown> = {}) => log('error', event, { ...base, ...f }),
  };
}
