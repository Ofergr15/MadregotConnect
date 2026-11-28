/**
 * Request ids (task 64). `src/proxy.ts` stamps `x-request-id` on every /api request
 * (keeping a caller's or Vercel's own id when one is present) and echoes it on the
 * response, so a user-reported failure, the client log and the server log line can
 * be joined on one value. Routes read it with `requestIdOf(request)`.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_ID = /^[A-Za-z0-9:_.-]{6,128}$/;

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/** A caller-supplied id is kept only if it is a plain token — never log arbitrary header text. */
export function requestIdOf(req: { headers: Headers }): string {
  const own = req.headers.get(REQUEST_ID_HEADER);
  if (own && SAFE_ID.test(own)) return own;
  const vercel = req.headers.get('x-vercel-id');
  if (vercel && SAFE_ID.test(vercel)) return vercel;
  return newRequestId();
}
