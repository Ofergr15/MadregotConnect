/**
 * Error bodies: `{ error: string, code: ErrorCode, ...extra }`.
 *
 * `error` is for people and logs, and its wording changes. `code` is for programs — the
 * web client, the iOS app — and is STABLE: a value here is never renamed or reused for a
 * different meaning (docs/api-errors.md). A client switches on `code`, never on `error`.
 *
 * Not every route sends `code` yet (src/__tests__/errorCodeRatchet.test.ts counts the ones
 * that don't, and the count may only go down). A client reads it through `errorCodeOf`,
 * which falls back to the status, so the answer is stable either way.
 */

/** The catalogue. Add codes; never rename or remove one (installed apps switch on them). */
export const ERROR_CODES = {
  bad_request: 400,
  unauthenticated: 401,
  session_invalid: 401,
  forbidden: 403,
  staff_required: 403,
  pending: 403,
  inactive: 403,
  view_as_read_only: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
  auth_unavailable: 503,
  maintenance: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** The generic code for a status, when nothing more specific is known. */
export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400: case 422: return 'bad_request';
    case 401: return 'unauthenticated';
    case 403: return 'forbidden';
    case 404: case 410: return 'not_found';
    case 409: return 'conflict';
    case 413: return 'payload_too_large';
    case 429: return 'rate_limited';
    case 502: case 503: case 504: return 'unavailable';
    default: return status >= 500 ? 'internal' : 'bad_request';
  }
}

export const isErrorCode = (v: unknown): v is ErrorCode => typeof v === 'string' && Object.hasOwn(ERROR_CODES, v);

/** A route's error body. `extra` keys (e.g. `left`, `allowed`) ride along; they cannot overwrite `error`/`code`. */
export function errorBody(status: number, error: string, code?: ErrorCode, extra?: Record<string, unknown>) {
  return { ...extra, error, code: code ?? errorCodeForStatus(status) };
}

/** `NextResponse.json(errorBody(...), { status })` without importing next/server here (client-safe module). */
export function apiError(status: number, error: string, code?: ErrorCode, extra?: Record<string, unknown>): Response {
  return Response.json(errorBody(status, error, code, extra), { status });
}

/**
 * What a 500 tells the caller. CLAUDE.md API conventions return `{ error: string }`; a
 * catch-all that did `String(err)` returned "[object Object]" for a thrown PostgrestError
 * and, for SDK errors (Stream, Rekognition, Drive), their full text — which can name
 * member ids or emails ("users … don't exist: [uuid, …]"). The real error goes to the
 * server log; the response carries a fixed message.
 */
export function internalErrorBody(fallback = 'Internal error'): { error: string; code: 'internal' } {
  return { error: fallback, code: 'internal' };
}

/** A machine code: lowercase slug. Route-specific codes (`no_plan`, `table_missing`) are allowed beside the catalogue. */
export const CODE_SLUG = /^[a-z][a-zA-Z0-9_-]{1,40}$/;

/**
 * The code of a failed response, for a client. Prefers the body's own `code` (a catalogue
 * code or a route's own documented one); for a route that does not send one yet, the
 * status decides — so the same failure always yields the same code whichever way the
 * server spells `error`.
 */
export function errorCodeOf(status: number, body: unknown): ErrorCode | (string & {}) {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CODE_SLUG.test(code) ? code : errorCodeForStatus(status);
}
