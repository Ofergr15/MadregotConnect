'use client';

import { useApi } from '@/lib/api';
import { useIsSuperUser } from '@/lib/impersonation';

/**
 * May this account open the quality session: the super user at once, anyone else
 * once /api/auth/me says so (the "אינסטגרם" switch, lib/quality-session/access.ts).
 * The same request the shell already makes, so it costs nothing. The API decides
 * again on its own; this only decides what is shown.
 */
export function useQualitySessionAccess(): boolean {
  const isSuper = useIsSuperUser();
  const { data } = useApi<{ qualitySession?: boolean }>('/api/auth/me');
  return isSuper || data?.qualitySession === true;
}
