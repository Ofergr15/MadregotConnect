'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { ATHLETE_LINK_FOCUS, teammateHref } from '@/lib/athletes/profile-link';

// Wrap a name, an avatar, or a whole name-plus-avatar block to make that person
// tappable. Every list in the app that renders another member goes through this,
// so "tap a person, get their profile" is one rule with one implementation
// rather than a property of whichever screen you happen to be on.
//
// It renders an <a> (via next/link) and never an onClick on a <span>, which
// matters for more than tidiness: a real anchor is focusable and activates on
// Enter for free, announces itself as a link to VoiceOver, and supports
// long-press / open-in-new-tab. A div with a handler has none of that, and every
// one of these sits in a list where the keyboard is the only way through.

interface Props {
  /** The athlete's id. Nullable on purpose — see the fallback behaviour below. */
  athleteId: string | null | undefined;
  /** Used for the accessible name, since the visible child is often just a first name or a bare avatar. */
  name?: string | null;
  className?: string;
  children: React.ReactNode;
  /**
   * Set when this link sits inside a row that has its own click/press handler
   * (a `role="button"` row that opens an activity, a card that expands). Without
   * it the tap does BOTH things: it navigates to the profile and it fires the
   * row's handler, so you arrive somewhere while a second navigation is queued
   * behind you — in the group-run card that meant tapping a runner's face opened
   * their teammate profile and the activity detail, and which one you ended up on
   * depended on the order the two routers resolved.
   */
  stopPropagation?: boolean;
  /**
   * Extra work the caller needs done as the navigation starts — in practice,
   * closing the sheet the link was rendered inside. Without it a bottom sheet
   * stays mounted over the page you just navigated to, because a route change is
   * not a dismissal. Not merged into `stopPropagation`: this one runs, that one
   * suppresses, and a caller can want either without the other.
   */
  onNavigate?: () => void;
  /**
   * Add an invisible halo so the link is a 48×48 touch target without its visible
   * box changing size.
   *
   * Opt-in and not the default, deliberately. The audit measured these links at 36
   * tall on the squad leaderboard, on the team-volume table and in the feed — the
   * component has no height of its own, it wears whatever className the list gives
   * it — but the three are not the same case. A roster row is plain text around the
   * link, so a halo can only take taps away from text. A FEED CARD is itself a
   * control: the card opens the run, the name inside it opens the person, and a halo
   * there would quietly hand 6px of the card to the profile. So the callers where
   * the halo is safe say so, one at a time, instead of every list inheriting it.
   *
   * 48 and not 44 for the reason written up on the activity header buttons: a halo
   * measured at exactly 44 comes back a pixel short in WebKit.
   *
   * ⚠️ Useless on a link that CLIPS. `truncate` (or any `overflow-hidden`) on the
   * same element clips the `after:` box away, so the halo adds no reach — and it
   * still counts towards `scrollWidth`, which makes the link measure as 6px
   * truncated when it is not. On a clipping link, move the clipping inward to a
   * child and give the link a real `min-h`/`inline-flex` box instead (see the host
   * name on the run-meetup board).
   */
  tapHalo?: boolean;
}

export function AthleteLink({ athleteId, name, className, children, stopPropagation, onNavigate, tapHalo }: Props) {
  const tc = useTranslations('common');
  const href = teammateHref(athleteId);

  // No id in hand — a system-authored feed item, a roster row for somebody
  // whose athlete row is gone, an academy registration that was never claimed.
  // Render exactly what was passed, with no interactive affordance, rather than
  // a live-looking link to /dashboard/teammate/undefined.
  if (!href) return <span className={className}>{children}</span>;

  return (
    <Link
      href={href}
      className={cn(
        ATHLETE_LINK_FOCUS,
        tapHalo && "relative after:absolute after:-inset-y-1.5 after:-inset-x-1.5 after:content-['']",
        className,
      )}
      aria-label={name ? tc('viewProfileOf', { name }) : undefined}
      onClick={
        stopPropagation || onNavigate
          ? (e) => {
              if (stopPropagation) e.stopPropagation();
              onNavigate?.();
            }
          : undefined
      }
      // Keyboard needs its own guard. Those wrapper rows are `role="button"` divs
      // listening for Enter/Space on keyDown, and that handler fires on the way up
      // from the focused anchor too — so a keyboard user pressing Enter on a name
      // triggered the row as well, even though the click guard above had already
      // made the same gesture behave correctly for a thumb.
      onKeyDown={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {children}
    </Link>
  );
}
