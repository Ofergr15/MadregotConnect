import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { FEATURE_KEYS } from '@/lib/features/flags';
import { featureResolutions } from '@/lib/features/server';
import { allowedScopeTypes } from '@/lib/features/flags';

export const dynamic = 'force-dynamic';

// GET /api/features/me → { features: { feedback_pain: boolean }, manage: ScopeType[] }
// What THIS caller sees switched on, plus which scopes they may manage (for the
// staff screen's entry point). Fails closed: no row / no table = off.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) { denied.headers.set('Cache-Control', 'private, no-store'); return denied; }
  const db = createServerClient();
  const t0 = performance.now();
  // One read of the enablement table and one of the athlete — was two per key, in series.
  const resolved = caller.athleteId ? await featureResolutions(FEATURE_KEYS, caller.athleteId, db) : null;
  const dbMs = performance.now() - t0;
  const features: Record<string, boolean> = {};
  for (const f of FEATURE_KEYS) features[f] = resolved ? resolved[f].enabled : false;
  const manage = caller.isStaff || caller.isSuperUser
    ? allowedScopeTypes({ athleteId: caller.athleteId, role: caller.role, roles: caller.roles, isSuperUser: caller.isSuperUser })
    : [];
  // Per caller with no Vary: any max-age lets iOS URLCache / a browser hand the previous
  // user's flags to the next one on a shared iPad (QA 24.11 Q24-1). Same as me/capabilities.
  return NextResponse.json({ features, manage }, {
    headers: { 'Cache-Control': 'private, no-store', 'Server-Timing': `db;dur=${dbMs.toFixed(1)}` },
  });
}
