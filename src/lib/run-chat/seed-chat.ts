/**
 * First-open seeding for a run chat:
 *  - planned_text / planned_workout + Garmin-style plan clipboard
 *  - actuals: Strava link + laps PNG + GPX file (when Strava activity exists)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Channel as StreamChannel } from 'stream-chat';
import { CLIPBOARD_VERSION, renderGarminClipboardPng } from './garmin-clipboard';
import { LAPS_CLIPBOARD_VERSION } from './strava-laps-clipboard';
import { ensureLapsArtifact } from './run-artifacts';
import {
  TEST_ACTIVITY_ID,
  TEST_PLANNED_TEXT,
  TEST_PLANNED_WORKOUT,
  type PlannedWorkout,
} from './mock-workout';
import { AI_USER_ID } from '@/lib/stream/server';
import { getStravaActivityUrl, type StravaLap } from '@/lib/strava/client';
import { activitySummary, type RunActivity } from './run-analysis';
import {
  downsampleRoute,
  RUN_ATTACHMENT_VERSION,
  type RoutePoint,
  type StravaRunAttachment,
} from './attachments';

const BUCKET = 'run-chat';
const CLIPBOARD_PATH = (activityId: string) => `${activityId}/clipboard-${CLIPBOARD_VERSION}.png`;

export interface RunChatRow {
  id: string;
  activity_id: string;
  athlete_id: string;
  coach_id: string | null;
  stream_channel_id: string | null;
  planned_text: string | null;
  planned_workout: unknown | null;
  clipboard_image_url?: string | null;
  [key: string]: unknown;
}

async function ensureBucket(supabase: SupabaseClient) {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10_000_000 });
  }
}

function resolvePlan(
  activityId: string,
  fromWeekly: string | null,
  fromStructured?: PlannedWorkout | null,
): {
  plannedText: string;
  plannedWorkout: PlannedWorkout;
} {
  if (activityId === TEST_ACTIVITY_ID) {
    return { plannedText: TEST_PLANNED_TEXT, plannedWorkout: TEST_PLANNED_WORKOUT };
  }
  if (fromStructured) {
    return {
      plannedText: fromWeekly || fromStructured.prompt || fromStructured.title,
      plannedWorkout: fromStructured,
    };
  }
  if (!fromWeekly) {
    return {
      plannedText: 'לא נמצאה תוכנית אימון שפורסמה ותואמת לריצה הזו.',
      plannedWorkout: {
        title: 'אין תוכנית תואמת',
        prompt: 'No published workout part is matched to this activity.',
        segments: [],
      },
    };
  }
  return {
    plannedText: fromWeekly,
    plannedWorkout: {
      title: 'תוכנית אימון',
      prompt: fromWeekly,
      segments: [
        { kind: 'easy', label: 'Workout', detail: fromWeekly, note: fromWeekly },
      ],
    },
  };
}

async function ensureClipboardImage(
  supabase: SupabaseClient,
  chat: RunChatRow,
  workout: PlannedWorkout,
  preferredImageUrl?: string | null,
): Promise<string> {
  if (preferredImageUrl) {
    if (chat.clipboard_image_url !== preferredImageUrl) {
      const { error } = await supabase
        .from('run_chats')
        .update({ clipboard_image_url: preferredImageUrl })
        .eq('id', chat.id);
      if (error) console.warn('published clipboard URL update skipped:', error.message);
    }
    return preferredImageUrl;
  }
  if (chat.clipboard_image_url?.includes(`clipboard-${CLIPBOARD_VERSION}`)) {
    return chat.clipboard_image_url;
  }

  await ensureBucket(supabase);
  const png = await renderGarminClipboardPng(workout);
  const path = CLIPBOARD_PATH(chat.activity_id);

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, png, { contentType: 'image/png', upsert: true });
  if (upErr) throw upErr;

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = `${urlData.publicUrl}?v=${CLIPBOARD_VERSION}`;

  const { error } = await supabase
    .from('run_chats')
    .update({ clipboard_image_url: url })
    .eq('id', chat.id);
  if (error) {
    console.warn('clipboard_image_url update skipped:', error.message);
  }

  return url;
}

function imageAttachment(imageUrl: string, title: string) {
  return {
    type: 'image' as const,
    image_url: imageUrl,
    asset_url: imageUrl,
    thumb_url: imageUrl,
    title,
  };
}

async function ensurePlanSeedMessage(
  channel: StreamChannel,
  plannedText: string,
  plannedWorkout: PlannedWorkout,
  imageUrl: string,
) {
  const { messages } = await channel.query({ messages: { limit: 40 } });
  const seed = messages.find(
    (m) => m.user?.id === AI_USER_ID && (m.text || '').includes('תוכנית האימון'),
  );
  const text = `📋 תוכנית האימון להיום:\n${plannedText}`;
  const attachments = [imageAttachment(imageUrl, plannedWorkout.title || 'תוכנית אימון')];

  if (!seed) {
    await channel.sendMessage({
      text,
      user_id: AI_USER_ID,
      attachments,
    } as Record<string, unknown>);
    return;
  }

  const hasCurrent = (seed.attachments || []).some(
    (a: { type?: string; image_url?: string; asset_url?: string }) =>
      a.type === 'image' &&
      `${a.image_url || ''}${a.asset_url || ''}`.includes(imageUrl),
  );
  if (hasCurrent && seed.text === text) return;

  await channel.getClient().updateMessage(
    { id: seed.id!, text, attachments },
    AI_USER_ID,
  );
}

async function ensureActualsSeedMessage(
  supabase: SupabaseClient,
  channel: StreamChannel,
  chat: RunChatRow,
) {
  const { data: activity } = await supabase
    .from('athlete_activities')
    .select(
      'id, activity_name, start_time, distance, duration, moving_duration, average_pace, average_hr, max_hr, elevation_gain, avg_cadence, strava_activity_id, laps, strava_gpx_url, gps_points',
    )
    .eq('id', chat.activity_id)
    .maybeSingle();

  if (!activity?.strava_activity_id) return;

  const { messages } = await channel.query({ messages: { limit: 40 } });
  const existing = messages.find(
    (m) => m.user?.id === AI_USER_ID && (m.text || '').includes('מה רצנו בפועל'),
  );
  if (existing) {
    const existingAttachments = (existing.attachments || []) as unknown as Array<
      Record<string, unknown>
    >;
    const current = existingAttachments.find(
      (attachment) =>
        attachment.type === 'strava_run' &&
        attachment.version === RUN_ATTACHMENT_VERSION &&
        (!activity.strava_gpx_url || attachment.gpx_url === activity.strava_gpx_url) &&
        (!(activity.laps || []).length ||
          String(attachment.laps_image_url || '').includes(`laps-${LAPS_CLIPBOARD_VERSION}`)),
    );
    if (current) return;
  }

  const laps = (activity.laps || []) as StravaLap[];
  const lapsUrl = await ensureLapsArtifact(supabase, {
    ...activity,
    laps,
  });

  const stravaUrl = getStravaActivityUrl(activity.strava_activity_id);
  const text = '🏃 מה רצנו בפועל';
  const attachment: StravaRunAttachment = {
    type: 'strava_run',
    version: RUN_ATTACHMENT_VERSION,
    run: activitySummary(activity as RunActivity),
    strava_url: stravaUrl,
    chat_url: `/dashboard/run-chat/${activity.id}`,
    gpx_url: activity.strava_gpx_url,
    laps_image_url: lapsUrl,
    route_points: downsampleRoute(activity.gps_points as RoutePoint[] | null),
  };
  const attachments = [attachment as unknown as Record<string, unknown>];

  if (!existing) {
    await channel.sendMessage({
      text,
      user_id: AI_USER_ID,
      attachments,
    } as Record<string, unknown>);
    return;
  }

  await channel.getClient().updateMessage(
    { id: existing.id!, text, attachments },
    AI_USER_ID,
  );
}

async function ensureHistoricalRunAttachments(
  supabase: SupabaseClient,
  channel: StreamChannel,
  currentActivityId: string,
) {
  const { messages } = await channel.query({ messages: { limit: 100 } });
  const activityIds = new Set<string>();

  for (const message of messages) {
    for (const attachment of (message.attachments || []) as unknown as Array<Record<string, unknown>>) {
      if (attachment.type !== 'strava_run') continue;
      const run = attachment.run as Record<string, unknown> | undefined;
      const id = typeof run?.id === 'string' ? run.id : null;
      const needsLaps =
        Number(run?.lap_count || 0) > 0 &&
        !String(attachment.laps_image_url || '').includes(`laps-${LAPS_CLIPBOARD_VERSION}`);
      if (id && id !== currentActivityId && (!attachment.route_points || needsLaps)) {
        activityIds.add(id);
      }
    }
  }
  if (!activityIds.size) return;

  const { data: rows } = await supabase
    .from('athlete_activities')
    .select('id, activity_name, distance, duration, laps, gps_points')
    .in('id', [...activityIds]);
  const rowsById = new Map((rows || []).map((row) => [row.id, row]));
  const lapsUrls = new Map<string, string | null>();

  for (const [id, row] of rowsById) {
    try {
      lapsUrls.set(id, await ensureLapsArtifact(supabase, {
        ...row,
        laps: (row.laps || []) as StravaLap[],
      }));
    } catch (error) {
      console.warn('Could not backfill historical laps artifact', id, error);
      lapsUrls.set(id, null);
    }
  }

  for (const message of messages) {
    let changed = false;
    const attachments = ((message.attachments || []) as unknown as Array<Record<string, unknown>>)
      .map((attachment) => {
        if (attachment.type !== 'strava_run') return attachment;
        const run = attachment.run as Record<string, unknown> | undefined;
        const id = typeof run?.id === 'string' ? run.id : null;
        const row = id ? rowsById.get(id) : null;
        if (!id || !row) return attachment;

        const routePoints = attachment.route_points ||
          downsampleRoute(row.gps_points as RoutePoint[] | null, 16);
        const hasCurrentLapsArtifact = String(attachment.laps_image_url || '')
          .includes(`laps-${LAPS_CLIPBOARD_VERSION}`);
        const lapsImageUrl = hasCurrentLapsArtifact
          ? attachment.laps_image_url
          : lapsUrls.get(id) || null;
        if (routePoints === attachment.route_points && lapsImageUrl === attachment.laps_image_url) {
          return attachment;
        }
        changed = true;
        return {
          ...attachment,
          route_points: routePoints,
          laps_image_url: lapsImageUrl,
        };
      });

    if (changed && message.id) {
      try {
        await channel.getClient().updateMessage(
          { id: message.id, text: message.text || '', attachments },
          AI_USER_ID,
        );
      } catch (error) {
        console.warn('Could not backfill historical run attachments', message.id, error);
      }
    }
  }
}

/**
 * Ensure plan + actuals seed messages exist.
 * Safe to call on every open — generation/upload only happens once per version.
 */
