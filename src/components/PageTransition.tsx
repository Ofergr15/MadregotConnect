'use client';

import { usePathname } from 'next/navigation';

// Phase 4: play a quick fade+rise on each route change so screens don't hard-cut.
// Keying the wrapper on pathname remounts it per navigation, which retriggers the
// CSS `pageEnter` animation (see .mg-page-enter in globals.css). Purely visual —
// no data or layout impact; respects prefers-reduced-motion via the CSS guard.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="mg-page-enter">
      {children}
    </div>
  );
}
