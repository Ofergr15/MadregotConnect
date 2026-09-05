'use client';

import { useEffect, useRef } from 'react';

/** Where in the overlay stack the current history entry sits. 0 = bare page. */
const DEPTH = '__overlayDepth';

/**
 * Makes Back close an overlay instead of leaving the page.
 *
 * Nothing in this app used to put overlay state in history: every sheet, modal
 * and multi-step flow was a `useState` boolean, so the iOS back-swipe — which is
 * how people actually go back inside a PWA, there being no chrome to tap — fired
 * a real navigation. Open the "More" sheet on the feed, swipe back, and you land
 * on whatever page you were on before the feed, with the sheet still notionally
 * "open" in a component that no longer exists. In the weekly planner, where the
 * whole parse → review → push flow is four of those booleans deep, one swipe
 * threw away a parsed week.
 *
 * The entry pushed here has the same URL as the page, so nothing about the
 * address changes and a reload lands on the page with the overlay shut, which is
 * the correct resting state. It carries the app router's own `history.state`
 * forward — dropping that is what makes Next's router lose the route tree on the
 * way back.
 *
 * @param open       whether the overlay is currently showing
 * @param onDismiss  close it — called when Back pops this overlay's entry
 */
export function useBackDismiss(open: boolean, onDismiss: () => void) {
  // Read through a ref so a caller passing an inline arrow doesn't re-run the
  // effect on every render — which would push a history entry per render.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  // The entry this instance pushed, or null when it owns none. Null is also what
  // keeps the two close paths (Back, and everything else) from both popping it.
  const entry = useRef<{ depth: number; href: string } | null>(null);

  // Set when the close we're about to see was started by a tap on a link, which
  // means a navigation is on its way. See the close path for why that matters.
  const navigating = useRef(false);

  useEffect(() => {
    if (!open) {
      // Closed by a tap, a drag or Escape rather than by Back, so the entry is
      // still on the stack and would swallow the user's next Back press as a
      // no-op. Pop it — when Back is what closed us, `onPop` already cleared
      // this, so there's nothing here to double-pop.
      const e = entry.current;
      if (!e) return;
      entry.current = null;
      const wasNav = navigating.current;
      navigating.current = false;
      // Not when a link inside the overlay is what closed it. Nav items close the
      // sheet in their own onClick and let <Link> navigate, and the app router
      // doesn't commit the new URL until ~60 ms later (measured) — so `location`
      // still reads as this page here, and popping now cancels the navigation
      // outright: the sheet shuts and the user stays put. Leaving our entry
      // buried instead costs one extra Back press on the way out and breaks
      // nothing, because the entries Next pushes on top are what Back consumes
      // first.
      if (wasNav || location.href !== e.href) return;
      history.back();
      return;
    }

    // Guarded rather than unconditional, because React's dev-mode double-invoke
    // runs this effect twice with one cleanup in between. Pushing on the second
    // run would strand an entry that no close path ever pops.
    if (!entry.current) {
      const depth = ((history.state?.[DEPTH] as number | undefined) ?? 0) + 1;
      history.pushState({ ...history.state, [DEPTH]: depth }, '');
      entry.current = { depth, href: location.href };
    }
    navigating.current = false;

    const onPop = () => {
      const landedAt = (history.state?.[DEPTH] as number | undefined) ?? 0;
      // Every mounted overlay hears this one popstate, so each has to work out
      // whether it was the one popped. Only overlays deeper than where we landed
      // were: with two sheets stacked, Back moves depth 2 → 1, closing the inner
      // sheet and leaving the outer one — which is what a phone user expects.
      if (!entry.current || landedAt >= entry.current.depth) return;
      // Cleared before dismissing, because dismissing flips `open` and re-runs
      // the branch above in the same tick; the entry is already off the stack.
      entry.current = null;
      dismiss.current();
    };
    window.addEventListener('popstate', onPop);

    // Capture phase, so this runs before the handler that closes the overlay —
    // which is the whole point: by the time the close path above runs, the only
    // evidence left that a navigation is coming is that we recorded it here.
    const onClick = (ev: MouseEvent) => {
      const el = ev.target as Element | null;
      if (el?.closest?.('a[href]')) navigating.current = true;
    };
    document.addEventListener('click', onClick, true);

    // Only the listeners are torn down here. Popping belongs to the `!open`
    // branch, which runs when the overlay genuinely closes rather than on every
    // re-run of this effect.
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick, true);
    };
  }, [open]);
}
