'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import {
  useStreamToken,
  useConnectedStreamClient,
  buildI18n,
  formatMessageTime,
  type StreamTokenData,
} from '@/lib/stream/client';
import { AiMentionButton } from '@/components/run-chat/AiMentionButton';
import {
  CoachMentionButton,
  type MentionableCoach,
} from '@/components/run-chat/CoachMentionButton';
import { RunChatAttachment } from '@/components/run-chat/RunChatAttachment';
import { RunChatAvatar } from '@/components/run-chat/RunChatAvatar';
import { RunChatMessageUI } from '@/components/run-chat/RunChatMessage';
import { messageMentionsAi } from '@/lib/run-chat/ai-mention';
import { AI_USER_ID } from '@/lib/stream/constants';
import {
  Chat,
  Channel,
  MessageList,
  MessageComposer,
  Window,
  Thread,
  WithComponents,
} from 'stream-chat-react';
import 'stream-chat-react/dist/css/index.css';
import '../run-chat.css';
import type { Channel as StreamChannel, StreamChat } from 'stream-chat';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunChat {
  id: string;
  activity_id: string;
  athlete_id: string;
  coach_id: string | null;
  stream_channel_id: string | null;
  planned_text: string | null;
  planned_workout: unknown | null;
  clipboard_image_url?: string | null;
}

interface Activity {
  id: string;
  activity_name: string | null;
  start_time: string;
  distance: number | null;
  laps: unknown | null;
}

const i18n = buildI18n();

// Keep the action menu lean + fully Hebrew (via i18n). Thread needs <Thread /> mounted.
const MESSAGE_ACTIONS = [
  'react',
  'reply',
  'quote',
  'edit',
  'delete',
  'copyMessageText',
  'pin',
];

// ─── Inner chat panel ─────────────────────────────────────────────────────────

interface ChatPanelProps {
  channel: StreamChannel;
  chat: RunChat;
  activity: Activity;
  client: StreamChat;
  supabaseToken: string;
  coach: MentionableCoach | null;
  onBack: () => void;
}

