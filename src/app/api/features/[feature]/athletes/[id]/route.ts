import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isFeatureKey, mayToggle } from '@/lib/features/flags';
import { featureResolution } from '@/lib/features/server';
import { athleteToggleFacts, toggleCaller } from '@/lib/features/manage-server';

export const dynamic = 'force-dynamic';

// GET /api/features/[feature]/athletes/[id] → { enabled, source, mayToggle }
// The coach's runner view row "משוב ודיווח כאב: פעיל/כבוי". Staff only.
export async function GET(request: Request, { params }: { params: Promise<{ feature: string; id: string }> }) {
  const { feature, id } = await params;
  if (!isFeatureKey(feature)) return NextResponse.json({ error: 'unknown feature' }, { status: 404 });
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  const db = createServerClient();
  const athlete = await athleteToggleFacts(db, caller, id);
  if (!athlete) return NextResponse.json({ error: 'athlete not found' }, { status: 404 });
  const res = await featureResolution(feature, id, db);
  return NextResponse.json({
    ...res,
    mayToggle: mayToggle(toggleCaller(caller), { scopeType: 'athlete', scopeId: id, athlete, feature }),
  });
}
