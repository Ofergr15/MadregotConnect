'use client';

import { useApi } from '@/lib/api';
import { mayOpenControlRoom, type StaffGateMe } from '@/lib/auth/staff-pages';
import { ControlRoomScreen } from '@/components/admin/ControlRoomScreen';

/**
 * /dashboard/control-room — the club's control room, at a URL of its own.
 *
 * It used to be reachable only as /dashboard's admin branch, which worked while an
 * admin account was assumed not to be anybody's member account. It is: every admin in
 * this club is a coach or the owner, and they all run (2026-09-07, the same call behind
 * `resolveNavItems` and ProfileGate). So /dashboard is their TRAINING home now, and the
 * control room needed somewhere to be.
 *
 * An admin with no athlete row still lands on it at /dashboard — nothing else on that
 * screen would have anything to say to them — so for that account this route is a
 * second door to the same screen, exactly as ADMIN_ACCOUNT_ITEM and PROFILE_ITEM share
 * /dashboard/profile. One implementation either way: see ControlRoomScreen.
 *
 * Admin-only, and by omission rather than by redirect: everything on it comes from
 * /api/admin/overview, which is staff-gated server-side, so a non-admin who types the
 * URL gets a page with nothing on it rather than a rejection they cannot act on.
 */
export default function ControlRoomPage() {
  // The layout already loaded /api/auth/me (it gates every page on it), so SWR answers
  // from cache. Not useNavIdentity's effectiveRole: see mayOpenControlRoom.
  const { data: me, error } = useApi<StaffGateMe>('/api/auth/me');
  const allowed = mayOpenControlRoom(me);

  if (allowed === undefined && !error) {
    return (
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mt-20" />
    );
  }
  if (!allowed) return null;
  return <ControlRoomScreen />;
}
