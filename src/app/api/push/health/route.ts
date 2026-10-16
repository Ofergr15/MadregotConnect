import { NextResponse } from 'next/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { createServerClient } from '@/lib/supabase/server';
import { PUSH_DEAD_DAYS, lastReceipt, pushLooksDead, type DeviceReceipt } from '@/lib/push-health';

export const dynamic = 'force-dynamic';

/**
 * GET /api/push/health?athleteId= — are this member's notifications reaching any
 * phone? Read by the feed's "notifications aren't arriving" banner (lib/push-health
 * says what "dead" means). Self or staff, and only booleans and one date leave it.
 */
export async function GET(request: Request) {
  const athleteId = new URL(request.url).searchParams.get('athleteId');
  if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  const { denied } = await requireCallerForAthlete(request, athleteId);
  if (denied) return denied;

  try {
    const supabase = createServerClient();
    const since = new Date(Date.now() - PUSH_DEAD_DAYS * 86_400_000).toISOString();
    const [{ data: devices }, { count }] = await Promise.all([
      supabase.from('push_subscriptions').select('created_at, last_success_at').eq('athlete_id', athleteId),
      supabase
        .from('scheduled_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('audience_type', 'athlete')
        .eq('audience_id', athleteId)
        .eq('status', 'sent')
        .gt('last_sent_at', since),
    ]);
    const rows = (devices || []) as DeviceReceipt[];
    return NextResponse.json({
      dead: pushLooksDead(rows, count ?? 0),
      devices: rows.length,
      lastArrivedAt: lastReceipt(rows),
    });
  } catch {
    // Unknown is not dead: never nag a member because this read failed.
    return NextResponse.json({ dead: false, devices: 0, lastArrivedAt: null });
  }
}
