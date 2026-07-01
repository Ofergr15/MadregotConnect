import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { decrypt, encrypt } from '@/lib/encryption';
import { COACH_ID } from '@/lib/constants';

interface StravaAuth {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete_id: number;
}

async function refreshStravaToken(auth: StravaAuth): Promise<StravaAuth | null> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: auth.refresh_token,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete_id: auth.athlete_id,
  };
}

async function getValidToken(auth: StravaAuth, athleteId: string, supabase: any): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (auth.expires_at > now + 60) {
    return auth.access_token;
  }

  const refreshed = await refreshStravaToken(auth);
  if (!refreshed) return null;

  const encrypted = encrypt(refreshed);
  await supabase.from('athletes').update({ strava_auth: encrypted }).eq('id', athleteId);
  return refreshed.access_token;
}

export async function POST(request: Request) {
  try {
    const { athleteId } = await request.json();
    const supabase = createServerClient();

    const query = supabase
      .from('athletes')
      .select('id, name, strava_auth, data_source')
      .eq('coach_id', COACH_ID)
      .eq('data_source', 'strava');

    if (athleteId) {
      query.eq('id', athleteId);
    } else {
      query.not('strava_auth', 'is', null);
    }

    const { data: athletes, error: athError } = await query;
    if (athError) throw athError;
    if (!athletes || athletes.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No athletes with Strava auth found' });
    }

    let totalSynced = 0;
    const results: Array<{ athleteId: string; name: string; synced: number; error?: string }> = [];

    for (const athlete of athletes) {
      if (!athlete.strava_auth) continue;

      try {
        const auth = decrypt(athlete.strava_auth as string) as StravaAuth;
        const token = await getValidToken(auth, athlete.id, supabase);
        if (!token) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: 'Token refresh failed' });
          continue;
        }

        const after = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
        const activitiesRes = await fetch(
          `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (!activitiesRes.ok) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: `Strava API ${activitiesRes.status}` });
          continue;
        }

        const activities = await activitiesRes.json();
        const runActivities = activities.filter((a: any) =>
          a.type === 'Run' || a.type === 'TrailRun' || a.type === 'VirtualRun'
        );

        if (runActivities.length === 0) {
          results.push({ athleteId: athlete.id, name: athlete.name, synced: 0 });
          continue;
        }

        const { data: existing } = await supabase
          .from('athlete_activities')
          .select('strava_activity_id, start_time, distance')
          .eq('athlete_id', athlete.id);

        const existingStravaIds = new Set((existing || []).filter((e: any) => e.strava_activity_id).map((e: any) => e.strava_activity_id));
        const existingTimes = new Set((existing || []).map((e: any) => new Date(e.start_time).getTime()));

        const newActivities = runActivities.filter((a: any) => {
          if (existingStravaIds.has(a.id)) return false;
          const actTime = new Date(a.start_date_local).getTime();
          if (existingTimes.has(actTime)) return false;
          return true;
        });

        if (newActivities.length > 0) {
          const rows = newActivities.map((a: any) => {
            const durationSec = a.moving_time || a.elapsed_time;
            const distanceM = a.distance;
            return {
              athlete_id: athlete.id,
              strava_activity_id: a.id,
              garmin_activity_id: null,
              source: 'strava',
              activity_name: a.name,
              activity_type: a.type === 'TrailRun' ? 'trail_running' : 'running',
              start_time: a.start_date_local,
              distance: Math.round(distanceM),
              duration: Math.round(durationSec),
              average_pace: distanceM > 0 ? Math.round(durationSec / (distanceM / 1000)) : null,
              average_hr: a.average_heartrate || null,
              max_hr: a.max_heartrate || null,
              calories: a.calories || null,
              elevation_gain: a.total_elevation_gain || null,
              start_lat: a.start_latlng?.[0] || null,
              start_lng: a.start_latlng?.[1] || null,
              end_lat: a.end_latlng?.[0] || null,
              end_lng: a.end_latlng?.[1] || null,
              moving_duration: a.moving_time ? Math.round(a.moving_time) : null,
              has_polyline: !!a.map?.summary_polyline,
            };
          });

          const { error: insertError } = await supabase
            .from('athlete_activities')
            .insert(rows);

          if (insertError) throw insertError;
          totalSynced += newActivities.length;
        }

        results.push({ athleteId: athlete.id, name: athlete.name, synced: newActivities.length });
      } catch (e: any) {
        results.push({ athleteId: athlete.id, name: athlete.name, synced: 0, error: e.message });
      }
    }

    return NextResponse.json({ synced: totalSynced, results });
  } catch (error: any) {
    console.error('Strava sync error:', error);
    return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
  }
}
