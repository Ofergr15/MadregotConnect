'use client';

import { useEffect } from 'react';
import { CrashScreen } from '@/components/CrashScreen';
import { dropOlderReleaseCache } from '@/lib/swr-persist';

/**
 * Catches anything thrown inside the signed-in app — the feed, the dashboard and
 * every screen under them. Kept separate from the public boundary so a crash in
 * one athlete's activity card doesn't have to take the root layout down with it,
 * and so `retry()` re-fetches only this subtree.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // The screens now paint the answers kept from an older release (lib/swr-persist): if
  // one of those is what this screen could not read, drop them and reload it fresh —
  // once — instead of showing the crash.
  useEffect(() => {
    if (dropOlderReleaseCache()) window.location.reload();
  }, []);
  return <CrashScreen error={error} retry={retry} scope="app" />;
}
