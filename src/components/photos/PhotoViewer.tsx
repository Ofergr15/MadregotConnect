'use client';

/**
 * Full-screen photo viewer (photos module): swipe or arrow-key between photos, a
 * counter, save and share, and a filmstrip of the neighbours. Pure presentation —
 * the folder page hands it the photos and the index.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Download, Share2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ViewerPhoto { id: string; thumb: string | null; full: string | null }

export function PhotoViewer({ photos, index, title, onClose }: {
  photos: ViewerPhoto[];
  index: number;
  title: string;
  onClose: () => void;
}) {
  const t = useTranslations('photosPage');
  const [i, setI] = useState(index);
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const filmRef = useRef<HTMLDivElement>(null);
  const go = useCallback((d: number) => setI((v) => Math.min(photos.length - 1, Math.max(0, v + d))), [photos.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // RTL: the next photo is to the LEFT.
      if (e.key === 'ArrowLeft') go(1);
      if (e.key === 'ArrowRight') go(-1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [go, onClose]);

  useEffect(() => {
    filmRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [i]);

  // The neighbours' full-size images load while this one is looked at, so a swipe
  // lands on a photo that is already there instead of starting its download then.
  // Held in a ref: an Image nobody references can be collected mid-download.
  const preloaded = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    for (const d of [1, -1, 2]) {
      const p = photos[i + d];
      if (!p?.full || preloaded.current.has(p.full)) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = p.full;
      preloaded.current.set(p.full, img);
    }
  }, [i, photos]);
  // Which full-size images are on screen: until one is, its thumbnail (already in the
  // cache from the grid) stands in, so the viewer is never blank between photos.
  const [shown, setShown] = useState<Set<string>>(() => new Set());

  const photo = photos[i];
  const share = async () => {
    if (!photo?.full) return;
    try {
      const blob = await (await fetch(photo.full)).blob();
      const file = new File([blob], `madregot-${photo.id}.jpg`, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
      else window.open(photo.full, '_blank');
    } catch { /* cancelled */ }
  };

  if (typeof document === 'undefined' || !photo) return null;
  return createPortal(
    <div className="fixed inset-0 z-[2000] flex flex-col bg-black text-white" role="dialog" aria-label={title}>
      <div className="flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <button onClick={onClose} aria-label={t('close')} className="grid h-11 w-11 place-items-center rounded-full bg-white/15"><X className="h-5 w-5" /></button>
        <bdi dir="ltr" className="text-sm font-bold tabular-nums">{i + 1} / {photos.length}</bdi>
        <button onClick={share} aria-label={t('share')} className="grid h-11 w-11 place-items-center rounded-full bg-white/15"><Share2 className="h-[18px] w-[18px]" /></button>
      </div>

      <div
        className="relative flex flex-1 touch-pan-y select-none items-center justify-center overflow-hidden"
        onPointerDown={(e) => { start.current = e.clientX; }}
        onPointerMove={(e) => { if (start.current != null) setDx(e.clientX - start.current); }}
        onPointerUp={() => {
          // RTL: swiping right brings the next photo in from the left side.
          if (dx > 60) go(1); else if (dx < -60) go(-1);
          start.current = null; setDx(0);
        }}
        onPointerCancel={() => { start.current = null; setDx(0); }}
      >
        <div className="absolute inset-0 transition-transform duration-75" style={{ transform: `translateX(${dx}px)` }}>
          {photo.thumb && !(photo.full && shown.has(photo.full)) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={`t-${photo.id}`} src={photo.thumb} alt="" draggable={false} decoding="async" className="absolute inset-0 h-full w-full object-contain" />
          )}
          {photo.full && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.id}
              src={photo.full}
              alt=""
              draggable={false}
              decoding="async"
              onLoad={() => setShown((prev) => (prev.has(photo.full!) ? prev : new Set(prev).add(photo.full!)))}
              className={cn('absolute inset-0 h-full w-full object-contain', shown.has(photo.full) ? 'opacity-100' : 'opacity-0')}
            />
          )}
        </div>
        {i < photos.length - 1 && (
          <button onClick={() => go(1)} aria-label={t('next')} className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 sm:grid"><ChevronLeft className="h-6 w-6" /></button>
        )}
        {i > 0 && (
          <button onClick={() => go(-1)} aria-label={t('prev')} className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 sm:grid"><ChevronRight className="h-6 w-6" /></button>
        )}
      </div>

      <div className="px-3 pb-[max(env(safe-area-inset-bottom),16px)]">
        <a
          href={photo.full || '#'}
          download={`madregot-${photo.id}.jpg`}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/15 text-sm font-bold"
        >
          <Download className="h-[18px] w-[18px]" />{t('save')}
        </a>
        <div ref={filmRef} className="mt-3 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]">
          {photos.map((p, k) => (
            <button key={p.id} data-i={k} onClick={() => setI(k)} className="shrink-0" aria-label={t('photoN', { n: k + 1 })}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb || ''} alt="" loading="lazy" className={cn('h-11 w-11 rounded-lg object-cover', k === i ? 'opacity-100 ring-2 ring-white' : 'opacity-50')} />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
