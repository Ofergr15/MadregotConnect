'use client';

import { CoachSpaceShell } from '@/components/coach-space/shared';

// The coach space (lib/coach-space): /dashboard/coach/{today,week,runners,insights}, one
// folder so the four tabs share a layout — the gate (club switch / super-user preview) and the
// one runner card every tab opens.
export default function CoachSpaceLayout({ children }: { children: React.ReactNode }) {
  return <CoachSpaceShell>{children}</CoachSpaceShell>;
}
