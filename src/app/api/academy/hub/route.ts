import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isAcademyManager, visibleTraineeIds } from '@/lib/academy/pairing-server';
import { createServerClient } from '@/lib/supabase/server';
import { availableViews, resolveHubView } from '@/lib/academy/hub';
import { readHub } from '@/lib/academy/hub-server';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/hub?view=trainee|coach|manager — one payload per academy home.
 *
 * Trainee → themself only. Coach → staff, scoped to `visibleTraineeIds` (their pairs).
 * Manager → isAcademyManager, everyone. Asking wider than you hold returns the narrower
 * view you DO hold (narrow, don't 403). A non-academy member gets 403.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    let isTrainee = false;
    if (caller.athleteId) {
      const { data } = await createServerClient().from('athletes').select('is_academy').eq('id', caller.athleteId).maybeSingle<{ is_academy: boolean | null }>();
      isTrainee = !!data?.is_academy;
    }
    const hc = { isSuperUser: caller.isSuperUser, isStaff: caller.isStaff, isManager: isAcademyManager(caller), isTrainee };
    const view = resolveHubView(new URL(request.url).searchParams.get('view'), hc);
    if (!view) return NextResponse.json({ error: 'Academy access required' }, { status: 403 });

    // The coach view of a manager is their own pairs (visibleTraineeIds with scope=coach).
    let scope: Set<string> | null = null;
    if (view === 'coach') {
      const narrowed = new Request(`http://x/?scope=coach`);
      scope = await visibleTraineeIds(caller, narrowed);
    }
    const payload = await readHub({ view, views: availableViews(hc), callerId: caller.athleteId, scope });
    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('academy hub failed', error);
    return NextResponse.json(internalErrorBody('academy hub failed'), { status: 500 });
  }
}
