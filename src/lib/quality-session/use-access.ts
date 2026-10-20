'use client';

import { useApi } from '@/lib/api';
import { useIsSuperUser } from '@/lib/impersonation';

export type QsAccess = 'yes' | 'no' | 'unknown';

/** The answer from what is known so far: a super user at once, else /api/auth/me's flag once it answers. */
export function qsAccessFrom(isSuper: boolean, me: { qualitySession?: boolean } | undefined, meFailed: boolean): QsAccess {
  if (isSuper || me?.qualitySession === true) return 'yes';
  if (me || meFailed) return 'no';
  return 'unknown';
}

/**
 * May this account open the quality session: the super user at once, anyone else
 * once /api/auth/me says so (the "אינסטגרם" switch, lib/quality-session/access.ts).
 * The same request the shell already makes, so it costs nothing. The API decides
 * again on its own; this only decides what is shown. Three states, so the screen
 * can say "loading" while it is still asking instead of rendering nothing.
 */
export function useQualitySessionAccessState(): QsAccess {
  const isSuper = useIsSuperUser();
  const { data, error } = useApi<{ qualitySession?: boolean }>('/api/auth/me');
  return qsAccessFrom(isSuper, data, !!error);
}

export function useQualitySessionAccess(): boolean {
  return useQualitySessionAccessState() === 'yes';
}
