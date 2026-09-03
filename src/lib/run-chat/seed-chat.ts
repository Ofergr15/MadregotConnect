/**
 * First-open seeding for a run chat:
 *  - planned_text / planned_workout + Garmin-style plan clipboard
 *  - actuals: Strava link + laps PNG + GPX file (when Strava activity exists)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Channel as StreamChannel } from 'stream-chat';
import { createHash } from 'crypto';
import { CLIPBOARD_VERSION, renderGarminClipboardPng } from './garmin-clipboard';
import { LAPS_CLIPBOARD_VERSION } from './strava-laps-clipboard';
import { enrichActivityRowFromStrava } from '@/lib/strava/enrich';
import { ensureLapsArtifact } from './run-artifacts';
import {
  isUnresolvedPlan,
  UNMATCHED_PLAN_TEXT,
  UNMATCHED_PLAN_TITLE,
} from './activity-workout';
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
  type StravaRunAttachment,
} from './attachments';

const BUCKET = 'run-chat';
const SEED_LOCK_KEY = '__madregotChatSeedLock';

function seedInflight(): Map<string, Promise<RunChatRow>> {
  const globalWithLock = globalThis as typeof globalThis & {
    [SEED_LOCK_KEY]?: Map<string, Promise<RunChatRow>>;
  };
  if (!globalWithLock[SEED_LOCK_KEY]) {
    globalWithLock[SEED_LOCK_KEY] = new Map();
  }
  return globalWithLock[SEED_LOCK_KEY];
}

function clipboardRevision(workout: PlannedWorkout): string {
  return createHash('sha256').update(JSON.stringify(workout)).digest('hex').slice(0, 12);
}

const CLIPBOARD_PATH = (activityId: string, workout: PlannedWorkout) =>
  `${activityId}/clipboard-${CLIPBOARD_VERSION}-${clipboardRevision(workout)}.png`;

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
      plannedText: UNMATCHED_PLAN_TEXT,
      plannedWorkout: {
        title: UNMATCHED_PLAN_TITLE,
        prompt: UNMATCHED_PLAN_TEXT,
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
  const path = CLIPBOARD_PATH(chat.activity_id, workout);
  if (chat.clipboard_image_url?.includes(path)) {
    return chat.clipboard_image_url;
  }

  await ensureBucket(supabase);
  const png = await renderGarminClipboardPng(workout);

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, png, { contentType: 'image/png', upsert: true });
  if (upErr) throw upErr;

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = `${urlData.publicUrl}?v=${clipboardRevision(workout)}`;

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

function planAttachments(
  plannedText: string,
  plannedWorkout: PlannedWorkout,
  imageUrl: string,
): Array<Record<string, unknown>> {
  return [
    {
      type: 'workout',
      title: plannedWorkout.title || 'תוכנית אימון',
      text: plannedText,
      workout: plannedWorkout,
    },
    imageAttachment(imageUrl, plannedWorkout.title || 'תוכנית אימון'),
  ];
}

async function ensurePlanSeedMessage(
  channel: StreamChannel,
  plannedText: string,
  plannedWorkout: PlannedWorkout,
  imageUrl: string,
  preferredMessageId?: string,
) {
  const { messages } = await channel.query({ messages: { limit: 40 } });
  const seed = messages.find((message) => {
    if (message.user?.id !== AI_USER_ID) return false;
    if (preferredMessageId && message.id === preferredMessageId) return true;
    const custom = message as unknown as Record<string, unknown>;
    if (custom.run_chat_seed === 'plan') return true;
    return (message.text || '').startsWith('📋 תוכנית האימון להיום');
  });
  const text = `📋 תוכנית האימון להיום:\n${plannedText}`;
  const attachments = planAttachments(plannedText, plannedWorkout, imageUrl);

  const publishPlan = async (nextAttachments: Array<Record<string, unknown>>) => {
    if (!seed) {
      await channel.sendMessage({
        text,
        user_id: AI_USER_ID,
        attachments: nextAttachments,
        run_chat_seed: 'plan',
      } as Record<string, unknown>);
      return;
    }
    const client = channel.getClient();
    await client.updateMessage(
      {
        id: seed.id!,
        text,
        attachments: nextAttachments,
        run_chat_seed: 'plan',
      } as unknown as Parameters<typeof client.updateMessage>[0],
      AI_USER_ID,
    );
  };

  if (!seed) {
    try {
      await publishPlan(attachments);
    } catch (error) {
      console.warn('ensurePlanSeedMessage: retrying without structured workout', error);
      await publishPlan([imageAttachment(imageUrl, plannedWorkout.title || 'תוכנית אימון')]);
    }
    return;
  }

  const attachmentsOnSeed = seed.attachments || [];
  const hasCurrentImage = attachmentsOnSeed.some(
    (a: { type?: string; image_url?: string; asset_url?: string }) =>
      a.type === 'image' &&
      `${a.image_url || ''}${a.asset_url || ''}`.includes(imageUrl),
  );
  const hasWorkout = attachmentsOnSeed.some(
    (a: { type?: string }) => a.type === 'workout',
  );
  if (hasCurrentImage && hasWorkout && seed.text === text) return;

  try {
    await publishPlan(attachments);
  } catch (error) {
    console.warn('ensurePlanSeedMessage: retrying without structured workout', error);
    await publishPlan([imageAttachment(imageUrl, plannedWorkout.title || 'תוכנית אימון')]);
  }
}

export async function applyEditedChatPlan(opts: {
  supabase: SupabaseClient;
  channel: StreamChannel;
  chat: RunChatRow;
  plannedText: string;
  plannedWorkout: PlannedWorkout;
  messageId?: string;
}): Promise<RunChatRow> {
  const { supabase, channel, plannedText, messageId } = opts;
  // Keep a structured provenance (e.g. reverse-engineered from laps) when the
  // caller set one; plain prompt edits are marked as such.
  const plannedWorkout: PlannedWorkout = {
    ...opts.plannedWorkout,
    source: opts.plannedWorkout.source ?? 'prompt_edit',
  };
  const imageUrl = await ensureClipboardImage(supabase, opts.chat, plannedWorkout);
  let { data: updated, error } = await supabase
    .from('run_chats')
    .update({
      planned_text: plannedText,
      planned_workout: plannedWorkout,
      clipboard_image_url: imageUrl,
    })
    .eq('id', opts.chat.id)
    .select('*')
    .single();

  // Keep prompt editing functional while migration 050 is pending or the
  // PostgREST schema cache has not refreshed yet.
  if (
    error?.code === 'PGRST204' &&
    error.message?.includes('clipboard_image_url')
  ) {
    const fallback = await supabase
      .from('run_chats')
      .update({
        planned_text: plannedText,
        planned_workout: plannedWorkout,
      })
      .eq('id', opts.chat.id)
      .select('*')
      .single();
    updated = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;

  await ensurePlanSeedMessage(channel, plannedText, plannedWorkout, imageUrl, messageId);
  return updated as RunChatRow;
}

type SeedActivity = RunActivity & {
  strava_gpx_url?: string | null;
  gps_points?: unknown;
};

const ACTUALS_SELECTS = [
  'id, athlete_id, activity_name, start_time, distance, duration, moving_duration, average_pace, average_hr, max_hr, elevation_gain, avg_cadence, strava_activity_id, laps, strava_gpx_url, gps_points',
  'id, athlete_id, activity_name, start_time, distance, duration, average_pace, average_hr, elevation_gain, strava_activity_id, laps',
];

async function queryActivity(
  supabase: SupabaseClient,
  activityId: string,
): Promise<SeedActivity | null> {
  let lastError: { message?: string } | null = null;
  for (const columns of ACTUALS_SELECTS) {
    const { data, error } = await supabase
      .from('athlete_activities')
      .select(columns)
      .eq('id', activityId)
      .maybeSingle();
    if (data && typeof data === 'object' && 'id' in data) {
      return data as SeedActivity;
    }
    lastError = error;
  }
  if (lastError) {
    console.error('ensureActualsSeedMessage: activity query failed', lastError.message);
  }
  return null;
}

async function loadSeedActivity(
  supabase: SupabaseClient,
  activityId: string,
): Promise<SeedActivity | null> {
  const activity = await queryActivity(supabase, activityId);
  if (!activity) return null;

  // `laps === null` means the Strava sync never enriched this run (the hourly
  // sync only reaches the newest runs, and the dashboard-triggered sync only
  // fires from /dashboard). Fetch laps + route now so the card is not one
  // big block; enrichment stores `[]` when Strava has nothing, so this runs
  // at most once per activity.
  if (activity.laps == null && activity.strava_activity_id) {
    try {
      const enriched = await enrichActivityRowFromStrava(supabase, {
        id: activity.id,
        athlete_id: (activity as { athlete_id?: string | null }).athlete_id ?? null,
        strava_activity_id: activity.strava_activity_id,
        activity_name: activity.activity_name,
        start_time: activity.start_time,
      });
      if (enriched) return (await queryActivity(supabase, activityId)) ?? activity;
    } catch (error) {
      console.warn('loadSeedActivity: on-demand Strava enrichment failed', error);
    }
  }
  return activity;
}

function isActualsSeedMessage(message: {
  user?: { id?: string } | null;
  user_id?: string;
  text?: string | null;
  run_chat_seed?: unknown;
}) {
  const uid = message.user?.id || message.user_id;
  if (uid !== AI_USER_ID) return false;
  if (message.run_chat_seed === 'actuals') return true;
  return (message.text || '').includes('מה רצנו בפועל');
}

async function publishActualsMessage(
  channel: StreamChannel,
  existingId: string | undefined,
  text: string,
  attachments: Array<Record<string, unknown>>,
) {
  const send = async (nextAttachments: Array<Record<string, unknown>>) => {
    if (!existingId) {
      await channel.sendMessage({
        text,
        user_id: AI_USER_ID,
        attachments: nextAttachments,
        run_chat_seed: 'actuals',
      } as Record<string, unknown>);
      return;
    }
    const client = channel.getClient();
    await client.updateMessage(
      {
        id: existingId,
        text,
        attachments: nextAttachments,
        run_chat_seed: 'actuals',
      } as unknown as Parameters<typeof client.updateMessage>[0],
      AI_USER_ID,
    );
  };

  try {
    await send(attachments);
  } catch (error) {
    const slim = attachments
      .filter((attachment) => attachment.type === 'strava_run')
      .map((attachment) => {
        const copy = { ...attachment };
        delete copy.route_points;
        return copy;
      });
    if (!slim.length) throw error;
    console.warn('ensureActualsSeedMessage: retrying without extra attachments', error);
    await send(slim);
  }
}

async function ensureActualsSeedMessage(
  supabase: SupabaseClient,
  channel: StreamChannel,
  chat: RunChatRow,
) {
  const activity = await loadSeedActivity(supabase, chat.activity_id);
  if (!activity) return;

  const { messages } = await channel.query({ messages: { limit: 40 } });
  const existing = messages.find(isActualsSeedMessage);
  if (existing) {
    const existingAttachments = (existing.attachments || []) as unknown as Array<
      Record<string, unknown>
    >;
    const lapCount = Array.isArray(activity.laps) ? activity.laps.length : 0;
    const current = existingAttachments.find(
      (attachment) =>
        attachment.type === 'strava_run' &&
        attachment.version === RUN_ATTACHMENT_VERSION &&
        (!activity.strava_gpx_url || attachment.gpx_url === activity.strava_gpx_url) &&
        // Laps can land after the card was posted (Strava enrichment runs on
        // the next sync) — a stale lap count means the card must be rebuilt.
        Number((attachment.run as Record<string, unknown> | undefined)?.lap_count || 0) === lapCount &&
        (!lapCount ||
          String(attachment.laps_image_url || '').includes(`laps-${LAPS_CLIPBOARD_VERSION}`)),
    );
    const hasDuplicateImage = existingAttachments.some(
      (attachment) => attachment.type === 'image',
    );
    if (current && !hasDuplicateImage) return;
  }

  let lapsUrl: string | null = null;
  try {
    lapsUrl = await ensureLapsArtifact(supabase, {
      ...activity,
      laps: (activity.laps || []) as StravaLap[],
    });
  } catch (error) {
    console.warn('ensureActualsSeedMessage: laps image skipped', error);
  }

  const stravaUrl = activity.strava_activity_id
    ? getStravaActivityUrl(activity.strava_activity_id)
    : null;
  const text = '🏃 מה רצנו בפועל';
  const attachment: StravaRunAttachment = {
    type: 'strava_run',
    version: RUN_ATTACHMENT_VERSION,
    run: activitySummary(activity),
    strava_url: stravaUrl,
    chat_url: `/dashboard/run-chat/${activity.id}`,
    gpx_url: activity.strava_gpx_url ?? null,
    laps_image_url: lapsUrl,
  };
  // The run card renders the laps image itself; a separate image attachment
  // would show the same PNG twice.
  await publishActualsMessage(channel, existing?.id, text, [
    attachment as unknown as Record<string, unknown>,
  ]);
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
      if (id && id !== currentActivityId) activityIds.add(id);
    }
  }
  if (!activityIds.size) return;

  const { data: rows } = await supabase
    .from('athlete_activities')
    .select('id, activity_name, distance, duration, average_pace, average_hr, laps, gps_points')
    .in('id', [...activityIds]);
  const rowsById = new Map((rows || []).map((row) => [row.id, row]));
  const rowLapCount = (row: { laps: unknown }) => (Array.isArray(row.laps) ? row.laps.length : 0);

  const needsLapsArtifact = (attachment: Record<string, unknown>, row: { laps: unknown }) => {
    const run = attachment.run as Record<string, unknown> | undefined;
    const storedCount = Number(run?.lap_count || 0);
    const actualCount = rowLapCount(row);
    if (storedCount !== actualCount) return true;
    return actualCount > 0 &&
      !String(attachment.laps_image_url || '').includes(`laps-${LAPS_CLIPBOARD_VERSION}`);
  };

  const lapsUrls = new Map<string, string | null>();
  const lapsArtifactFor = async (id: string, row: NonNullable<ReturnType<typeof rowsById.get>>) => {
    if (lapsUrls.has(id)) return lapsUrls.get(id) ?? null;
    let url: string | null = null;
    try {
      url = await ensureLapsArtifact(supabase, {
        ...row,
        laps: (row.laps || []) as StravaLap[],
      });
    } catch (error) {
      console.warn('Could not backfill historical laps artifact', id, error);
    }
    lapsUrls.set(id, url);
    return url;
  };

  for (const message of messages) {
    let changed = false;
    const attachments: Array<Record<string, unknown>> = [];
    for (const attachment of (message.attachments || []) as unknown as Array<Record<string, unknown>>) {
      if (attachment.type !== 'strava_run') {
        attachments.push(attachment);
        continue;
      }
      const run = attachment.run as Record<string, unknown> | undefined;
      const id = typeof run?.id === 'string' ? run.id : null;
      const row = id ? rowsById.get(id) : null;
      if (!id || !row) {
        attachments.push(attachment);
        continue;
      }

      const routePoints = attachment.route_points || downsampleRoute(row.gps_points, 16);
      const refreshLaps = needsLapsArtifact(attachment, row);
      const lapsImageUrl = refreshLaps ? await lapsArtifactFor(id, row) : attachment.laps_image_url;
      if (routePoints === attachment.route_points && !refreshLaps) {
        attachments.push(attachment);
        continue;
      }
      changed = true;
      attachments.push({
        ...attachment,
        route_points: routePoints,
        laps_image_url: lapsImageUrl,
        run: { ...(run || {}), lap_count: rowLapCount(row) },
      });
    }

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
async function seedChatUnlocked(opts: {
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
  const existingWorkout = chat.planned_workout as PlannedWorkout | null;
  const wasPromptEdited = existingWorkout?.source === 'prompt_edit';

  const needsPlan =
    !wasPromptEdited &&
    (isUnresolvedPlan(existingWorkout, chat.planned_text) ||
      !chat.planned_text ||
      !chat.planned_workout ||
      (Boolean(structuredWorkout) &&
        JSON.stringify(chat.planned_workout) !== JSON.stringify(plannedWorkout)));

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
    wasPromptEdited ? null : publishedImageUrl,
  );
  chat = { ...chat, clipboard_image_url: imageUrl };

  await ensurePlanSeedMessage(channel, chat.planned_text || plannedText, workout, imageUrl);
  try {
    await ensureActualsSeedMessage(supabase, channel, chat);
  } catch (error) {
    console.error('ensureActualsSeedMessage failed:', error);
  }
  try {
    await ensureHistoricalRunAttachments(supabase, channel, chat.activity_id);
  } catch (error) {
    console.warn('ensureHistoricalRunAttachments failed:', error);
  }

  return chat;
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
  const inflight = seedInflight();
  const existing = inflight.get(opts.chat.id);
  if (existing) return existing;

  const pending = seedChatUnlocked(opts).finally(() => {
    inflight.delete(opts.chat.id);
  });
  inflight.set(opts.chat.id, pending);
  return pending;
}
