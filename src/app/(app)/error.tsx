'use client';

import { CrashScreen } from '@/components/CrashScreen';

/**
 * Catches anything thrown inside the signed-in app — the feed, the dashboard and
 * every screen under them. Kept separate from the public boundary so a crash in
 * one athlete's activity card doesn't have to take the root layout down with it,
 * and so `retry()` re-fetches only this subtree.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <CrashScreen error={error} retry={retry} scope="app" />;
}
