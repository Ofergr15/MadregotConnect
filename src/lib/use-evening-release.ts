import { useIsSuperUser } from '@/lib/impersonation';
import { EVENING_OPEN } from '@/lib/whats-new/evening';

/** The evening release (lib/whats-new/evening.ts): everyone once open; until then, the super user. */
export function useEveningRelease(): boolean {
  const superUser = useIsSuperUser();
  return EVENING_OPEN || superUser;
}
