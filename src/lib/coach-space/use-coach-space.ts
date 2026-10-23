'use client';

// Whether this device shows the coach space (lib/coach-space/switch.ts is the club switch).
//
//  - ON: every account rendering as `coach` gets the coach bar (היום · השבוע · רצים · תובנות + עוד).
//  - OFF: nobody does — except the super user's PREVIEW: open any page with `?cs=1` (remembered on
//    the device, `?cs=off` clears it) while viewing the app as a coach (view-as → מאמן). The
//    same idiom as `?tv=2` for the trainee v2 (lib/trainee/v2.ts).
//  - The admin's bar never changes: `admin` (and the academy roles) are not `coach`.
//
// The four screens themselves (/dashboard/coach/*) open for the super user whatever the
// switch says, so he can look at them without changing his own bar.

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';

export const COACH_SPACE_PREVIEW_KEY = 'mc-coach-space';

/** Reads (and remembers) the `?cs=1` / `?cs=off` switch. */
export function previewCoachSpace(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('cs');
    if (q === '1') localStorage.setItem(COACH_SPACE_PREVIEW_KEY, '1');
    if (q === 'off') localStorage.removeItem(COACH_SPACE_PREVIEW_KEY);
    return localStorage.getItem(COACH_SPACE_PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

/** Pure: does this identity get the coach bar? */
export function coachSpaceBar(x: { effectiveRole: string | null; on: boolean; isSuper: boolean; preview: boolean }): boolean {
  if (x.effectiveRole !== 'coach') return false;
  return x.on || (x.isSuper && x.preview);
}

/** Pure: may this identity open the four screens? */
export function coachSpaceOpen(x: { isStaffView: boolean; on: boolean; isSuper: boolean }): boolean {
  return x.isSuper || (x.isStaffView && x.on);
}

export function useCoachSpace(identity: { ready: boolean; effectiveRole: string | null; isSuper: boolean; isStaffView: boolean }) {
  const [preview, setPreview] = useState(false);
  useEffect(() => { setPreview(previewCoachSpace()); }, []);
  const ask = identity.ready && (identity.isStaffView || identity.isSuper);
  const { data, isLoading } = useApi<{ on: boolean }>(ask ? '/api/coach-space/switch' : null);
  const on = !!data?.on;
  return {
    known: !ask || !isLoading,
    on,
    preview,
    bar: coachSpaceBar({ effectiveRole: identity.effectiveRole, on, isSuper: identity.isSuper, preview }),
    open: coachSpaceOpen({ isStaffView: identity.isStaffView, on, isSuper: identity.isSuper }),
  };
}
