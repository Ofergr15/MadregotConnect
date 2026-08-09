'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Share2, ImagePlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderShareCard, shareCard, SHARE_TEMPLATES } from '@/lib/feed/share-image';
import type { ShareTemplate } from '@/lib/feed/share-image';
import type { FeedItem } from '@/lib/feed/project';

type Style = 'photo' | 'transparent';

interface Props {
  item: FeedItem;
  onClose: () => void;
}

export function FeedShareSheet({ item, onClose }: Props) {
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

  // Re-render whenever the style or the chosen photo changes. The cleanup revokes
  // the previous object URL, so switching styles repeatedly doesn't leak blobs.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setRendering(true);
    setError(null);
    setNotice(null);

    renderShareCard(item, { background: photo, transparent: style === 'transparent', template })
      .then(blob => {
        if (cancelled) return;
        blobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        setRendering(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('לא הצלחנו ליצור את התמונה');
        setRendering(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item, photo, style, template]);

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
            ? 'התמונה נשמרה. פתח אינסטגרם והוסף אותה כמדבקה מגלריית התמונות'
            : 'התמונה נשמרה למכשיר',
        );
      } else {
        onClose();
      }
    } catch {
      setError('השיתוף נכשל');
    } finally {
      setBusy(false);
    }
  }, [busy, item.id, style, onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full bg-slate-800 rounded-t-2xl border-t border-slate-700 flex flex-col"
        style={{ maxHeight: '92vh', paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle + header */}
        <div className="flex-none pt-2 pb-3 px-5 border-b border-slate-700/60">
          <div className="w-9 h-1.5 rounded-full bg-slate-600 mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-white">שתף את הריצה</span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              aria-label="סגור"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {/* Layout picker */}
          <div className="flex gap-2 mb-2.5">
            {SHARE_TEMPLATES.map(t => (
              <button
                key={t.key}
                onClick={() => setTemplate(t.key)}
                className={cn(
                  'flex-1 py-2 rounded-xl text-sm font-semibold transition-colors',
                  template === t.key
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-900/60 text-slate-400 hover:text-slate-200',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Background picker — orthogonal to the layout above. */}
          <div className="flex gap-2 mb-4">
            {([
              { key: 'photo', label: 'רקע תמונה' },
              { key: 'transparent', label: 'מדבקה שקופה' },
            ] as const).map(o => (
              <button
                key={o.key}
                onClick={() => setStyle(o.key)}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                  style === o.key
                    ? 'border-primary-500 text-primary-300 bg-primary-600/10'
                    : 'border-slate-700 text-slate-500 hover:text-slate-300',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* 9:16 preview. The checkerboard makes alpha visible for the sticker
              variant — on the sheet's dark panel it would look like a black card. */}
          <div
            className="relative mx-auto rounded-xl overflow-hidden border border-slate-700"
            style={{
              aspectRatio: '9 / 16',
              maxHeight: '46vh',
              width: 'auto',
              backgroundColor: '#334155',
              backgroundImage:
                style === 'transparent'
                  ? 'linear-gradient(45deg,#475569 25%,transparent 25%),linear-gradient(-45deg,#475569 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#475569 75%),linear-gradient(-45deg,transparent 75%,#475569 75%)'
                  : undefined,
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0,0 10px,10px -10px,-10px 0px',
            }}
          >
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="תצוגה מקדימה" className="w-full h-full object-contain" />
            )}
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50">
                <Loader2 className="h-6 w-6 text-primary-400 animate-spin" />
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
                className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900/60 text-slate-300 text-sm font-medium hover:bg-slate-900 transition-colors"
              >
                <ImagePlus className="h-4 w-4" />
                {photo ? 'החלף תמונת רקע' : 'הוסף תמונת רקע'}
              </button>
            </>
          )}

          {style === 'transparent' && (
            <p className="mt-4 text-xs text-slate-500 leading-relaxed text-center">
              שמור את התמונה, ואז באינסטגרם הוסף אותה לסטורי כמדבקה מגלריית התמונות.
              אינסטגרם לא מאפשר להדביק תמונה ישירות לעורך הסטורי.
            </p>
          )}

          {notice && <p className="mt-3 text-xs text-accent-400 text-center">{notice}</p>}
          {error && <p className="mt-3 text-xs text-red-400 text-center">{error}</p>}
        </div>

        {/* Share button */}
        <div className="flex-none px-5 pt-2 pb-4 border-t border-slate-700/60">
          <button
            onClick={handleShare}
            disabled={rendering || busy || !previewUrl}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all active:scale-[0.98]',
              rendering || busy || !previewUrl
                ? 'bg-slate-700 text-slate-500'
                : 'bg-primary-600 text-white',
            )}
          >
            {busy
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <Share2 className="h-5 w-5" />}
            שתף
          </button>
        </div>
      </div>
    </div>
  );
}
