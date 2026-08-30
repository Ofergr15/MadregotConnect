/**
 * POST /api/run-chat/[chatId]/plan
 * Body: { plannedText: string }
 *
 * Coach edits the planned workout text; triggers a re-parse into planned_workout JSON.
 */
import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { createServerClient } from '@/lib/supabase/server';
import { canAccessChat } from '@/lib/run-chat/access';
import {
  CHANNEL_TYPE,
  channelId,
  getStreamServerClient,
} from '@/lib/stream/server';
import { applyEditedChatPlan, type RunChatRow } from '@/lib/run-chat/seed-chat';
import { parsePromptWorkout } from '@/lib/run-chat/prompt-workout';

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
    const { plannedText, messageId } = (await request.json()) as {
      plannedText?: string;
      messageId?: string;
    };
    if (!plannedText?.trim()) {
      return NextResponse.json({ error: 'plannedText required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: chat } = await supabase
      .from('run_chats')
      .select('*')
      .eq('id', chatId)
      .maybeSingle();

    if (!chat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!user.isStaff || !canAccessChat(user, chat)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const plannedWorkout = await parsePromptWorkout(plannedText.trim());
    const stream = getStreamServerClient();
    const channel = stream.channel(CHANNEL_TYPE, channelId(chat.activity_id));
    const updated = await applyEditedChatPlan({
      supabase,
      channel,
      chat: chat as RunChatRow,
      plannedText: plannedText.trim(),
      plannedWorkout,
      messageId,
    });
    return NextResponse.json({ chat: updated });
  } catch (err: unknown) {
    console.error('POST /api/run-chat/[chatId]/plan error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
