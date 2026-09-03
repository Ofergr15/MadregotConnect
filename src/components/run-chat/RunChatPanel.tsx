'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import {
  Chat,
  Channel,
  MessageComposer,
  MessageList,
  Thread,
  Window,
  WithComponents,
  useChannelStateContext,
} from 'stream-chat-react';
import type { Channel as StreamChannel, StreamChat } from 'stream-chat';
import {
  buildI18n,
  formatMessageTime,
  type StreamTokenData,
  useConnectedStreamClient,
} from '@/lib/stream/client';
import { messageMentionsAi } from '@/lib/run-chat/ai-mention';
import { claimAiTurn, releaseAiTurn } from '@/lib/run-chat/ai-lock';
import { orderSeedMessagesFirst } from '@/lib/run-chat/seed-order';
import { AI_USER_ID } from '@/lib/stream/constants';
import { AiMentionButton } from './AiMentionButton';
import { CoachMentionButton, type MentionableCoach } from './CoachMentionButton';
import { PlanEditPromptProvider, RunChatMessageActions } from './PlanEditPrompt';
import { RunChatSessionProvider } from './RunChatSession';
import { RunChatAttachment } from './RunChatAttachment';
import { RunChatAvatar } from './RunChatAvatar';
import { RunChatContentEditable } from './RunChatContentEditable';
import { RunChatMessageUI } from './RunChatMessage';

export interface RunChat {
  id: string;
  activity_id: string;
  athlete_id: string;
  coach_id: string | null;
  stream_channel_id: string | null;
  planned_text: string | null;
  planned_workout: unknown | null;
  clipboard_image_url?: string | null;
}

export interface RunChatActivity {
  id: string;
  activity_name: string | null;
  start_time: string;
  distance: number | null;
  laps: unknown | null;
}

const i18n = buildI18n();
const MESSAGE_ACTIONS = [
  'react',
  'reply',
  'quote',
  'edit',
  'delete',
  'copyMessageText',
  'pin',
];

/** Program card first, actual-run card second, then the conversation. */
function SeededMessageList() {
  const { messages } = useChannelStateContext();
  const ordered = useMemo(() => orderSeedMessagesFirst(messages || []), [messages]);
  return (
    <MessageList
      messages={ordered}
      messageActions={MESSAGE_ACTIONS}
      formatDate={formatMessageTime}
      showAvatar={false}
      noGroupByUser
    />
  );
}

interface ChatPanelProps {
  channel: StreamChannel;
  chat: RunChat;
  activity: RunChatActivity;
  client: StreamChat;
  supabaseToken: string;
  coach: MentionableCoach | null;
  onBack?: () => void;
  viewerLabel?: string;
  enableAiTrigger?: boolean;
  canEditPlan?: boolean;
}

