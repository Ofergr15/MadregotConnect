'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PenSquare, RefreshCw } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { fetchFeed, deletePost } from '@/lib/feed-client';
import { FeedCard } from '@/components/FeedCard';
import { FeedCommentSheet } from '@/components/FeedCommentSheet';
import { FeedComposer } from '@/components/FeedComposer';
import type { FeedItem } from '@/lib/feed/project';

// Maintains per-item comment counts separately so card re-renders are cheap.
type CommentCounts = Record<string, number>;

export default function FeedPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [counts, setCounts] = useState<CommentCounts>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [commentItem, setCommentItem] = useState<FeedItem | null>(null);

  // Avatar of the signed-in user, shown in the composer bar.
  const [myName, setMyName] = useState('');

  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = cursor !== null;

  useEffect(() => {
    getSupabase().auth.getSession().then(({ data }) => {
      const name = data.session?.user?.user_metadata?.full_name ||
        data.session?.user?.email?.split('@')[0] || '';
      setMyName(name);
    });
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: page, nextCursor } = await fetchFeed(null, 15);
      setItems(page);
      setCounts(Object.fromEntries(page.map(i => [i.id, i.commentCount])));
      setCursor(nextCursor);
    } catch (err: unknown) {
      setError((err as Error).message || 'שגיאה בטעינת הפיד');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const { items: page, nextCursor } = await fetchFeed(cursor, 15);
      setItems(prev => [...prev, ...page]);
      setCounts(prev => ({
        ...prev,
        ...Object.fromEntries(page.map(i => [i.id, i.commentCount])),
      }));
      setCursor(nextCursor);
    } catch { /* silent — user can scroll again */ }
    finally { setLoadingMore(false); }
  }, [loadingMore, cursor]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  // Infinite scroll via IntersectionObserver on a sentinel div at the bottom.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
        loadMore();
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, loading, loadMore]);

  const handleDelete = async (item: FeedItem) => {
    try {
      await deletePost(item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (err: unknown) {
      alert((err as Error).message || 'שגיאה במחיקה');
    }
  };

  const handleCommentClose = (itemId: string, newCount: number) => {
    setCounts(prev => ({ ...prev, [itemId]: newCount }));
    setCommentItem(null);
  };

  const handlePost = (newItem: FeedItem) => {
    setItems(prev => [newItem, ...prev]);
    setCounts(prev => ({ ...prev, [newItem.id]: 0 }));
  };

  const initials = (myName || '??').slice(0, 2).toUpperCase();

  return (
    <div className="max-w-xl mx-auto">
      {/* Composer trigger bar */}
      <div
        className="mb-4 bg-slate-800/50 rounded-2xl border border-slate-700/30 p-3 flex items-center gap-3 cursor-pointer hover:bg-slate-800/70 transition-colors active:scale-[0.98]"
        onClick={() => setComposerOpen(true)}
      >
        <div className="w-9 h-9 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0">
          <span className="text-primary-400 text-xs font-bold">{initials}</span>
        </div>
        <span className="flex-1 text-sm text-slate-500">מה חדש אצלך?</span>
        <PenSquare className="h-4 w-4 text-slate-600" />
      </div>

      {/* Feed */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(n => (
            <div key={n} className="bg-slate-800/30 rounded-2xl border border-slate-700/20 h-40 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-2xl p-6 text-center">
          <p className="text-sm text-red-400 mb-3">{error}</p>
          <button
            onClick={loadInitial}
            className="flex items-center gap-2 mx-auto text-sm text-red-300 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" /> נסה שוב
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="bg-slate-800/30 rounded-2xl border border-slate-700/20 p-10 text-center">
          <p className="text-slate-400 text-sm mb-1">הפיד ריק כרגע</p>
          <p className="text-slate-600 text-xs">רוצ חדש יופיע כאן אחרי הריצה הבאה</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map(item => (
            <FeedCard
              key={item.id}
              item={item}
              commentCount={counts[item.id] ?? item.commentCount}
              onComment={i => setCommentItem(i)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-1" />

      {loadingMore && (
        <div className="flex justify-center py-6">
          <div className="h-5 w-5 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <p className="text-center text-xs text-slate-600 py-6">הכל נטען ✓</p>
      )}

      {/* Comment sheet */}
      {commentItem && (
        <FeedCommentSheet
          item={commentItem}
          onClose={count => handleCommentClose(commentItem.id, count)}
        />
      )}

      {/* Post composer */}
      {composerOpen && (
        <FeedComposer
          onClose={() => setComposerOpen(false)}
          onPost={handlePost}
        />
      )}
    </div>
  );
}
