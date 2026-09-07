'use client';

import { useEffect, useState } from 'react';
import { useNavIdentity } from '@/lib/nav-items';
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
  const { effectiveRole, ready } = useNavIdentity();
  // The role resolves through SWR, which the nav chromes on this page have already
  // asked for — but `ready` can be true on the first render from that cache, and a
  // frame of the control room for an account that may not have it is worse than a
  // frame of nothing.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!ready || !mounted) {
    return (
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mt-20" />
    );
  }
  if (effectiveRole !== 'admin') return null;
  return <ControlRoomScreen />;
}
