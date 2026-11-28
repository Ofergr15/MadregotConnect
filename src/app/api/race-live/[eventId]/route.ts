import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { liveBoard } from '@/lib/race-live/server';
import { raceBoardGuard } from '@/lib/race-live/load-guard';
import { clientIp } from '@/lib/academy/intake';

export const dynamic = 'force-dynamic';

// GET the live board. Any verified member with race_live ON (staff always). Off → {enabled:false},
// which the tab renders as the pre-race content it already has.
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  try {
    const db = createServerClient();
    const on = caller.isStaff || caller.isSuperUser || (await isFeatureEnabled('race_live', caller.athleteId, db));
    if (!on) return NextResponse.json({ enabled: false });
    // Load guard (task 176): per-viewer limit, and a cached snapshot when busy or the DB fails.
    const viewerKey = caller.athleteId ?? `ip:${clientIp(request.headers)}`;
    const g = await raceBoardGuard.board(viewerKey, eventId, () => liveBoard(db, eventId, caller.athleteId), () => liveBoard(db, eventId, null));
    if (g.kind === 'fresh') return NextResponse.json({ enabled: true, ...g.board });
    if (g.kind === 'cached') return NextResponse.json({ enabled: true, ...g.board, degraded: g.reason, snapshotAt: g.snapshotAt });
    if (g.kind === 'limited') return NextResponse.json({ error: 'rate-limited' }, { status: 429, headers: { 'retry-after': String(g.retryAfterSec) } });
    throw g.error;
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'board failed' }, { status: 500 });
  }
}
