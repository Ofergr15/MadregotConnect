import { notFound } from 'next/navigation';

// Photos is still being built. The real page is parked next door as
// page.disabled.tsx (colocated files that aren't `page`/`layout`/etc. don't
// become routes) — to ship it, delete this stub, rename that file back to
// page.tsx, and restore the nav entries in Header.tsx and BottomTabBar.tsx.
export default function PhotosDisabled() {
  notFound();
}
