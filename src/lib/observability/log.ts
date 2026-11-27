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
 *  - an Error is reduced to `name` + `message` (scrubbed, capped) — never its
 *    stack or `config`, since an axios error carries the request body (see the
 *    Garmin note in CLAUDE.md: that body held the password).
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

/** The only shape of an error that may be logged. */
export function errorFields(err: unknown): { errorName: string; message: string; code?: string } {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return { errorName: err.name, message: scrubString(err.message || ''), ...(typeof code === 'string' ? { code } : {}) };
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
