'use client';

import { useState, useEffect } from 'react';
import { X, Heart } from 'lucide-react';
import { fetchLikers } from '@/lib/feed-client';
import { FeedAvatar } from '@/components/FeedAvatar';
import type { FeedLiker } from '@/lib/feed/project';

interface Props {
  itemId: string;
  /** From the card, so the header can show a total before the list lands. */
  likeCount: number;
  /**
   * The likers already in the feed payload. Rendered immediately so the sheet
   * opens with content instead of a spinner, then replaced by the full list.
   */
  seed?: FeedLiker[];
  onClose: () => void;
}

export function FeedLikesSheet({ itemId, likeCount, seed = [], onClose }: Props) {
  const [likers, setLikers] = useState<FeedLiker[]>(seed);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLikers(itemId)
      .then(({ likers: l }) => { if (!cancelled) { setLikers(l); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [itemId]);

  // Anyone past the API's cap, or still loading behind the seed.
  const hidden = Math.max(0, likeCount - likers.length);

  return (
    <div className="fixed inset-0 z-[60] flex items-end" onClick={onClose}>
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
            <span className="flex items-center gap-2 text-base font-bold text-white">
              <Heart className="h-4 w-4 fill-rose-400 text-rose-400" />
              אהבו את זה
              {likeCount > 0 && (
                <span className="text-sm font-medium text-slate-400 tabular-nums">{likeCount}</span>
              )}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              aria-label="סגור"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Liker list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
          {loading && likers.length === 0 && (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
            </div>
          )}
          {!loading && likers.length === 0 && (
            <p className="text-center text-sm text-slate-500 py-8">עוד אף אחד לא אהב את זה</p>
          )}
          {likers.map(l => (
            <div key={l.athleteId} className="flex items-center gap-3 py-2">
              <FeedAvatar name={l.name} url={l.avatarUrl} />
              <span className="text-sm text-slate-200 truncate">{l.name}</span>
            </div>
          ))}
          {!loading && hidden > 0 && (
            <p className="text-center text-xs text-slate-500 py-3">ועוד {hidden}</p>
          )}
        </div>
      </div>
    </div>
  );
}
