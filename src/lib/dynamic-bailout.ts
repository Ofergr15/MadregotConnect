/**
 * Next signals "this route can't be prerendered after all" by THROWING, which a
 * route wrapped in `try { … } catch { return 500 }` happily swallows.
 *
 * It bites the routes that pair `export const revalidate = N` with a read of the
 * request (session gating): the build tries to render them statically, the gate
 * touches `request.headers`, and Next throws a DynamicServerError to bail out and
 * mark the route dynamic. Caught, it looks like a real failure — the build logs
 * "Leaderboard error: …" as if the leaderboard were broken — and at runtime the
 * same swallow would turn a legitimate bailout into a 500 for the caller.
 *
 * Call this first in any such catch block. The digest string is Next's own stable
 * marker for the condition; matching on it avoids a `next/dist/...` deep import.
 */
export function rethrowIfDynamicBailout(error: unknown): void {
  if ((error as { digest?: string } | null)?.digest === 'DYNAMIC_SERVER_USAGE') {
    throw error;
  }
}
