'use client';

import { useState, useRef, useCallback } from 'react';
import { X, ImagePlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { createPost, uploadMedia } from '@/lib/feed-client';
import { Sheet } from '@/components/ui/Sheet';
import type { FeedItem, FeedMedia } from '@/lib/feed/project';

const MAX_IMAGES = 4;

interface Props {
  onClose: () => void;
  onPost: (item: FeedItem) => void;
}

export function FeedComposer({ onClose, onPost }: Props) {
  const t = useTranslations('feed');
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<FeedMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canPost = (body.trim().length > 0 || media.length > 0) && !uploading && !posting;

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_IMAGES - media.length;
    if (remaining <= 0) return;
    const toUpload = Array.from(files).slice(0, remaining);
    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(toUpload.map(f => uploadMedia(f)));
      setMedia(prev => [...prev, ...uploaded]);
    } catch (err: unknown) {
      setError((err as Error).message || t('uploadError'));
    } finally {
      setUploading(false);
    }
  }, [media.length, t]);

  const removeMedia = (path: string) => {
    setMedia(prev => prev.filter(m => m.path !== path));
  };

  const handlePost = async () => {
    if (!canPost) return;
    setPosting(true);
    setError(null);
    try {
      const { item } = await createPost(body.trim(), media);
      onPost(item);
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || t('postError'));
      setPosting(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose(); }}
      title={t('newPost')}
      leadingAction={
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          aria-label={t('close')}
        >
          <X className="h-5 w-5" />
        </button>
      }
      trailingAction={
        <button
          onClick={handlePost}
          disabled={!canPost}
          className={cn(
            'px-4 py-1.5 rounded-full text-sm font-bold transition-all',
            canPost
              ? 'bg-primary-600 text-white active:scale-95'
              : 'bg-slate-700 text-slate-500',
          )}
        >
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('publish')}
        </button>
      }
      className="max-h-[90vh]"
      bodyClassName="flex-1 min-h-0 p-0"
      footer={
        <div className="flex-none flex items-center gap-3 px-4 pt-2 pb-3 border-t border-slate-700/60">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,image/heic,image/heif"
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={media.length >= MAX_IMAGES || uploading}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all',
              media.length < MAX_IMAGES && !uploading
                ? 'text-primary-400 bg-primary-600/10 hover:bg-primary-600/20'
                : 'text-slate-600',
            )}
          >
            <ImagePlus className="h-5 w-5" />
            <span>{t('image')}</span>
            {media.length > 0 && <span className="text-xs text-slate-500">{media.length}/{MAX_IMAGES}</span>}
          </button>
        </div>
      }
    >
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 min-h-0">
          <textarea
            autoFocus
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={t('composerPlaceholder')}
            className="w-full bg-transparent text-white placeholder:text-slate-500 text-base leading-relaxed resize-none focus:outline-none"
            style={{ minHeight: '120px' }}
          />

          {media.length > 0 && (
            <div
              className={cn(
                'mt-3 gap-1.5',
                media.length === 1 && 'block',
                media.length >= 2 && 'grid',
                media.length === 2 && 'grid-cols-2',
                media.length >= 3 && 'grid-cols-2',
              )}
            >
              {media.map((m, i) => (
                <div
                  key={m.path}
                  className={cn(
                    'relative overflow-hidden rounded-xl bg-slate-900',
                    media.length === 3 && i === 0 && 'col-span-2',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.url}
                    alt=""
                    className="w-full object-cover"
                    style={{
                      aspectRatio: m.w && m.h ? `${m.w}/${m.h}` : '4/3',
                      maxHeight: media.length === 1 ? '400px' : '200px',
                    }}
                  />
                  <button
                    onClick={() => removeMedia(m.path)}
                    className="absolute top-2 end-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {uploading && (
            <div className="flex items-center gap-2 mt-3 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('uploadingImage')}
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-400">{error}</p>
          )}
      </div>
    </Sheet>
  );
}