function ChatPanel({
  channel,
  chat,
  activity,
  client,
  supabaseToken,
  coach,
  onBack,
  viewerLabel,
  enableAiTrigger = true,
  canEditPlan = false,
}: ChatPanelProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const matchedWorkout = (chat.planned_workout as {
    structured?: { name?: string; partIndex?: number; partCount?: number };
  } | null)?.structured;

  const triggerAi = useCallback(
    async (messageId?: string) => {
      if (!claimAiTurn(chat.id, messageId)) return;
      setAiLoading(true);
      try {
        const response = await fetch(`/api/run-chat/${chat.id}/ai`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${supabaseToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messageId }),
        });
        if (!response.ok) {
          console.error('AI coach request failed', messageId, await response.text());
        }
      } catch (error) {
        console.error('AI coach request error', error);
      } finally {
        releaseAiTurn(chat.id);
        setAiLoading(false);
      }
    },
    [chat.id, supabaseToken],
  );

  useEffect(() => {
    if (!enableAiTrigger) return;
    const handler = channel.on('message.new', (event) => {
      const message = event.message;
      if (!message || message.user?.id === AI_USER_ID) return;
      if (!messageMentionsAi(message)) return;
      // Stream often emits the local echo and the server confirm as two
      // message.new events. The lock is per chat, so the second is a no-op.
      void triggerAi(message.id);
    });
    return () => handler.unsubscribe();
  }, [channel, enableAiTrigger, triggerAi]);

  return (
    <div className="run-chat-panel flex h-full flex-col bg-slate-900 text-white" dir="rtl" lang="he">
      <div className="run-chat-header flex flex-none items-center gap-3 border-b border-slate-700/60 bg-slate-900 px-4 py-3">
        {onBack && (
          <button
            onClick={onBack}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            aria-label="חזור"
          >
            <ArrowRight className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">
              {activity.activity_name || 'ריצה'}
            </p>
            <span className="inline-flex shrink-0 items-center rounded-full border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-300">
              Beta
            </span>
            {viewerLabel && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300"
                data-testid="demo-viewer-label"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {viewerLabel}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            {new Date(activity.start_time).toLocaleDateString('he-IL', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              timeZone: 'UTC',
            })}
            {activity.distance ? ` · ${(activity.distance / 1000).toFixed(1)}ק"מ` : ''}
            {matchedWorkout?.name
              ? ` · תוכנית: ${matchedWorkout.name}${
                  matchedWorkout.partCount && matchedWorkout.partCount > 1
                    ? ` (${matchedWorkout.partIndex}/${matchedWorkout.partCount})`
                    : ''
                }`
              : ''}
          </p>
        </div>
        {aiLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary-400" />}
      </div>

      <div className="run-chat-shell flex min-h-0 flex-1 flex-col">
        <RunChatSessionProvider chatId={chat.id} supabaseToken={supabaseToken}>
          <PlanEditPromptProvider
            chatId={chat.id}
            supabaseToken={supabaseToken}
            canEditPlan={canEditPlan}
          >
            <Chat client={client} i18nInstance={i18n} theme="str-chat__theme-dark">
              <WithComponents
                overrides={{
                  MessageUI: RunChatMessageUI,
                  MessageActions: RunChatMessageActions,
                  Attachment: RunChatAttachment,
                  Avatar: RunChatAvatar,
                  TextareaComposer: RunChatContentEditable,
                }}
              >
                <Channel channel={channel}>
                  <Window>
                    <SeededMessageList />
                    <div className="run-chat-composer-shell flex justify-center px-3 py-2">
                      <div className="run-chat-composer-row flex w-full items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <MessageComposer />
                        </div>
                        <div className="run-chat-mention-rail flex shrink-0 items-center gap-2">
                          {coach && <CoachMentionButton channel={channel} coach={coach} />}
                          <AiMentionButton channel={channel} />
                        </div>
                      </div>
                    </div>
                  </Window>
                  <Thread
                    messageActions={MESSAGE_ACTIONS}
                    additionalMessageListProps={{
                      formatDate: formatMessageTime,
                      showAvatar: false,
                      noGroupByUser: true,
                    }}
                  />
                </Channel>
              </WithComponents>
            </Chat>
          </PlanEditPromptProvider>
        </RunChatSessionProvider>
      </div>
    </div>
  );
}

interface ConnectedRunChatProps {
  tokenData: StreamTokenData;
  chat: RunChat;
  activity: RunChatActivity;
  supabaseToken: string;
  coach: MentionableCoach | null;
  onBack?: () => void;
  viewerLabel?: string;
  enableAiTrigger?: boolean;
}

export function ConnectedRunChat({
  tokenData,
  chat,
  activity,
  supabaseToken,
  coach,
  onBack,
  viewerLabel,
  enableAiTrigger,
}: ConnectedRunChatProps) {
  const client = useConnectedStreamClient(tokenData);
  const [channel, setChannel] = useState<StreamChannel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const nextChannel = client.channel('messaging', `run-${chat.activity_id}`);
    let cancelled = false;
    nextChannel
      .watch()
      .then(() => {
        if (!cancelled) setChannel(nextChannel);
      })
      .catch((watchError) => {
        if (!cancelled) setError(String(watchError));
      });
    return () => {
      cancelled = true;
      nextChannel.stopWatching().catch(() => {});
    };
  }, [client, chat.activity_id]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-red-400">{error}</p>
        {onBack && (
          <button onClick={onBack} className="text-sm text-primary-400 underline">
            חזור
          </button>
        )}
      </div>
    );
  }

  if (!client || !channel) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <ChatPanel
      channel={channel}
      chat={chat}
      activity={activity}
      client={client}
      supabaseToken={supabaseToken}
      coach={coach}
      onBack={onBack}
      viewerLabel={viewerLabel}
      enableAiTrigger={enableAiTrigger}
      canEditPlan={Boolean(tokenData.isStaff) || tokenData.userId === chat.athlete_id}
    />
  );
}
