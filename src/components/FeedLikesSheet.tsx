'use client';

import { useState, useEffect } from 'react';
import { X, Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { fetchLikers } from '@/lib/feed-client';
import { FeedAvatar } from '@/components/FeedAvatar';
import { Sheet } from '@/components/ui/Sheet';
import type { FeedLiker } from '@/lib/feed/project';

interface Props {
  itemId: string;
  likeCount: number;
  seed?: FeedLiker[];
  onClose: () => void;
}

export function FeedLikesSheet({ itemId, likeCount, seed = [], onClose }: Props) {
  const t = useTranslations('feed');
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

  const hidden = Math.max(0, likeCount - likers.length);

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose(); }}
      title={
        <span className="flex items-center gap-2">
          <Heart className="h-4 w-4 fill-accent-red text-accent-red" />
          {t('likedBy')}
          {likeCount > 0 && (
            <span className="text-sm font-medium text-ink-400 tabular-nums">{likeCount}</span>
          )}
        </span>
      }
      trailingAction={
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors"
          aria-label={t('close')}
        >
          <X className="h-5 w-5" />
        </button>
      }
      className="max-h-[80vh]"
      bodyClassName="px-4 py-2"
    >
      {loading && likers.length === 0 && (
        <div className="flex justify-center py-8">
          <div className="h-5 w-5 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" />
        </div>
      )}
      {!loading && likers.length === 0 && (
        <p className="text-center text-sm text-ink-400 py-8">{t('noLikesYet')}</p>
      )}
      {likers.map(l => (
        <div key={l.athleteId} className="flex items-center gap-3 py-2">
          <FeedAvatar name={l.name} url={l.avatarUrl} />
          <span className="text-sm text-ink-700 truncate">{l.name}</span>
        </div>
      ))}
      {!loading && hidden > 0 && (
        <p className="text-center text-xs text-ink-400 py-3">{t('andMore', { count: hidden })}</p>
      )}
    </Sheet>
  );
}
