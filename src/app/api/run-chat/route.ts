/**
 * POST /api/run-chat
 * Body: { activityId: string }
 *
 * Find-or-create a run_chats row + Stream channel for this activity.
 * On first open (and backfill): seed planned workout + Garmin clipboard PNG
 * on the AI Coach's first Stream message.
 */
import { after, NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import {
  getStreamServerClient,
  CHANNEL_TYPE,
  channelId,
  ensureAiUser,
  resolveCoachStreamUser,
  upsertStreamUsersFromAthletes,
  AI_USER_ID,
  humanCoachAvatarUrl,
} from '@/lib/stream/server';
import { canAccessChat } from '@/lib/run-chat/access';
import { isUnresolvedPlan } from '@/lib/run-chat/activity-workout';
import type { PlannedWorkout } from '@/lib/run-chat/mock-workout';
import { ensureChatSeeded } from '@/lib/run-chat/seed-chat';
import { ensureMatchedWorkout } from '@/lib/plans/matched-workout';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const maintainedChats = new Set<string>();

/**
 * DELETE /api/run-chat?activityId=…
 * Dev-only: wipe the run_chats row + clear stored clipboard so the next open
 * regenerates plan text, Garmin image, and Stream attachments.
 */
export async function DELETE(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);

  const activityId = new URL(request.url).searchParams.get('activityId');
  if (!activityId) return NextResponse.json({ error: 'activityId required' }, { status: 400 });

  const supabase = createServerClient();
  const [{ data: activity }, { data: chat }] = await Promise.all([
    supabase
      .from('athlete_activities')
      .select('id, athlete_id')
      .eq('id', activityId)
      .maybeSingle(),
    supabase
      .from('run_chats')
      .select('athlete_id, coach_id')
      .eq('activity_id', activityId)
      .maybeSingle(),
  ]);
  if (!activity) return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  if (!canAccessChat(auth.user, chat || { athlete_id: activity.athlete_id, coach_id: null })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const stream = getStreamServerClient();
    const ch = stream.channel(CHANNEL_TYPE, channelId(activityId));
    await ch.delete();
  } catch (err: unknown) {
    const status =
      (err as { status?: number; response?: { status?: number } })?.status ||
      (err as { response?: { status?: number } })?.response?.status;
    if (status !== 404) {
      console.error('Stream channel reset failed:', err);
      return NextResponse.json({ error: 'Could not clear Stream chat' }, { status: 502 });
    }
  }

  const { error: deleteError } = await supabase
    .from('run_chats')
    .delete()
    .eq('activity_id', activityId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { data: artifacts } = await supabase.storage.from('run-chat').list(activityId);
  if (artifacts?.length) {
    await supabase.storage
      .from('run-chat')
      .remove(artifacts.map((artifact) => `${activityId}/${artifact.name}`));
  }

  return NextResponse.json({ ok: true, activityId });
}

export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const { user } = auth;

  try {
    const { activityId } = (await request.json()) as { activityId?: string };
    if (!activityId) return NextResponse.json({ error: 'activityId required' }, { status: 400 });

    const supabase = createServerClient();

    const { data: activity, error: actErr } = await supabase
      .from('athlete_activities')
      .select('id, athlete_id, start_time, activity_name, distance, laps')
      .eq('id', activityId)
      .maybeSingle();

    if (actErr || !activity) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    const activityPayload = {
      id: activity.id,
      athlete_id: activity.athlete_id,
      start_time: activity.start_time,
      activity_name: activity.activity_name,
      distance: activity.distance,
      laps: activity.laps,
    };

    const mockChat = { athlete_id: activity.athlete_id, coach_id: null };
    if (!canAccessChat(user, mockChat)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: existingChat } = await supabase
      .from('run_chats')
      .select('*')
      .eq('activity_id', activityId)
      .maybeSingle();

    const isExistingMember =
      existingChat &&
      user.athleteId &&
      (user.athleteId === existingChat.athlete_id || user.athleteId === existingChat.coach_id);

    const storedPlanUnresolved = isUnresolvedPlan(
      existingChat?.planned_workout as PlannedWorkout | null,
      existingChat?.planned_text,
    );

    if (existingChat?.stream_channel_id && isExistingMember && !storedPlanUnresolved) {
      const fastStream = getStreamServerClient();
      const fastChannel = fastStream.channel(CHANNEL_TYPE, channelId(activityId));
      let openerMembershipReady = false;
      try {
        // The client calls channel.watch() immediately after this response. Keep
        // this single repair synchronous; all slower profile/artifact work stays
        // in after() so normal refreshes remain fast.
        await fastChannel.addMembers([user.athleteId!]);
        openerMembershipReady = true;
      } catch {
        // A missing/stale Stream channel needs the full create/repair path below.
      }

      if (openerMembershipReady) {
        const { data: coachAthlete } = existingChat.coach_id
          ? await supabase
              .from('athletes')
              .select('id, name, email')
              .eq('id', existingChat.coach_id)
              .maybeSingle()
          : { data: null };

        // Backfills and artifact-version checks are useful, but they should not
        // hold every refresh behind several sequential Stream API round trips.
        // Run them once per server process after the response is sent.
        // `laps === null` means Strava enrichment has not happened yet; keep
        // maintaining on every open until the seeder fetches laps on demand.
        if (!maintainedChats.has(existingChat.id) || activity.laps == null) {
          maintainedChats.add(existingChat.id);
          after(async () => {
            try {
              await ensureAiUser(fastStream);
              const resolvedCoach = await resolveCoachStreamUser(
                fastStream,
                supabase,
                activity.athlete_id,
              );
              const repairedMembers = [
                activity.athlete_id,
                AI_USER_ID,
                user.athleteId!,
                resolvedCoach?.streamId,
              ].filter(Boolean) as string[];
              await upsertStreamUsersFromAthletes(
                fastStream,
                supabase,
                [activity.athlete_id, existingChat.coach_id, user.athleteId].filter(
                  Boolean,
                ) as string[],
              );
              await fastChannel.addMembers([...new Set(repairedMembers)]);

              const matched = await ensureMatchedWorkout(
                supabase,
                activityId,
                activity.athlete_id,
              );
              await ensureChatSeeded({
                supabase,
                channel: fastChannel,
                chat: existingChat,
                weeklyPlanText: matched?.plannedText || null,
                structuredWorkout: matched?.plannedWorkout || null,
                publishedImageUrl: matched?.clipboardImageUrl || null,
              });
            } catch (maintenanceError) {
              maintainedChats.delete(existingChat.id);
              console.warn('Run-chat background maintenance failed:', maintenanceError);
            }
          });
        }

        return NextResponse.json({
          chat: existingChat,
          activity: activityPayload,
          coach: coachAthlete
            ? {
                id: coachAthlete.id,
                name: coachAthlete.name || coachAthlete.email || 'Coach',
                image: humanCoachAvatarUrl(),
              }
            : null,
          planMatch: null,
        });
      }
    }
    
    const stream = getStreamServerClient();
    await ensureAiUser(stream);
    const resolvedCoach = await resolveCoachStreamUser(
      stream,
      supabase,
      activity.athlete_id,
    );
    const coachAthleteId =
      resolvedCoach?.athleteId || (user.isStaff ? user.athleteId : null);

    const runnerId = activity.athlete_id;
    const memberSet = new Set<string>([runnerId, AI_USER_ID]);
    if (resolvedCoach) memberSet.add(resolvedCoach.streamId);
    // Any staff opener must be a channel member so they can continue chats.
    // Stream user id matches token route: athletes.id, else email.
    const openerStreamId = user.athleteId ?? (user.isStaff ? user.email : null);
    if (openerStreamId) memberSet.add(openerStreamId);
    const members = [...memberSet];

    // Sync profile photos onto Stream users so message avatars resolve.
    await upsertStreamUsersFromAthletes(
      stream,
      supabase,
      [runnerId, coachAthleteId, user.athleteId].filter(Boolean) as string[],
    );

    const chId = channelId(activityId);
    const channel = stream.channel(CHANNEL_TYPE, chId, {
      members,
      created_by_id: coachAthleteId ?? openerStreamId ?? runnerId,
      name: activity.activity_name || 'Run chat',
    } as Record<string, unknown>);

    // create() is idempotent enough for our purposes; watch/query works either way.
    try {
      await channel.create();
    } catch {
      // Channel may already exist — still ensure the opener is a member.
    }

    try {
      await channel.addMembers(members);
    } catch {
      // Existing members are harmless; channel.watch below will surface real failures.
    }

    let chat = existingChat;

    const matched = await ensureMatchedWorkout(
      supabase,
      activityId,
      activity.athlete_id,
    );

    if (!chat) {
      const { data: created, error: insertErr } = await supabase
        .from('run_chats')
        .insert({
          activity_id: activityId,
          athlete_id: activity.athlete_id,
          coach_id: coachAthleteId,
          stream_channel_id: `${CHANNEL_TYPE}:${chId}`,
          planned_text: matched?.plannedText || null,
          planned_workout: matched?.plannedWorkout || null,
        })
        .select('*')
        .single();

      if (insertErr) throw insertErr;
      chat = created;
    } else if (coachAthleteId && chat.coach_id !== coachAthleteId) {
      const { data: updated } = await supabase
        .from('run_chats')
        .update({ coach_id: coachAthleteId })
        .eq('id', chat.id)
        .select('*')
        .single();
      if (updated) chat = updated;
    }

    const seeded = await ensureChatSeeded({
      supabase,
      channel,
      chat,
      weeklyPlanText: matched?.plannedText || null,
      structuredWorkout: matched?.plannedWorkout || null,
      publishedImageUrl: matched?.clipboardImageUrl || null,
    });

    return NextResponse.json({
      chat: seeded,
      activity: activityPayload,
      coach: resolvedCoach
        ? {
            id: resolvedCoach.streamId,
            name: resolvedCoach.name,
            image: resolvedCoach.image,
          }
        : null,
      planMatch: matched
        ? {
            weeklyPlanId: matched.weeklyPlanId,
            workoutKey: matched.workoutKey,
            groupNumber: matched.groupNumber,
            matchMethod: matched.matchMethod,
            score: matched.score,
          }
        : null,
    });
  } catch (err: unknown) {
    console.error('POST /api/run-chat error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
