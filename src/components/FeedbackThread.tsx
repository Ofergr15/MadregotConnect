'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';

interface ThreadMessage {
  id: string;
  body: string;
  createdAt: string;
  isMine: boolean;
  senderName: string | null;
  senderAvatarUrl: string | null;
}

/**
 * Roadmap #1, Personal Chat & Feedback System — the threaded upgrade of the
 * old single one-shot coach_reply (migration 063). Embedded inline wherever
 * a feedback row is shown (the staff Workout Feedback list, the athlete's
 * own feedback page) — never a popup Sheet, matching where the old reply
 * composer already lived.
 */
// `viewerEmail` is only a "do we know who's looking yet" signal for skipping the
// fetch — the server takes the viewer's identity from the session, never from
// the request, so passing a different address here changes nothing.
export function FeedbackThread({ feedbackId, viewerEmail }: { feedbackId: string; viewerEmail: string }) {
  const t = useTranslations('feedbackThread');
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!viewerEmail) { setLoading(false); return; }
    setLoading(true);
    apiHeaders()
      .then((headers) => fetch(`/api/workout-feedback/${feedbackId}/messages`, { headers }))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setMessages(data?.messages || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [feedbackId, viewerEmail]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!loading) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [loading, messages.length]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch(`/api/workout-feedback/${feedbackId}/messages`, {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t('sendError'));
      setMessages((prev) => [...prev, { id: data.id, body, createdAt: data.createdAt, isMine: true, senderName: null, senderAvatarUrl: null }]);
      setDraft('');
    } catch (err: unknown) {
      setError((err as Error).message || t('sendError'));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  if (loading) return null;

  return (
    <div className="mt-3 pt-3 border-t border-page/40">
      {messages.length > 0 && (
        <div ref={listRef} className="space-y-2 max-h-64 overflow-y-auto mb-2">
          {messages.map((m) => (
            <div key={m.id} className={cn('flex', m.isMine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                  m.isMine ? 'bg-brand-600 text-white' : 'bg-page/60 text-ink-700',
                )}
              >
                {!m.isMine && m.senderName && (
                  <p className="text-2xs font-bold text-brand-600 mb-0.5" dir="auto">{m.senderName}</p>
                )}
                <p dir="auto" className="whitespace-pre-wrap break-words">{m.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {messages.length === 0 && (
        <p className="flex items-center gap-1.5 text-2xs text-ink-400 mb-2">
          <MessageCircle className="h-3 w-3" />
          {t('empty')}
        </p>
      )}

      {error && <p className="text-2xs text-accent-red mb-1.5">{error}</p>}

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('placeholder')}
          rows={1}
          className="flex-1 bg-page/60 border border-page rounded-xl px-3 py-2 text-sm text-ink-700 placeholder:text-ink-400 resize-none focus:outline-none focus:border-brand-600 min-h-[38px]"
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          aria-label={t('send')}
          className={cn(
            'shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all',
            draft.trim() && !sending ? 'bg-brand-600 text-white active:scale-90' : 'bg-page text-ink-400',
          )}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
