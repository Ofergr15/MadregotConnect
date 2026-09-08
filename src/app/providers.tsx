'use client';

import { SWRConfig } from 'swr';
import { SWR_DEFAULTS } from '@/lib/api';
import { persistedCacheProvider } from '@/lib/swr-persist';
import { PostHogIdentity } from '@/components/PostHogIdentity';

// App-wide client providers. SWRConfig gives every screen cache-first data with
// background revalidation — the foundation of the native "opens instantly" feel.
//
// `provider` is what makes that survive a full document load rather than only a
// soft navigation: without it every reload, and every time iOS discards the
// PWA's web view, started from an empty cache and the app spun up from spinners.
// See lib/swr-persist.ts for what it stores, and for the identity scoping and
// sign-out wipe that come with storing club data on the device.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ ...SWR_DEFAULTS, provider: persistedCacheProvider }}>
      <PostHogIdentity />
      {children}
    </SWRConfig>
  );
}
