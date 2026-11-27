/**
 * Best-effort failures, made visible (task 65).
 *
 * The server code has many deliberate `catch { /* best-effort *\/ }` blocks: a
 * delivery log, a telemetry row or a notification must never fail the request or
 * cron step that triggered it. That policy is right. Dropping the error on the
 * floor was not — a push-prefs read that failed every time looked exactly like one
 * that never ran. These helpers keep the control flow identical (nothing is
 * rethrown, the fallback value is the same) and write ONE warn line instead:
 *
 *   [swallowed] push.prefsByAthlete: PostgrestError 42P01 relation "x" does not exist
 *
 * Name, code and message only — never the error object, whose `config` (axios) or
 * `details` can carry a request body or an email. Emails in the message are masked.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function describeSwallowed(err: unknown): string {
  if (err == null) return 'unknown';
  const o = (typeof err === 'object' ? err : { message: String(err) }) as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof o.name === 'string' && o.name ? o.name : 'Error';
  const code = typeof o.code === 'string' || typeof o.code === 'number' ? ` ${o.code}` : '';
  const msg = typeof o.message === 'string' ? o.message : '';
  return `${name}${code} ${msg}`.replace(EMAIL, '[email]').trim().slice(0, 300);
}

/** Log a best-effort failure. Never throws. */
export function noteSwallowed(where: string, err: unknown): void {
  try {
    console.warn(`[swallowed] ${where}: ${describeSwallowed(err)}`);
  } catch { /* logging itself must never throw */ }
}

/** For `.catch(swallow('where'))` — resolves to undefined, like `.catch(() => {})`. */
export function swallow(where: string): (err: unknown) => undefined {
  return (err) => { noteSwallowed(where, err); return undefined; };
}

/** For `.catch(swallowAs('where', null))` — resolves to the given fallback. */
export function swallowAs<T>(where: string, fallback: T): (err: unknown) => T {
  return (err) => { noteSwallowed(where, err); return fallback; };
}
