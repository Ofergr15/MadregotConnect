import type { SupabaseClient } from '@supabase/supabase-js';
import type { StravaLap } from '@/lib/strava/client';
import {
  LAPS_CLIPBOARD_VERSION,
  renderStravaLapsPng,
} from './strava-laps-clipboard';

const BUCKET = 'run-chat';

export async function ensureLapsArtifact(
  supabase: SupabaseClient,
  activity: {
    id: string;
    activity_name?: string | null;
    distance?: number | null;
    duration?: number | null;
    laps?: StravaLap[] | null;
  },
): Promise<string | null> {
  if (!activity.laps?.length) return null;

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
    laps: activity.laps,
  });
  const path = `${activity.id}/laps-${LAPS_CLIPBOARD_VERSION}.png`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, png, { contentType: 'image/png', upsert: true });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${LAPS_CLIPBOARD_VERSION}`;
}
