import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { FEATURE_KEYS } from '@/lib/features/flags';
import { featureResolution } from '@/lib/features/server';
import { allowedScopeTypes } from '@/lib/features/flags';

export const dynamic = 'force-dynamic';

// GET /api/features/me → { features: { feedback_pain: boolean }, manage: ScopeType[] }
// What THIS caller sees switched on, plus which scopes they may manage (for the
// staff screen's entry point). Fails closed: no row / no table = off.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const db = createServerClient();
  const features: Record<string, boolean> = {};
  for (const f of FEATURE_KEYS) {
    features[f] = caller.athleteId ? (await featureResolution(f, caller.athleteId, db)).enabled : false;
  }
  const manage = caller.isStaff || caller.isSuperUser
    ? allowedScopeTypes({ athleteId: caller.athleteId, role: caller.role, roles: caller.roles, isSuperUser: caller.isSuperUser })
    : [];
  return NextResponse.json({ features, manage });
}
