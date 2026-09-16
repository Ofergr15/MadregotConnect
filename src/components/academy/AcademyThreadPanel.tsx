'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageCircleOff } from 'lucide-react';
import type { Channel as StreamChannel, StreamChat } from 'stream-chat';
import { getSupabase } from '@/lib/supabase/client';
import { useConnectedStreamClient, useStreamToken, type StreamTokenData } from '@/lib/stream/client';
// From `stream/constants`, not `stream/server`: that module holds the service-role
// client and pulling it into a client component drags the secret side of Stream into
// the browser bundle.
import { CHANNEL_TYPE } from '@/lib/stream/constants';
import { toThreadMessages, type StreamMessageLike } from '@/lib/academy/thread';
import { ThreadTranscript, type ThreadMessage, type ThreadSeat } from './ThreadTranscript';
import type { SegmentVerdict } from '@/lib/academy/segments';

// ── The three-way thread, connected ─────────────────────────────────────────
//
// Deliberately NOT stream-chat-react. The run chat uses it and should: it needs
// reactions, threads, uploads, an emoji picker and a mention autocomplete. This
// thread needs a transcript and a composer, and `ThreadTranscript` already renders
// them the way the rest of the academy looks — RTL, seat-labelled, with the weekly
// review as a card. Mounting Stream's own UI here would import a second design
// language and a second set of Hebrew translations to keep correct, to replace a
// component that already passes the audit.
//
// So Stream is used as the transport only: watch the channel, read `state.messages`,
// send text. Which is also why the same token route serves both screens.

/** What the open-thread route hands back. */
interface OpenedThread {
  athleteId: string;
  name: string;
  channelId: string;
  mentorId: string | null;
  seat: ThreadSeat;
}

export function AcademyThreadPanel({
  athleteId,
  segments,
  className,
}: {
  /** Omit to open the signed-in trainee's own thread. */
  athleteId?: string;
  segments?: SegmentVerdict[];
  className?: string;
}) {
  const [supabaseToken, setSupabaseToken] = useState<string | null>(null);
  const [thread, setThread] = useState<OpenedThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenData = useStreamToken(supabaseToken);

  useEffect(() => {
    getSupabase().auth.getSession().then(({ data }) => {
      setSupabaseToken(data.session?.access_token ?? null);
    });
  }, []);

  useEffect(() => {
    if (!supabaseToken) return;
    let cancelled = false;
    fetch('/api/academy/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseToken}` },
      body: JSON.stringify(athleteId ? { athleteId } : {}),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'לא הצלחנו לפתוח את השרשור');
        return body as OpenedThread;
      })
      .then((body) => { if (!cancelled) setThread(body); })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [supabaseToken, athleteId]);

  if (error) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-ink-400" dir="rtl">
        <MessageCircleOff className="h-3.5 w-3.5" />
        {error}
      </div>
    );
  }
  if (!thread || !tokenData) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <ConnectedAcademyThread
      // Remounted per identity: the connection is keyed to the user, and reusing a
      // client across a switch is what the dev identity switcher trips over.
      key={tokenData.userId}
      tokenData={tokenData}
      thread={thread}
      segments={segments}
      className={className}
    />
  );
}

function ConnectedAcademyThread({
  tokenData,
  thread,
  segments,
  className,
}: {
  tokenData: StreamTokenData;
  thread: OpenedThread;
  segments?: SegmentVerdict[];
  className?: string;
}) {
  const client = useConnectedStreamClient(tokenData);
  const [channel, setChannel] = useState<StreamChannel | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback((ch: StreamChannel) => {
    setMessages(toThreadMessages(
      (ch.state.messages ?? []) as unknown as StreamMessageLike[],
      { athleteId: thread.athleteId, mentorId: thread.mentorId },
    ));
  }, [thread.athleteId, thread.mentorId]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const ch = client.channel(CHANNEL_TYPE, thread.channelId);
    ch.watch()
      .then(() => {
        if (cancelled) return;
        setChannel(ch);
        sync(ch);
        // Marked read on open, not on scroll. The inbox ranks by unread, and a thread
        // you are looking at that still counts as unread sends you back to it.
        ch.markRead().catch(() => { /* a stale read marker is not worth an error */ });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    // `message.updated` matters as much as `message.new` here: a revised weekly review
    // EDITS the card already in the thread (see academyFeedbackMessageId), so without
    // this the trainee keeps reading the superseded version until they reload.
    const onEvent = () => { if (!cancelled) sync(ch); };
    const subs = [
      ch.on('message.new', onEvent),
      ch.on('message.updated', onEvent),
      ch.on('message.deleted', onEvent),
    ];

    return () => {
      cancelled = true;
      subs.forEach(s => s.unsubscribe());
      ch.stopWatching().catch(() => { /* unmounting anyway */ });
    };
  }, [client, thread.channelId, sync]);

  const onSend = async (text: string) => {
    if (!channel) return;
    setSending(true);
    setError(null);
    try {
      await channel.sendMessage({ text });
    } catch (e: unknown) {
      // Surfaced, because `ThreadTranscript` clears the composer optimistically — a
      // silent failure here loses what the person just wrote.
      setError(e instanceof Error ? e.message : 'ההודעה לא נשלחה');
    } finally {
      setSending(false);
    }
  };

  if (!client || !channel) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <ThreadTranscript
      messages={messages}
      viewerSeat={thread.seat}
      segments={segments}
      onSend={onSend}
      sending={sending}
      error={error}
      className={className}
    />
  );
}
