'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import 'stream-chat-react/dist/css/index.css';
import { accessToken } from '@/lib/auth/bearer-headers';
import { useStreamTokenState } from '@/lib/stream/client';
import type { MentionableCoach } from '@/components/run-chat/CoachMentionButton';
import {
  ConnectedRunChat,
  type RunChat,
  type RunChatActivity,
} from '@/components/run-chat/RunChatPanel';
import '../run-chat.css';

/** After this long on the spinner, say so and offer a retry (#73). */
const SLOW_OPEN_MS = 15_000;

export default function RunChatPage() {
  const { activityId } = useParams<{ activityId: string }>();
  const router = useRouter();
  const t = useTranslations('runChat');
  // undefined = still asking; null = there is no session to be had.
  const [supabaseToken, setSupabaseToken] = useState<string | null | undefined>(undefined);
  const [chat, setChat] = useState<RunChat | null>(null);
  const [activity, setActivity] = useState<RunChatActivity | null>(null);
  const [coach, setCoach] = useState<MentionableCoach | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const token = useStreamTokenState(supabaseToken ?? null, attempt);
  const tokenData = token.data;

  // #73: this used to read getSession() directly, which answers null for a member
  // whose session lapsed — and a null token meant no request was ever sent, so
  // the spinner had nothing to wait for and spun forever. accessToken() is what
  // every other screen uses: it re-mints a lapsed session silently first.
  useEffect(() => {
    let cancelled = false;
    accessToken()
      .then((value) => { if (!cancelled) setSupabaseToken(value); })
      .catch(() => { if (!cancelled) setSupabaseToken(null); });
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    if (!supabaseToken || !activityId) return;
    let cancelled = false;

    fetch('/api/run-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseToken}`,
      },
      body: JSON.stringify({ activityId }),
    })
      .then(async (response) => {
        // A gateway timeout answers HTML, not JSON. Either way the raw error is
        // for the console, not the runner: it's English and often a stack string.
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`run-chat ${response.status}: ${body.error || 'no body'}`);
        return body as {
          chat: RunChat;
          activity?: RunChatActivity;
          coach?: MentionableCoach | null;
        };
      })
      .then((body) => {
        if (cancelled) return;
        setChat(body.chat);
        if (body.activity) setActivity(body.activity);
        else setError(t('openFailed'));
        setCoach(body.coach || null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        console.warn('Failed to open run chat:', requestError);
        setError(t('openFailed'));
      });
    return () => { cancelled = true; };
  }, [supabaseToken, activityId, attempt, t]);

  const ready = !!chat && !!activity && !!supabaseToken && !!tokenData;
  const failure =
    error ??
    (supabaseToken === null ? t('noSession') : null) ??
    (token.failed ? t('openFailed') : null);

  useEffect(() => {
    if (ready || failure) return;
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_OPEN_MS);
    return () => clearTimeout(timer);
  }, [ready, failure, attempt]);

  const onBack = () => router.back();
  const retry = () => {
    setError(null);
    setChat(null);
    setActivity(null);
    setSupabaseToken(undefined);
    setAttempt((n) => n + 1);
  };

  return (
    <div
      className="run-chat-page flex h-[calc(100dvh-10.5rem)] min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-page bg-page text-ink-700 shadow-2xl md:h-[calc(100dvh-8.5rem)]"
      dir="rtl"
      lang="he"
      data-pull-to-refresh-ignore
    >
      {failure ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm text-accent-red">{failure}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={retry}
              className="min-h-[44px] rounded-full bg-brand-600 px-5 text-sm font-semibold text-white"
            >
              {t('retry')}
            </button>
            <button onClick={onBack} className="min-h-[44px] px-4 text-sm font-semibold text-brand-600">
              {t('back')}
            </button>
          </div>
        </div>
      ) : !chat || !activity || !supabaseToken || !tokenData ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
          <p className="text-sm text-ink-500">{slow ? t('openSlow') : t('opening')}</p>
          {slow && (
            <button
              onClick={retry}
              className="min-h-[44px] rounded-full border border-page bg-card px-5 text-sm font-semibold text-brand-600"
            >
              {t('retry')}
            </button>
          )}
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
