'use client';

import { useIsSuperUser } from '@/lib/impersonation';
import { MoveControlRoom } from '@/components/admin/MoveControlRoom';

/** /dashboard/move — the Tokyo → Frankfurt move, run and verified from inside the app. Super user only. */
export default function MovePage() {
  const isSuper = useIsSuperUser();
  if (!isSuper) return null;
  return <MoveControlRoom />;
}
