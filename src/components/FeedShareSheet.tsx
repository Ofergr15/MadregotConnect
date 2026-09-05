'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Share2, ImagePlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations, useLocale } from 'next-intl';
import { renderShareCard, shareCard, SHARE_TEMPLATE_KEYS } from '@/lib/feed/share-image';
import { Sheet } from '@/components/ui/Sheet';
import type { ShareTemplate } from '@/lib/feed/share-image';
import type { FeedItem } from '@/lib/feed/project';

type Style = 'photo' | 'transparent';
const TEMPLATE_LABELS: Record<ShareTemplate, 'templateClassic' | 'templateCard' | 'templateMinimal'> = {
  classic: 'templateClassic',
  card: 'templateCard',
  minimal: 'templateMinimal',
};

interface Props {
  item: FeedItem;
  onClose: () => void;
}

export function FeedShareSheet({ item, onClose }: Props) {
  const t = useTranslations('feed');
  const ts = useTranslations('feed.share');
  const locale = useLocale();
  const [style, setStyle] = useState<Style>('photo');
  const [template, setTemplate] = useState<ShareTemplate>('classic');
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setRendering(true);
    setError(null);
    setNotice(null);

    renderShareCard(
      item,
      { locale, km: t('km'), perKm: t('perKm'), pace: ts('cardPace'), time: ts('cardTime'), hr: ts('cardHr') },
      { background: photo, transparent: style === 'transparent', template },
    )
      .then(blob => {
        if (cancelled) return;
        blobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        setRendering(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(ts('renderError'));
        setRendering(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item, photo, style, template, locale, t, ts]);

  const handleShare = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ext = blob.type === 'image/png' ? 'png' : 'jpg';
      const result = await shareCard(blob, `madregot-${item.id.slice(0, 8)}.${ext}`);
      if (result === 'downloaded') {
        setNotice(
          style === 'transparent'
            ? ts('savedSticker')
            : ts('saved'),
        );
      } else {
        onClose();
      }
    } catch {
      setError(ts('shareError'));
    } finally {
      setBusy(false);
    }
  }, [busy, item.id, style, onClose, ts]);

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose(); }}
      title={ts('title')}
      trailingAction={
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          aria-label={t('close')}
        >
          <X className="h-5 w-5" />
        </button>
      }
      className="max-h-[92vh]"
      bodyClassName="flex-1 min-h-0 p-0"
      footer={
        <div className="flex-none px-5 pt-2 pb-4 border-t border-page">
          <button
            onClick={handleShare}
            disabled={rendering || busy || !previewUrl}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all active:scale-[0.98]',
              rendering || busy || !previewUrl
                ? 'bg-page text-ink-400'
                : 'bg-brand-600 text-white',
            )}
          >
            {busy
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <Share2 className="h-5 w-5" />}
            {ts('action')}
          </button>
        </div>
      }
    >
      <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          <div className="flex gap-2 mb-2.5">
            {SHARE_TEMPLATE_KEYS.map(key => (
              <button
                key={key}
                onClick={() => setTemplate(key)}
                className={cn(
                  'flex-1 py-2 rounded-xl text-sm font-semibold transition-colors',
                  template === key
                    ? 'bg-brand-600 text-white'
                    : 'bg-page text-ink-400 hover:text-ink-700',
                )}
              >
                {ts(TEMPLATE_LABELS[key])}
              </button>
            ))}
          </div>

          <div className="flex gap-2 mb-4">
            {([
              { key: 'photo', label: ts('backgroundPhoto') },
              { key: 'transparent', label: ts('backgroundTransparent') },
            ] as const).map(o => (
              <button
                key={o.key}
                onClick={() => setStyle(o.key)}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                  style === o.key
                    ? 'border-brand-600 text-brand-600 bg-brand-600/10'
                    : 'border-page text-ink-400 hover:text-ink-500',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* 9:16 preview. The checkerboard makes alpha visible for the sticker
              variant — on the sheet's dark panel it would look like a black card. */}
          <div
            className="relative mx-auto rounded-xl overflow-hidden border border-page"
            style={{
              aspectRatio: '9 / 16',
              maxHeight: '46vh',
              width: 'auto',
              backgroundColor: '#DFDFDF',
              backgroundImage:
                style === 'transparent'
                  ? 'linear-gradient(45deg,#BBBBBB 25%,transparent 25%),linear-gradient(-45deg,#BBBBBB 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#BBBBBB 75%),linear-gradient(-45deg,transparent 75%,#BBBBBB 75%)'
                  : undefined,
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0,0 10px,10px -10px,-10px 0px',
            }}
          >
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={ts('preview')} className="w-full h-full object-contain" />
            )}
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-page">
                <Loader2 className="h-6 w-6 text-brand-600 animate-spin" />
              </div>
            )}
          </div>

          {style === 'photo' && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) setPhoto(f);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-page text-ink-500 text-sm font-medium hover:bg-ink-300/40 transition-colors"
              >
                <ImagePlus className="h-4 w-4" />
                {photo ? ts('changePhoto') : ts('addPhoto')}
              </button>
            </>
          )}

          {style === 'transparent' && (
            <p className="mt-4 text-xs text-ink-400 leading-relaxed text-center">
              {ts('stickerHint')}
            </p>
          )}

          {notice && <p className="mt-3 text-xs text-accent-400 text-center">{notice}</p>}
          {error && <p className="mt-3 text-xs text-accent-red text-center">{error}</p>}
      </div>
    </Sheet>
  );
}
