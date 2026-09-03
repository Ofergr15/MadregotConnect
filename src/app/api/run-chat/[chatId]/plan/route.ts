/**
 * POST /api/run-chat/[chatId]/plan
 * Body: { plannedText?: string; messageId?: string; extract?: 'preview' | 'apply' }
 *
 * Coach (or the chat's own runner) edits the planned workout text; triggers a
 * re-parse into planned_workout JSON.
 *
 * `extract` reverse-engineers the plan from the activity's laps instead:
 *   - 'preview' returns the suggested text + workout without saving
 *   - 'apply' saves it and rebuilds the plan card
 */
import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import { canAccessChat, canEditChatPlan } from '@/lib/run-chat/access';
import {
  CHANNEL_TYPE,
  channelId,
  getStreamServerClient,
} from '@/lib/stream/server';
import { applyEditedChatPlan, type RunChatRow } from '@/lib/run-chat/seed-chat';
import { parsePromptWorkout } from '@/lib/run-chat/prompt-workout';
import { workoutFromLaps } from '@/lib/run-chat/workout-from-laps';
import type { PlannedWorkout } from '@/lib/run-chat/mock-workout';
import type { StravaLap } from '@/lib/strava/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const { user } = auth;
  const { chatId } = await params;

  try {
    const { plannedText, messageId, extract } = (await request.json()) as {
      plannedText?: string;
      messageId?: string;
      extract?: 'preview' | 'apply';
    };
    if (!extract && !plannedText?.trim()) {
      return NextResponse.json({ error: 'plannedText required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: chat } = await supabase
      .from('run_chats')
      .select('*')
      .eq('id', chatId)
      .maybeSingle();

    if (!chat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessChat(user, chat) || !canEditChatPlan(user, chat)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let text: string;
    let plannedWorkout: PlannedWorkout;
    if (extract) {
      const { data: activity } = await supabase
        .from('athlete_activities')
        .select('id, activity_name, distance, duration, moving_duration, laps')
        .eq('id', chat.activity_id)
        .maybeSingle();
      const extracted = activity
        ? workoutFromLaps(activity, activity.laps as StravaLap[] | null)
        : null;
      if (!extracted) {
        return NextResponse.json({ error: 'no_laps' }, { status: 422 });
      }
      if (extract === 'preview') {
        return NextResponse.json({ plannedText: extracted.prompt, workout: extracted });
      }
      text = extracted.prompt;
      plannedWorkout = extracted;
    } else {
      text = plannedText!.trim();
      plannedWorkout = await parsePromptWorkout(text);
    }

    const stream = getStreamServerClient();
    const channel = stream.channel(CHANNEL_TYPE, channelId(chat.activity_id));
    const updated = await applyEditedChatPlan({
      supabase,
      channel,
      chat: chat as RunChatRow,
      plannedText: text,
      plannedWorkout,
      messageId,
    });
    return NextResponse.json({ chat: updated });
  } catch (err: unknown) {
    console.error('POST /api/run-chat/[chatId]/plan error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
