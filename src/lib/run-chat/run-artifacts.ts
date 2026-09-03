import type { SupabaseClient } from '@supabase/supabase-js';
import type { StravaLap } from '@/lib/strava/client';
import {
  LAPS_CLIPBOARD_VERSION,
  renderStravaLapsPng,
} from './strava-laps-clipboard';

const BUCKET = 'run-chat';

function syntheticTotalLap(activity: {
  distance?: number | null;
  duration?: number | null;
  average_pace?: number | null;
  average_hr?: number | null;
}): StravaLap {
  const distance = activity.distance || 0;
  const duration = activity.duration || 0;
  const paceSec = activity.average_pace || (distance && duration ? duration / (distance / 1000) : 0);
  return {
    name: 'Total',
    distance,
    moving_time: duration,
    average_speed: paceSec ? 1000 / paceSec : 0,
    average_heartrate: activity.average_hr || undefined,
    lap_index: 1,
  };
}

export async function ensureLapsArtifact(
  supabase: SupabaseClient,
  activity: {
    id: string;
    activity_name?: string | null;
    distance?: number | null;
    duration?: number | null;
    average_pace?: number | null;
    average_hr?: number | null;
    laps?: StravaLap[] | null;
  },
): Promise<string | null> {
  const laps = activity.laps?.length ? activity.laps : [syntheticTotalLap(activity)];

  const { data: bucket } = await supabase.storage.getBucket(BUCKET);
  if (!bucket) {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 10_000_000,
    });
    if (error && !error.message.toLowerCase().includes('already exists')) throw error;
  }

  const png = await renderStravaLapsPng({
    title: activity.activity_name || 'Laps',
    distanceM: activity.distance,
    durationSec: activity.duration,
    laps,
  });
  // Lap count in the path: when real laps land after a synthetic "Total" card
  // was rendered, browsers/CDN must not keep serving the old single-block PNG.
  const path = `${activity.id}/laps-${LAPS_CLIPBOARD_VERSION}-${laps.length}.png`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, png, { contentType: 'image/png', upsert: true });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${LAPS_CLIPBOARD_VERSION}`;
}
