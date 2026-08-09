'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations, useFormatter } from 'next-intl';
import { fetchComments, addComment, deleteComment } from '@/lib/feed-client';
import { FeedAvatar } from '@/components/FeedAvatar';
import type { FeedItem } from '@/lib/feed/project';
import type { FeedComment } from '@/lib/feed-client';

interface Props {
  item: FeedItem;
  onClose: (newCommentCount: number) => void;
}

export function FeedCommentSheet({ item, onClose }: Props) {
  const t = useTranslations('feed');
  const format = useFormatter();
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchComments(item.id)
      .then(({ comments: c }) => { if (!cancelled) { setComments(c); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item.id]);

  // Scroll to bottom when comments load
  useEffect(() => {
    if (!loading && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [loading]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { comment } = await addComment(item.id, body);
      setComments(prev => [...prev, comment]);
      setDraft('');
      setTimeout(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
      }, 50);
    } catch (err: unknown) {
      alert((err as Error).message || t('commentError'));
    } finally {
      setSending(false);
    }
  }, [draft, sending, item.id, t]);

  const handleDelete = useCallback(async (commentId: string) => {
    try {
      await deleteComment(commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (err: unknown) {
      alert((err as Error).message || t('commentDeleteError'));
    }
  }, [t]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClose = () => onClose(comments.length);

  return (
    <div className="fixed inset-0 z-[60] flex items-end" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full bg-slate-800 rounded-t-2xl border-t border-slate-700 flex flex-col"
        style={{ maxHeight: '80vh', paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle + header */}
        <div className="flex-none pt-2 pb-3 px-5 border-b border-slate-700/60">
          <div className="w-9 h-1.5 rounded-full bg-slate-600 mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-white">{t('comments')}</span>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Comment list */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
            </div>
          )}
          {!loading && comments.length === 0 && (
            <p className="text-center text-sm text-slate-500 py-8">{t('firstToComment')}</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="flex gap-3">
              <FeedAvatar
                name={c.author.name}
                url={c.author.avatarUrl}
                className="w-8 h-8 bg-slate-700"
                textClassName="text-slate-300"
              />
              <div className="flex-1 min-w-0">
                <div className="bg-slate-700/50 rounded-2xl rounded-ss-sm px-3 py-2">
                  <p className="text-xs font-semibold text-primary-300 mb-0.5">{c.author.name}</p>
                  <p className="text-sm text-slate-200 leading-snug whitespace-pre-line">{c.body}</p>
                </div>
                <p className="text-[10px] text-slate-600 mt-1 ms-1">{format.relativeTime(new Date(c.createdAt))}</p>
              </div>
              {c.canDelete && (
                <button
                  onClick={() => handleDelete(c.id)}
                  className="shrink-0 self-start mt-1.5 p-1.5 rounded-full text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Input row */}
        <div className="flex-none flex items-end gap-2 px-4 pt-2 pb-3 border-t border-slate-700/60">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={e => {
              setDraft(e.target.value);
              // Auto-grow
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('addComment')}
            rows={1}
            className={cn(
              'flex-1 bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2.5',
              'text-sm text-white placeholder:text-slate-500',
              'resize-none focus:outline-none focus:border-primary-500 transition-colors',
              'min-h-[40px]',
            )}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            className={cn(
              'shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all',
              draft.trim() && !sending
                ? 'bg-primary-600 text-white active:scale-90'
                : 'bg-slate-700 text-slate-500',
            )}
          >
            {sending
              ? <div className="h-4 w-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
              : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
