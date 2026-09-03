'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import 'stream-chat-react/dist/css/index.css';
import { getSupabase } from '@/lib/supabase/client';
import { useStreamToken } from '@/lib/stream/client';
import type { MentionableCoach } from '@/components/run-chat/CoachMentionButton';
import {
  ConnectedRunChat,
  type RunChat,
  type RunChatActivity,
} from '@/components/run-chat/RunChatPanel';
import '../run-chat.css';

export default function RunChatPage() {
  const { activityId } = useParams<{ activityId: string }>();
  const router = useRouter();
  const [supabaseToken, setSupabaseToken] = useState<string | null>(null);
  const [chat, setChat] = useState<RunChat | null>(null);
  const [activity, setActivity] = useState<RunChatActivity | null>(null);
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
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Failed to open chat');
        return body as {
          chat: RunChat;
          activity?: RunChatActivity;
          coach?: MentionableCoach | null;
        };
      })
      .then((body) => {
        setChat(body.chat);
        if (body.activity) setActivity(body.activity);
        setCoach(body.coach || null);
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      });
  }, [supabaseToken, activityId]);

  const onBack = () => router.back();

  return (
    <div
      className="run-chat-page flex h-[calc(100dvh-10.5rem)] min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-page bg-page text-ink-700 shadow-2xl md:h-[calc(100dvh-8.5rem)]"
      dir="rtl"
      lang="he"
      data-pull-to-refresh-ignore
    >
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm text-accent-red">{error}</p>
          <button onClick={onBack} className="text-sm text-brand-600 underline">
            חזור
          </button>
        </div>
      ) : !chat || !activity || !supabaseToken || !tokenData ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
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
