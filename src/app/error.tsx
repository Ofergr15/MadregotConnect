'use client';

import { CrashScreen } from '@/components/CrashScreen';

/**
 * Catches anything thrown by a page outside the (app) group — /register, /login,
 * /join, /invite, /pending-approval. Those are the routes a brand-new user hits
 * first, so a blank screen here is the worst possible first impression.
 */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <CrashScreen error={error} retry={retry} scope="public" />;
}
