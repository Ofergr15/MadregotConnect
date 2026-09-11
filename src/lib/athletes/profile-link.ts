// One way to get from a person's name or face to that person's profile.
//
// Before this existed, "tap a person" was a property of whichever list you
// happened to be looking at. The feed card linked its author, the leaderboard
// linked its rows, member discovery linked its results — and the דבוקה chips on
// the attendance screen, the likes sheet, the squad standings, the roster and
// half a dozen admin tables rendered the exact same avatar-plus-name and were
// dead text. From the outside the app has no rule: some people are tappable and
// some are not, and there is nothing on screen that tells you which is which
// before you try. That is the complaint this module answers, and the reason the
// href is centralised rather than spelled out at each of ~20 call sites: a
// hardcoded template string cannot be grepped for absence, so the NEXT list
// somebody adds silently ships dead names again. `src/__tests__/athleteProfileLinks.test.ts`
// asserts that every people-rendering component in the app reaches this module.
//
// The destination is /dashboard/teammate/[id] and NOT the coach-only roster at
// /dashboard/athletes: teammate is the peer-facing profile that any club member
// is allowed to open for any other member (see the header comment on that page),
// it handles "this is actually me" by hiding the follow toggle rather than
// erroring, and it renders a real not-found state for an id that no longer
// resolves. Deliberately not a second way to show a person.

/** Route prefix for the peer-facing profile. Not exported for interpolation — use `teammateHref`. */
const TEAMMATE_BASE = '/dashboard/teammate';

/**
 * The profile href for an athlete, or `null` when there is nobody to link to.
 *
 * Returning `null` rather than a best-effort string is the whole point. Several
 * of the lists that render a person carry an id that is only *usually* there:
 * feed items can be system-authored with no athlete row behind them, a roster
 * row for a removed member can come back without one, and an academy trainee
 * who has not claimed an account has a registration but no athlete id. Building
 * the URL anyway produces `/dashboard/teammate/undefined` — a link that looks
 * live, passes every visual review, and lands on the not-found screen. A `null`
 * href makes the caller render plain text instead, which is honest.
 *
 * The literal strings 'undefined' and 'null' are rejected explicitly because
 * that is what a missing id looks like after it has been through template
 * interpolation once already upstream.
 */
export function teammateHref(athleteId: string | null | undefined): string | null {
  if (typeof athleteId !== 'string') return null;
  const id = athleteId.trim();
  if (!id || id === 'undefined' || id === 'null') return null;
  return `${TEAMMATE_BASE}/${encodeURIComponent(id)}`;
}

/**
 * Shared focus/hover treatment for a person link.
 *
 * A person's name is body text, so it gets no underline and no colour at rest —
 * making every name in the app blue would repaint every screen. What it must
 * have is a visible focus ring: these links sit inside lists that are otherwise
 * plain text, so a keyboard user tabbing through a roster of thirty people has
 * no other cue about where they are. `focus-visible` keeps the ring off the
 * touch path, which is why it can be this loud (same reasoning as the shared
 * Button in components/ui).
 */
export const ATHLETE_LINK_FOCUS =
  'rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';
