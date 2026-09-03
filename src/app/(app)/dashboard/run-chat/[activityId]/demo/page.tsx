'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Loader2, Radio } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getSupabase } from '@/lib/supabase/client';
import {
  ConnectedRunChat,
  type RunChat,
  type RunChatActivity,
} from '@/components/run-chat/RunChatPanel';
import type { MentionableCoach } from '@/components/run-chat/CoachMentionButton';
import type { StreamTokenData } from '@/lib/stream/client';
import '../../run-chat.css';

interface DemoParticipants {
  runner: StreamTokenData;
  coach: StreamTokenData;
}

export default function RunChatDemoPage() {
  const { activityId } = useParams<{ activityId: string }>();
  const router = useRouter();
  const t = useTranslations('runChat');
  const [supabaseToken, setSupabaseToken] = useState<string | null>(null);
  const [chat, setChat] = useState<RunChat | null>(null);
  const [activity, setActivity] = useState<RunChatActivity | null>(null);
  const [coach, setCoach] = useState<MentionableCoach | null>(null);
  const [participants, setParticipants] = useState<DemoParticipants | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        const token = data.session?.access_token;
        if (!token) throw new Error('Sign in as Test Runner or Test Coach first');
        setSupabaseToken(token);
      })
      .catch((sessionError) => setError(String(sessionError.message || sessionError)));
  }, []);

  useEffect(() => {
    if (!supabaseToken || !activityId) return;

    const load = async () => {
      const [chatResponse, participantsResponse] = await Promise.all([
        fetch('/api/run-chat', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${supabaseToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ activityId }),
        }),
        fetch(`/api/dev/run-chat-participants?activityId=${encodeURIComponent(activityId)}`, {
          headers: { Authorization: `Bearer ${supabaseToken}` },
        }),
      ]);
      const chatBody = await chatResponse.json();
      const participantsBody = await participantsResponse.json();
      if (!chatResponse.ok) throw new Error(chatBody.error || 'Failed to open chat');
      if (!participantsResponse.ok) {
        throw new Error(participantsBody.error || 'Failed to load demo participants');
      }

      setChat(chatBody.chat);
      setActivity(chatBody.activity);
      setCoach(chatBody.coach || null);
      setParticipants(participantsBody.participants);
    };

    void load().catch((loadError) => setError(String(loadError.message || loadError)));
  }, [activityId, supabaseToken]);

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col gap-3" dir="rtl" lang="he">
      <div className="flex items-center gap-3 rounded-xl border border-page bg-page px-4 py-2.5 text-ink-700">
        <button
          className="rounded-lg p-1.5 text-ink-400 hover:bg-page hover:text-ink-900"
          aria-label="חזור"
          onClick={() => router.push(`/dashboard/run-chat/${activityId}`)}
        >
          <ArrowRight className="h-5 w-5" />
        </button>
        <Radio className="h-4 w-4 text-accent-600" />
        <div>
          <h1 className="text-sm font-semibold">{t('liveDemo')}</h1>
          <p className="text-[11px] text-ink-400">Runner ↔ Coach ↔ AI Coach</p>
        </div>
      </div>

      {error ? (
        <div className="grid flex-1 place-items-center rounded-2xl border border-accent-red/20 bg-page p-8">
          <p className="text-sm text-accent-red">{error}</p>
        </div>
      ) : !supabaseToken || !chat || !activity || !participants ? (
        <div className="grid flex-1 place-items-center rounded-2xl border border-page bg-page">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        </div>
      ) : (
        <div
          className="run-chat-demo-grid grid min-h-0 flex-1 gap-3 lg:grid-cols-2"
          data-testid="run-chat-live-demo"
        >
          <section
            className="h-[70dvh] min-h-[36rem] overflow-hidden rounded-2xl border border-band-2/25 bg-page shadow-xl lg:h-[calc(100dvh-12.5rem)]"
            data-testid="runner-chat-pane"
          >
            <ConnectedRunChat
              key={participants.runner.userId}
              tokenData={participants.runner}
              chat={chat}
              activity={activity}
              supabaseToken={supabaseToken}
              coach={coach}
              viewerLabel={t('runnerView')}
              enableAiTrigger
            />
          </section>
          <section
            className="h-[70dvh] min-h-[36rem] overflow-hidden rounded-2xl border border-band-3/25 bg-page shadow-xl lg:h-[calc(100dvh-12.5rem)]"
            data-testid="coach-chat-pane"
          >
            <ConnectedRunChat
              key={participants.coach.userId}
              tokenData={participants.coach}
              chat={chat}
              activity={activity}
              supabaseToken={supabaseToken}
              coach={coach}
              viewerLabel={t('coachView')}
              enableAiTrigger={false}
            />
          </section>
        </div>
      )}
    </div>
  );
}
