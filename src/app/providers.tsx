'use client';

import { SWRConfig } from 'swr';
import { SWR_DEFAULTS } from '@/lib/api';

// App-wide client providers. SWRConfig gives every screen cache-first data with
// background revalidation — the foundation of the native "opens instantly" feel.
export function Providers({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={SWR_DEFAULTS}>{children}</SWRConfig>;
}
