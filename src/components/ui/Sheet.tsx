'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SheetProps } from './SheetDrawer';

// vaul pulls in @radix-ui/react-dialog, its Presence/Portal/DismissableLayer/
// FocusScope internals and a scroll-lock — 84 KB raw, measured, in one chunk.
// That chunk was on the initial load of all 30 in-app routes, because `Sheet` is
// re-exported from '@/components/ui' and 78 files import something from that
// barrel (only 39 of them touch a sheet at all). A bottom sheet is by definition
// closed until someone taps something, so none of those bytes need to be there
// before the page is interactive.
//
// So the drawer lives in its own module and this loads it on demand.
const SheetDrawer = dynamic(() => import('./SheetDrawer').then(m => m.SheetDrawer), {
  ssr: false,
});

/**
 * Native-style bottom sheet. Same props as before — see SheetDrawer for the
 * actual drawer; this only controls when that module is fetched.
 *
 * Controlled usage:
 *   <Sheet open={open} onOpenChange={setOpen} title="…">…</Sheet>
 */
export function Sheet(props: SheetProps) {
  // next/dynamic starts the fetch when the lazy component *renders*, and plenty
  // of callers (every ConfirmSheet, for one) keep a closed sheet mounted for the
  // life of the screen. So don't render it until the sheet has actually been
  // opened once — after that it stays mounted, which is what lets vaul animate
  // the close rather than having the sheet vanish.
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);

  // By the time a finger lands on the button that opens this, the module should
  // already be in memory: waiting for a network round trip on tap would trade a
  // faster load for a sheet that feels broken. So warm it once the page has gone
  // quiet — off the critical path, but well ahead of the interaction.
  // requestIdleCallback is still missing on Safari, which is every user here.
  useEffect(() => {
    if (opened) return;
    const t = setTimeout(() => { void import('./SheetDrawer'); }, 2000);
    return () => clearTimeout(t);
  }, [opened]);

  if (!opened) return null;
  return <SheetDrawer {...props} />;
}
