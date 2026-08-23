import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { POST as stravaSync } from '../sync-activities/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/strava/webhook — Strava's one-time subscription verification
 * handshake. When registering a subscription, Strava GETs this URL with
 * hub.mode=subscribe, hub.verify_token=<ours>, and hub.challenge=<random>;
 * a matching verify_token must echo the challenge back for the subscription
 * to be created. See admin/strava/webhook-subscribe for the registration
 * call itself.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ 'hub.challenge': challenge });
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

/**
 * POST /api/strava/webhook — real-time activity events from Strava
 * (create/update/delete, or an athlete deauthorizing). Strava expects a fast
 * 200 ack and retries on failure/timeout, so this is deliberately tolerant:
 * any object_type/aspect_type we don't care about, or an owner_id with no
 * matching athlete, is acked with 200 and simply does nothing. Runs the
 * SAME sync (and its post-workout feedback nudge) that Strava-connected
 * athletes previously only got from once-daily cron or opening the app —
 * this is what makes a new run land in MadregotConnect within seconds
 * instead of hours, matching how immediate Strava's own app feels.
 */
export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) return NextResponse.json({}, { status: 200 });

  const { object_type, aspect_type, owner_id } = payload as {
    object_type?: string;
    aspect_type?: string;
    owner_id?: number;
  };

  if (object_type !== 'activity' || aspect_type === 'delete' || !owner_id) {
    return NextResponse.json({}, { status: 200 });
  }

  try {
    const supabase = createServerClient();
    const { data: athlete } = await supabase
      .from('athletes')
      .select('id')
      .eq('strava_athlete_id', owner_id)
      .maybeSingle();

    if (athlete) {
      // Mirrors the direct-import pattern already used by cron/sync/route.ts
      // to call this same handler for a single athlete.
      const syntheticRequest = new Request('http://internal/strava-webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ athleteId: athlete.id }),
      });
      await stravaSync(syntheticRequest);
    }
  } catch (err) {
    console.error('Strava webhook sync failed:', err);
  }

  return NextResponse.json({}, { status: 200 });
}