function ChatPanel({ channel, chat, activity, client, supabaseToken, coach, onBack }: ChatPanelProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const aiInFlight = useRef(false);
  const seenAiTriggers = useRef(new Set<string>());
  const matchedWorkout = (chat.planned_workout as {
    structured?: { name?: string; partIndex?: number; partCount?: number };
  } | null)?.structured;

  const triggerAi = useCallback(
    async (messageId?: string) => {
      if (aiInFlight.current) return;
      if (messageId && seenAiTriggers.current.has(messageId)) return;
      if (messageId) seenAiTriggers.current.add(messageId);
      aiInFlight.current = true;
      setAiLoading(true);
      try {
        const res = await fetch(`/api/run-chat/${chat.id}/ai`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${supabaseToken}` },
        });
        if (!res.ok) {
          console.error('AI coach request failed', messageId, await res.text());
        }
      } catch (err) {
        console.error('AI coach request error', err);
      } finally {
        aiInFlight.current = false;
        setAiLoading(false);
      }
    },
    [chat.id, supabaseToken],
  );

  useEffect(() => {
    if (!channel) return;
    const handler = channel.on('message.new', (event) => {
      const msg = event.message;
      if (!msg || msg.user?.id === AI_USER_ID) return;
      if (!messageMentionsAi(msg)) return;
      void triggerAi(msg.id);
    });
    return () => handler.unsubscribe();
  }, [channel, triggerAi]);

  return (
    <div className="flex flex-col h-full bg-slate-900 text-white" dir="rtl" lang="he">
      <div className="flex-none flex items-center gap-3 px-4 py-3 border-b border-slate-700/60 bg-slate-900">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          aria-label="חזור"
        >
          <ArrowRight className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {activity.activity_name || 'ריצה'}
          </p>
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
        {aiLoading && <Loader2 className="h-4 w-4 animate-spin text-primary-400 shrink-0" />}
      </div>

      <div className="run-chat-shell flex-1 min-h-0 flex flex-col">
        <Chat client={client} i18nInstance={i18n} theme="str-chat__theme-dark">
          <WithComponents
            overrides={{
              MessageUI: RunChatMessageUI,
              Attachment: RunChatAttachment,
              Avatar: RunChatAvatar,
            }}
          >
            <Channel channel={channel}>
              <Window>
                <MessageList
                  messageActions={MESSAGE_ACTIONS}
                  formatDate={formatMessageTime}
                  // We render avatars ourselves in RunChatMessageUI (Stream's
                  // grid parks them on the timestamp row under RTL).
                  showAvatar={false}
                  noGroupByUser
                />
                <div className="run-chat-composer-shell flex justify-center px-3 py-2">
                  <div className="run-chat-composer-row flex w-full items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <MessageComposer />
                    </div>
                    <div className="run-chat-mention-rail flex shrink-0 items-center gap-2">
                      {coach && <CoachMentionButton channel={channel} coach={coach} />}
                      <AiMentionButton channel={channel} />
                    </div>
                  </div>
                </div>
              </Window>
              {/* Required for "תגובה בשרשור" — without this the action no-ops */}
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
      </div>
    </div>
  );
}

// ─── Connected shell ──────────────────────────────────────────────────────────

function ConnectedRunChat({
  tokenData,
  chat,
  activity,
  supabaseToken,
  coach,
  onBack,
}: {
  tokenData: StreamTokenData;
  chat: RunChat;
  activity: Activity;
  supabaseToken: string;
  coach: MentionableCoach | null;
  onBack: () => void;
}) {
  const client = useConnectedStreamClient(tokenData);
  const [channel, setChannel] = useState<StreamChannel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const chId = `run-${chat.activity_id}`;
    const ch = client.channel('messaging', chId);
    let cancelled = false;
    ch.watch()
      .then(() => {
        if (!cancelled) setChannel(ch);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
      ch.stopWatching().catch(() => {});
    };
  }, [client, chat.activity_id]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={onBack} className="text-primary-400 text-sm underline">
          חזור
        </button>
      </div>
    );
  }

  if (!client || !channel) {
    return (
      <div className="flex items-center justify-center h-full">
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
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RunChatPage() {
  const { activityId } = useParams<{ activityId: string }>();
  const router = useRouter();

  const [supabaseToken, setSupabaseToken] = useState<string | null>(null);
  const [chat, setChat] = useState<RunChat | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [coach, setCoach] = useState<MentionableCoach | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tokenData = useStreamToken(supabaseToken);

  useEffect(() => {
    getSupabase().auth.getSession().then(({ data }) => {
      setSupabaseToken(data.session?.access_token ?? null);
    });
  }, []);

  useEffect(() => {
    if (!supabaseToken || !activityId) return;

    fetch('/api/run-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseToken}`,
      },
      body: JSON.stringify({ activityId }),
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Failed to open chat');
        return body;
      })
      .then(({ chat: c, activity: a, coach: humanCoach }) => {
        setChat(c);
        if (a) setActivity(a);
        setCoach(humanCoach || null);
      })
      .catch((e) => setError(String(e.message || e)));
  }, [supabaseToken, activityId]);

  const onBack = () => router.back();

  return (
    <div
      className="flex h-[calc(100dvh-10.5rem)] min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-white shadow-2xl md:h-[calc(100dvh-8.5rem)]"
      dir="rtl"
      lang="he"
    >
      {error ? (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={onBack} className="text-primary-400 text-sm underline">
            חזור
          </button>
        </div>
      ) : !chat || !activity || !supabaseToken || !tokenData ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
        </div>
      ) : (
        <ConnectedRunChat
          key={tokenData.userId}
          tokenData={tokenData}
          chat={chat}
          activity={activity}
          supabaseToken={supabaseToken}
          coach={coach}
          onBack={onBack}
        />
      )}
    </div>
  );
}
