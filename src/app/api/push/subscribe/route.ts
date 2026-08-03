import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Store (or refresh) a device's push subscription for an athlete.
export async function POST(request: Request) {
  try {
    const { athleteId, subscription, userAgent } = await request.json();
    if (!athleteId || !subscription?.endpoint || !subscription?.keys) {
      return NextResponse.json({ error: 'athleteId and subscription required' }, { status: 400 });
    }

    const supabase = createServerClient();
    // Upsert on endpoint (unique) so re-subscribing the same device updates keys
    // / re-points it at the current athlete rather than duplicating.
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          athlete_id: athleteId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          user_agent: userAgent || null,
          last_success_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      );

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
