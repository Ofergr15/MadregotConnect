// "View as this person" for the super user — the academy's test of what a given
// coach or trainee really sees (2026-10-06). Shared by the server (requireSession)
// and the client (bearerHeaders, the academy screen), so the header name and the
// rule about where it counts live in one place.
//
// Unlike the older role preview (lib/impersonation.ts), which only changes what
// is DRAWN, this changes who the server answers as: the request carries the
// super user's own verified token plus `x-view-as: <athleteId>`, and
// requireSession hands the route that athlete's session instead. Three limits:
//
//   - the super user only; anybody else's header is ignored;
//   - reads only: any other method while viewing is refused (403), so a test can
//     never write as somebody else;
//   - the academy's API only (VIEW_AS_PATHS). The academy screen learns whose
//     role to draw from /api/academy/viewer; /api/auth/me is NOT covered, so the
//     shell, the nav and every other screen stay the super user's own.

export const VIEW_AS_HEADER = 'x-view-as';

export const VIEW_AS_PATHS = ['/api/academy/'];

export function viewAsApplies(pathname: string): boolean {
  return VIEW_AS_PATHS.some((p) => pathname.startsWith(p));
}

/** An athlete id is a uuid; anything else is not worth a lookup. */
export function looksLikeAthleteId(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
