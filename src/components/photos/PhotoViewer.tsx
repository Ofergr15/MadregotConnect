'use client';

/**
 * Full-screen photo viewer (photos module), made to feel like the phone's own
 * gallery (Ofer, 2026-10-19: "not smooth, not pretty"; mockup
 * ~/.cache/madregot/mockups/photos-viewer-v2.html):
 *
 *  - a real track of slides with native snap and momentum, so the next photo comes
 *    in with the finger instead of replacing the one on screen past a threshold;
 *  - pinch to zoom around the fingers, pan while zoomed (a zoomed swipe pans, never
 *    pages), double tap zooms at the tapped point and back;
 *  - drag down to close, the black fading as it goes; one tap hides the chrome;
 *  - opening grows the tapped tile into place;
 *  - every slide shows its blurred preview and thumbnail at once, the full size on
 *    top when it lands, and the neighbours' full sizes preload.
 *
 * Finger movement writes transforms straight to the DOM (refs), never through React
 * state, so a gesture costs no re-render per frame. Pure presentation — the folder
 * page hands it the photos, the index and (optionally) the tapped tile's rect.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Download, Share2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ViewerPhoto {
  id: string;
  thumb: string | null;
  full: string | null;
  /** The copy's tiny inline preview (lib/photos/mirror.ts), when there is one. */
  blur?: string | null;
  w?: number | null;
  h?: number | null;
}

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 280;
const CLOSE_PULL_PX = 120;
/** Slides further than this from the current one render empty boxes (memory). */
const RENDER_AROUND = 2;

function Slide({ p, active }: { p: ViewerPhoto; active: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div data-zoom={active ? '' : undefined} className="absolute inset-0 origin-top-left will-change-transform">
      {p.blur && (
        <div className="absolute inset-0 scale-110 bg-contain bg-center bg-no-repeat blur-lg" style={{ backgroundImage: `url(${p.blur})` }} />
      )}
      {p.thumb && !loaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.thumb} alt="" draggable={false} decoding="async" className="absolute inset-0 h-full w-full object-contain" />
      )}
      {p.full && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.full}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn('absolute inset-0 h-full w-full object-contain transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  );
}

