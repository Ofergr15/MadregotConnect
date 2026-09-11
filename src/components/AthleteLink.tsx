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
}

export function AthleteLink({ athleteId, name, className, children, stopPropagation, onNavigate }: Props) {
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
      className={cn(ATHLETE_LINK_FOCUS, className)}
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
