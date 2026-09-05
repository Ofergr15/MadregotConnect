'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations, useFormatter } from 'next-intl';
import { fetchComments, addComment, deleteComment } from '@/lib/feed-client';
import { FeedAvatar } from '@/components/FeedAvatar';
import { FeedBodyText } from '@/components/FeedBodyText';
import { MentionTextarea } from '@/components/MentionTextarea';
import { Sheet } from '@/components/ui/Sheet';
import { COMMENT_PREVIEW_COUNT } from '@/lib/feed/comments';
import type { FeedItem } from '@/lib/feed/project';
import type { FeedComment } from '@/lib/feed-client';

interface Props {
  item: FeedItem;
  myAthleteId: string | null;
  /**
   * Hands back both the new count and the tail of the thread, so the card
   * underneath can refresh its inline preview too — otherwise you'd write a
   * comment, close the sheet, and not see it on your own card until a reload.
   */
  onClose: (newCommentCount: number, latest: FeedComment[]) => void;
}

export function FeedCommentSheet({ item, myAthleteId, onClose }: Props) {
  const t = useTranslations('feed');
  const format = useFormatter();
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentCount, setCommentCount] = useState(item.commentCount);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchComments(item.id)
      .then(({ comments: c }) => { if (!cancelled) { setComments(c); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item.id]);

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
      const { comment, commentCount: nextCount } = await addComment(item.id, body);
      setComments(prev => [...prev, comment]);
      setCommentCount(nextCount);
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
      const { commentCount: nextCount } = await deleteComment(commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
      setCommentCount(nextCount);
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

  // Only report the tail once the thread has actually loaded — closing the sheet
  // mid-load would otherwise hand back [] and blank a preview that was correct.
  const handleClose = () =>
    onClose(commentCount, loading ? item.commentPreview : comments.slice(-COMMENT_PREVIEW_COUNT));

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) handleClose(); }}
      title={t('comments')}
      trailingAction={
        <button
          onClick={handleClose}
          className="p-1.5 rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          aria-label={t('close')}
        >
          <X className="h-5 w-5" />
        </button>
      }
      className="h-[80vh]"
      bodyClassName="flex-1 min-h-0 p-0 flex flex-col"
      footer={
        <div className="flex-none flex items-end gap-2 px-4 pt-2 pb-3 border-t border-page">
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            viewerId={myAthleteId}
            onKeyDown={handleKeyDown}
            placeholder={t('addComment')}
            rows={1}
            autoGrow
            className={cn(
              'flex-1 bg-page border border-page rounded-xl px-3 py-2.5',
              'text-sm text-ink-700 placeholder:text-ink-400',
              'resize-none focus:outline-none focus:border-brand-600 transition-colors',
              'min-h-[40px]',
            )}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            aria-label="Send"
            className={cn(
              'shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all',
              draft.trim() && !sending
                ? 'bg-brand-600 text-white active:scale-90'
                : 'bg-page text-ink-400',
            )}
          >
            {sending
              ? <div className="h-4 w-4 rounded-full border-2 border-ink-300 border-t-transparent animate-spin" />
              : <Send className="h-4 w-4" />}
          </button>
        </div>
      }
    >
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" />
          </div>
        )}
        {!loading && comments.length === 0 && (
          <p className="text-center text-sm text-ink-400 py-8">{t('firstToComment')}</p>
        )}
        {comments.map(c => (
          <div key={c.id} className="flex gap-3">
            <FeedAvatar
              name={c.author.name}
              url={c.author.avatarUrl}
              className="w-8 h-8 bg-page"
              textClassName="text-ink-500"
            />
            <div className="flex-1 min-w-0">
              <div className="bg-page rounded-2xl rounded-ss-sm px-3 py-2">
                <p className="text-xs font-semibold text-brand-600 mb-0.5">{c.author.name}</p>
                <p className="text-sm text-ink-700 leading-snug whitespace-pre-line"><FeedBodyText body={c.body} /></p>
              </div>
              <p className="text-[10px] text-ink-400 mt-1 ms-1">{format.relativeTime(new Date(c.createdAt))}</p>
            </div>
            {c.canDelete && (
              <button
                onClick={() => handleDelete(c.id)}
                aria-label="Delete comment"
                className="shrink-0 self-start mt-1.5 p-1.5 rounded-full text-ink-300 hover:text-accent-red active:text-accent-red hover:bg-accent-red/10 active:bg-accent-red/10 transition-all"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