export function PhotoViewer({ photos, index, title, onClose, from }: {
  photos: ViewerPhoto[];
  index: number;
  title: string;
  onClose: () => void;
  /** The tapped tile, so the photo can grow out of it. */
  from?: DOMRect | null;
}) {
  const t = useTranslations('photosPage');
  const [i, setI] = useState(index);
  const iRef = useRef(index);
  iRef.current = i;
  const [chrome, setChrome] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  // The tapped tile growing into place: 'from' (on the tile), then 'to' (in place).
  const [opening, setOpening] = useState<null | { src: string; style: React.CSSProperties; at: 'from' | 'to' }>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<HTMLDivElement>(null);

  const slideEl = (k: number) => trackRef.current?.querySelector<HTMLElement>(`[data-slide="${k}"]`) ?? null;
  const go = useCallback((k: number) => {
    const n = Math.min(photos.length - 1, Math.max(0, k));
    trackRef.current?.querySelector<HTMLElement>(`[data-slide="${n}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [photos.length]);

  // ── zoom (refs only; React hears about it once, when it crosses "zoomed") ──────
  const z = useRef({ s: 1, x: 0, y: 0 });
  const apply = useCallback((anim: boolean) => {
    const el = trackRef.current?.querySelector<HTMLElement>(`[data-slide="${iRef.current}"] [data-zoom]`);
    if (el) {
      el.style.transition = anim ? 'transform 250ms cubic-bezier(.2,.8,.2,1)' : 'none';
      el.style.transform = z.current.s === 1 ? '' : `translate(${z.current.x}px, ${z.current.y}px) scale(${z.current.s})`;
    }
    const isZoomed = z.current.s > 1.01;
    setZoomed((was) => (was === isZoomed ? was : isZoomed));
  }, []);
  const clamp = () => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    const c = z.current;
    c.s = Math.min(MAX_ZOOM, Math.max(1, c.s));
    c.x = Math.min(0, Math.max(r.width - r.width * c.s, c.x));
    c.y = Math.min(0, Math.max(r.height - r.height * c.s, c.y));
  };
  const resetZoom = useCallback(() => { z.current = { s: 1, x: 0, y: 0 }; apply(true); }, [apply]);
  /** Scale by k around the screen point (px, py): that point stays under the fingers. */
  const zoomAt = (px: number, py: number, k: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    const c = z.current, lx = px - r.left, ly = py - r.top;
    c.x = lx - (lx - c.x) * k; c.y = ly - (ly - c.y) * k; c.s *= k;
  };

  // ── open: onto the right slide, growing out of the tapped tile ─────────────────
  useLayoutEffect(() => {
    slideEl(index)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' as ScrollBehavior });
    const p = photos[index], stage = stageRef.current?.getBoundingClientRect();
    if (!from || !p?.thumb || !stage) return;
    const ar = p.w && p.h ? p.w / p.h : 1;
    const w = Math.min(stage.width, stage.height * ar), h = w / ar;
    const target = { left: stage.left + (stage.width - w) / 2, top: stage.top + (stage.height - h) / 2, width: w, height: h };
    setOpening({ src: p.thumb, at: 'from', style: { left: from.left, top: from.top, width: from.width, height: from.height } });
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setOpening({ src: p.thumb!, at: 'to', style: target })));
    const done = setTimeout(() => setOpening(null), 300);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  // ── which slide is in view, from the track's own scroll ────────────────────────
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // RTL scrolls from 0 into negative numbers; the magnitude is the position.
        const k = Math.round(Math.abs(el.scrollLeft) / Math.max(1, el.clientWidth));
        if (k !== iRef.current && k >= 0 && k < photos.length) {
          z.current = { s: 1, x: 0, y: 0 };
          apply(false);
          setI(k);
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [photos.length, apply]);

  // ── keys, the page behind, and the filmstrip ──────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // RTL: the next photo is to the LEFT.
      if (e.key === 'ArrowLeft') go(iRef.current + 1);
      if (e.key === 'ArrowRight') go(iRef.current - 1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [go, onClose]);

  useEffect(() => {
    filmRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [i]);

  // The neighbours' full sizes load while this one is looked at. Held in a ref: an
  // Image nobody references can be collected mid-download.
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

  // ── gestures on the stage: pinch, zoomed pan, pull down to close ───────────────
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    type P = { x: number; y: number };
    let pinch: { d: number; m: P } | null = null;
    let pan: P | null = null;
    let pull: { start: P; dy: number; active: boolean } | null = null;
    const pts = (e: TouchEvent) => [...e.touches].map((tt) => ({ x: tt.clientX, y: tt.clientY }));
    const mid = (a: P[]) => ({ x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 });
    const dist = (a: P[]) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    const setPull = (dy: number, anim: boolean) => {
      const el = slideEl(iRef.current);
      if (el) {
        el.style.transition = anim ? 'transform 220ms ease' : 'none';
        el.style.transform = dy ? `translateY(${dy}px) scale(${1 - Math.min(dy, 300) / 1500})` : '';
      }
      if (bgRef.current) {
        bgRef.current.style.transition = anim ? 'opacity 220ms ease' : 'none';
        bgRef.current.style.opacity = String(1 - Math.min(dy, 300) / 400);
      }
    };
    const start = (e: TouchEvent) => {
      const a = pts(e);
      if (a.length === 2) { pinch = { d: dist(a), m: mid(a) }; pan = null; pull = null; return; }
      if (a.length !== 1) return;
      if (z.current.s > 1.01) pan = a[0];
      else pull = { start: a[0], dy: 0, active: false };
    };
    const move = (e: TouchEvent) => {
      const a = pts(e);
      if (pinch && a.length === 2) {
        e.preventDefault();
        const d = dist(a), m = mid(a), c = z.current;
        c.x += m.x - pinch.m.x; c.y += m.y - pinch.m.y; // the fingers move: the photo follows
        zoomAt(m.x, m.y, d / pinch.d);                    // the fingers spread: around their midpoint
        pinch = { d, m };
        apply(false);
      } else if (pan && a.length === 1) {
        e.preventDefault();
        z.current.x += a[0].x - pan.x; z.current.y += a[0].y - pan.y;
        pan = a[0];
        clamp(); apply(false);
      } else if (pull && a.length === 1) {
        const dx = a[0].x - pull.start.x, dy = a[0].y - pull.start.y;
        if (!pull.active && dy > 12 && dy > Math.abs(dx) * 1.5) pull.active = true;
        if (pull.active) { e.preventDefault(); pull.dy = Math.max(0, dy); setPull(pull.dy, false); }
      }
    };
    const end = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) {
        pinch = null;
        if (z.current.s < 1.05) resetZoom(); else { clamp(); apply(true); }
      }
      if (pull?.active && !e.touches.length) {
        if (pull.dy > CLOSE_PULL_PX) onClose(); else setPull(0, true);
      }
      if (!e.touches.length) { pan = null; pull = null; }
    };
    // A Mac trackpad's pinch arrives as ctrl+wheel.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY / 100));
      if (z.current.s < 1) z.current = { s: 1, x: 0, y: 0 };
      clamp(); apply(false);
    };
    // iOS Safari's own page zoom would fight the photo's.
    const gesture = (e: Event) => e.preventDefault();
    stage.addEventListener('touchstart', start, { passive: true });
    stage.addEventListener('touchmove', move, { passive: false });
    stage.addEventListener('touchend', end);
    stage.addEventListener('touchcancel', end);
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('gesturestart', gesture);
    return () => {
      stage.removeEventListener('touchstart', start);
      stage.removeEventListener('touchmove', move);
      stage.removeEventListener('touchend', end);
      stage.removeEventListener('touchcancel', end);
      stage.removeEventListener('wheel', wheel);
      stage.removeEventListener('gesturestart', gesture);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs carry the state
  }, [apply, resetZoom, onClose]);

  // One tap shows/hides the chrome; two zoom at the tapped point (or back).
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onTap = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      if (z.current.s > 1.01) resetZoom();
      else { zoomAt(e.clientX, e.clientY, DOUBLE_TAP_ZOOM); clamp(); apply(true); }
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => setChrome((c) => !c), DOUBLE_TAP_MS + 10);
  };

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
  // Hidden by a tap, and while the photo grows out of its tile (they fade in with the black).
  const chromeCls = cn('relative z-10 transition-opacity duration-200', (!chrome || opening) && 'pointer-events-none opacity-0');
  return createPortal(
    <div className="fixed inset-0 z-[2000] flex flex-col text-white" role="dialog" aria-label={title}>
      <div ref={bgRef} className={cn('absolute inset-0 bg-black transition-opacity duration-300', opening?.at === 'from' ? 'opacity-0' : 'opacity-100')} />
      <div className={cn(chromeCls, 'flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2')}>
        <button onClick={onClose} aria-label={t('close')} className="grid h-11 w-11 place-items-center rounded-full bg-white/15"><X className="h-5 w-5" /></button>
        <bdi dir="ltr" className="text-sm font-bold tabular-nums">{i + 1} / {photos.length}</bdi>
        <button onClick={share} aria-label={t('share')} className="grid h-11 w-11 place-items-center rounded-full bg-white/15"><Share2 className="h-[18px] w-[18px]" /></button>
      </div>

      <div ref={stageRef} onClick={onTap} className={cn('relative flex-1 select-none overflow-hidden', opening && 'opacity-0')}>
        <div
          ref={trackRef}
          // Native snap + momentum; while zoomed the track stops paging and the finger pans.
          className={cn(
            'absolute inset-0 flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            zoomed ? 'touch-none overflow-x-hidden' : 'snap-x snap-mandatory overflow-x-auto overscroll-x-contain [touch-action:pan-x]',
          )}
        >
          {photos.map((p, k) => (
            <div key={p.id} data-slide={k} className="relative h-full w-full flex-none snap-center snap-always overflow-hidden">
              {Math.abs(k - i) <= RENDER_AROUND && <Slide p={p} active={k === i} />}
            </div>
          ))}
        </div>
        {i < photos.length - 1 && (
          <button onClick={() => go(i + 1)} aria-label={t('next')} className={cn(chromeCls, 'absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 sm:grid')}><ChevronLeft className="h-6 w-6" /></button>
        )}
        {i > 0 && (
          <button onClick={() => go(i - 1)} aria-label={t('prev')} className={cn(chromeCls, 'absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 sm:grid')}><ChevronRight className="h-6 w-6" /></button>
        )}
      </div>

      <div className={cn(chromeCls, 'px-3 pb-[max(env(safe-area-inset-bottom),16px)]')}>
        <a
          href={photo.full || '#'}
          download={`madregot-${photo.id}.jpg`}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/15 text-sm font-bold"
        >
          <Download className="h-[18px] w-[18px]" />{t('save')}
        </a>
        <div ref={filmRef} className="mt-3 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]">
          {photos.map((p, k) => (
            <button key={p.id} data-i={k} onClick={() => go(k)} className="shrink-0" aria-label={t('photoN', { n: k + 1 })}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb || ''} alt="" loading="lazy" className={cn('h-11 w-11 rounded-lg object-cover transition-[opacity,transform] duration-200', k === i ? 'scale-105 opacity-100 ring-2 ring-white' : 'opacity-50')} />
            </button>
          ))}
        </div>
      </div>

      {opening && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={opening.src}
          alt=""
          className="pointer-events-none fixed z-20 object-cover transition-all duration-[280ms] ease-[cubic-bezier(.2,.8,.2,1)]"
          style={opening.style}
        />
      )}
    </div>,
    document.body,
  );
}
