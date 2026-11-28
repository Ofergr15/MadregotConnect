import { after, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { runStravaSyncRequest } from '../sync-activities/route';
import { createSeenSet, eventKey, webhookDecision, type StravaEvent } from '@/lib/strava/webhook-dedupe';

// Task 95: idempotency keyed by the Strava activity id (lib/strava/webhook-dedupe.ts).
const seenEvents = createSeenSet();
const inflightAthletes = new Set<string>();

export const dynamic = 'force-dynamic';
// The ack is instant; the after() sync behind it is a whole athlete's Strava sync and
// was being cut off at 60 s (QA 24.11 Q24-4). Same ceiling as the sync route itself.
export const maxDuration = 300;

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

  const event = payload as StravaEvent;
  if (webhookDecision(event, { firstTime: true, alreadyStored: false, inflight: false }) === 'ignore') {
    return NextResponse.json({}, { status: 200 });
  }

  try {
    const supabase = createServerClient();
    const { data: athlete } = await supabase
      .from('athletes')
      .select('id')
      .eq('strava_athlete_id', event.owner_id)
      .maybeSingle();

    if (athlete) {
      const key = eventKey(event);
      const firstTime = key ? seenEvents.firstTime(key) : true;
      let alreadyStored = false;
      if (firstTime && event.aspect_type === 'create' && event.object_id) {
        try {
          const { data: row } = await supabase
            .from('athlete_activities')
            .select('id')
            .eq('athlete_id', athlete.id)
            .eq('strava_activity_id', event.object_id)
            .limit(1)
            .maybeSingle();
          alreadyStored = !!row;
        } catch {
          alreadyStored = false;   // can't tell → sync; the import upserts on the Strava id
        }
      }
      const decision = webhookDecision(event, { firstTime, alreadyStored, inflight: inflightAthletes.has(athlete.id) });
      if (decision !== 'sync') return NextResponse.json({ skipped: decision }, { status: 200 });

      // Mirrors the direct-import pattern cron/sync/route.ts uses for the
      // Garmin sync: call the sync body, not the HTTP handler. Going through
      // the handler meant going through its self-or-staff gate, which a
      // synthetic in-process Request has no session to satisfy — every event
      // was denied and then acked 200, so the webhook has been a no-op.
      const syntheticRequest = new Request('http://internal/strava-webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ athleteId: athlete.id }),
      });
      // After the ack, not before it. Strava wants the 200 within 2 seconds and
      // retries when it doesn't come. after() keeps the work alive past the
      // response, within this route's maxDuration.
      inflightAthletes.add(athlete.id);
      after(async () => {
        try {
          await runStravaSyncRequest(syntheticRequest);
        } catch (err) {
          console.error('Strava webhook sync failed:', err);
        } finally {
          inflightAthletes.delete(athlete.id);
        }
      });
    }
  } catch (err) {
    console.error('Strava webhook sync failed:', err);
  }

  return NextResponse.json({}, { status: 200 });
}