export async function ensureChatSeeded(opts: {
  supabase: SupabaseClient;
  channel: StreamChannel;
  chat: RunChatRow;
  weeklyPlanText: string | null;
  structuredWorkout?: PlannedWorkout | null;
  publishedImageUrl?: string | null;
}): Promise<RunChatRow> {
  const { supabase, channel, weeklyPlanText, structuredWorkout, publishedImageUrl } = opts;
  let chat = opts.chat;

  const { plannedText, plannedWorkout } = resolvePlan(
    chat.activity_id,
    weeklyPlanText,
    structuredWorkout,
  );

  const needsPlan =
    !chat.planned_text ||
    !chat.planned_workout ||
    chat.activity_id === TEST_ACTIVITY_ID ||
    (Boolean(structuredWorkout) &&
      JSON.stringify(chat.planned_workout) !== JSON.stringify(plannedWorkout));

  if (needsPlan) {
    const { data: updated, error } = await supabase
      .from('run_chats')
      .update({
        planned_text: plannedText,
        planned_workout: plannedWorkout,
      })
      .eq('id', chat.id)
      .select('*')
      .single();
    if (error) throw error;
    chat = updated as RunChatRow;
  }

  const workout = (chat.planned_workout as PlannedWorkout) || plannedWorkout;
  const imageUrl = await ensureClipboardImage(
    supabase,
    chat,
    workout,
    publishedImageUrl,
  );
  chat = { ...chat, clipboard_image_url: imageUrl };

  await ensurePlanSeedMessage(channel, plannedText, workout, imageUrl);
  await ensureActualsSeedMessage(supabase, channel, chat);
  await ensureHistoricalRunAttachments(supabase, channel, chat.activity_id);

  return chat;
}
