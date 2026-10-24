'use client';

/**
 * ONE VIEWER FOR A SESSION'S PHOTOS AND VIDEOS (Ofer, 10-23: "photos go left-right with a
 * strip below, videos up-down — one version that fits everything, with a small strip below";
 * mockup ~/.cache/madregot/mockups/photos-unified-viewer.html, option א, chosen).
 *
 *  - One track, left-right, in the order things were SHOT — photos and videos mixed, so the
 *    05:00 dark is first and the finish last. Like the phone's own gallery.
 *  - The strip below is the session's timeline: a thumbnail per item, a video as wide as it
 *    is long (with its length), half-hour marks under it, the moment on screen in the middle.
 *    A tap jumps; a drag runs through the whole session.
 *  - "הכל · תמונות · סרטונים" at the top filters the track without leaving.
 *  - A photo: pinch, double tap, pan while zoomed (the photo viewer's mechanics, kept).
 *  - A video: plays the moment it lands, muted (🔊 at the top, kept while swiping); the ones
 *    either side are already holding their opening (components/photos/video-slide).
 *  - Pull down closes; one tap hides the chrome (on a photo) or pauses (on a video).
 *
 * The finger writes transforms straight to the DOM (refs), never React state, so a gesture
 * costs no re-render per frame; the track is the browser's own scroll with snap.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Download, Image as ImageIcon, Loader2, Play, Share2, Volume2, VolumeX, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress, VideoSlide, clock, report, tapTimeOf, type SlideMode, type ViewerVideo } from './video-slide';

export interface ViewerPhoto {
  id: string;
  thumb: string | null;
  full: string | null;
  /** The copy's tiny inline preview (lib/photos/mirror.ts), when there is one. */
  blur?: string | null;
  w?: number | null;
  h?: number | null;
}

/** When it was shot (an ISO instant), for the order and the strip's marks. */
type Shot = { t?: string | null };
export type MediaItem = (({ kind: 'photo' } & ViewerPhoto) | ({ kind: 'video' } & ViewerVideo)) & Shot;
export type MediaFilter = 'all' | 'photos' | 'videos';

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 280;
const CLOSE_PULL_PX = 120;
/** Slides further than this from the one on screen render empty boxes (memory). */
const RENDER_AROUND = 2;
/** The swipe has settled: `scrollend` where the browser has it, else this long without a scroll. */
const SETTLE_MS = 90;

const hhmm = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false });
};

function PhotoSlide({ p, active }: { p: ViewerPhoto; active: boolean }) {
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
        <img src={p.full} alt="" draggable={false} decoding="async" onLoad={() => setLoaded(true)}
          className={cn('absolute inset-0 h-full w-full object-contain transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')} />
      )}
    </div>
  );
}

export function MediaViewer({ items, startId, title, onClose, from, filter: startFilter = 'all', onShareFolder, onCover }: {
  /** The session, photos and videos, in the order they were shot. */
  items: MediaItem[];
  startId: string;
  title: string;
  onClose: () => void;
  /** The tapped tile, so the item can grow out of it. */
  from?: DOMRect | null;
  /** Where the page's own "הכל · תמונות · סרטונים" stood. */
  filter?: MediaFilter;
  /** A video's share: the folder's link (a video file is too big to hand over). */
  onShareFolder?: () => void;
  /** The admin's only: this photo or video's frame becomes the folder's cover. */
  onCover?: (id: string) => void;
}) {
  const t = useTranslations('photosPage');
  const hasBoth = items.some((x) => x.kind === 'photo') && items.some((x) => x.kind === 'video');
  const [filter, setFilter] = useState<MediaFilter>(hasBoth ? startFilter : 'all');
  const list = useMemo(() => (filter === 'all' ? items : items.filter((x) => (filter === 'photos' ? x.kind === 'photo' : x.kind === 'video'))), [items, filter]);
  const startIndex = Math.max(0, list.findIndex((x) => x.id === startId));

  // `i` follows the finger (the strip, the title); `cur` is where the swipe SETTLED — what
  // plays. Changing what plays on every pixel restarted videos mid-swipe.
  const [i, setI] = useState(startIndex);
  const [cur, setCur] = useState(startIndex);
  const iRef = useRef(startIndex);
  iRef.current = i;
  const curRef = useRef(startIndex);
  const listRef = useRef(list);
  listRef.current = list;
  const [chrome, setChrome] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [opening, setOpening] = useState<null | { src: string; style: React.CSSProperties; at: 'from' | 'to' }>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);

  // ── the video on screen: sound, pause, buffering ───────────────────────────────
  const [muted, setMuted] = useState(true);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const [paused, setPaused] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [failed, setFailed] = useState(false);
  const [playingEl, setPlayingEl] = useState<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const slideEl = (k: number) => trackRef.current?.querySelector<HTMLElement>(`[data-slide="${k}"]`) ?? null;
  // By position, not scrollIntoView: after the list changes (the filter) the browser re-snaps
  // the track by itself and undid a scrollIntoView (it landed on 0, the photo black). Set,
  // and set again a frame later, after that re-snap. RTL: positions run 0 → negative.
  const go = useCallback((k: number, instant = false) => {
    const el = trackRef.current;
    if (!el) return;
    const n = Math.min(listRef.current.length - 1, Math.max(0, k));
    const left = -n * el.clientWidth;
    if (instant) {
      el.scrollTo({ left, behavior: 'instant' as ScrollBehavior });
      requestAnimationFrame(() => { if (Math.abs(el.scrollLeft - left) > 2) el.scrollTo({ left, behavior: 'instant' as ScrollBehavior }); });
    } else el.scrollTo({ left, behavior: 'smooth' });
  }, []);

  // ── the measurement (api/photos/video-timing): finger → a video's first frame ───
  const gestureAt = useRef<number | null>(null);
  const startRef = useRef<{ id: string | null; at: number; how: 'open' | 'swipe'; sent: boolean }>({ id: null, at: 0, how: 'open', sent: false });
  const stats = useRef({ firstAt: 0, stalls: 0, stallMs: 0, stallStart: null as number | null });
  const leave = useCallback(() => {
    const s = startRef.current, st = stats.current, el = videoRef.current;
    if (!s.sent || !s.id) return;
    if (st.stallStart != null) st.stallMs += performance.now() - st.stallStart;
    report({ event: 'leave', id: s.id, how: s.how, watchedS: el?.currentTime ?? 0, stalls: st.stalls, stallMs: st.stallMs });
    s.sent = false; s.id = null;
  }, []);
  const onFirstFrame = useCallback((id: string, el: HTMLVideoElement, preloaded: boolean, copy: boolean) => {
    const s = startRef.current;
    if (s.id !== id || s.sent) return;
    s.sent = true;
    stats.current = { firstAt: performance.now(), stalls: 0, stallMs: 0, stallStart: null };
    report({ event: 'start', id, how: s.how, path: copy ? 'copy' : 'original', firstFrameMs: performance.now() - s.at, preloaded, height: el.videoHeight });
  }, []);
  const onWait = useCallback((w: boolean) => {
    setWaiting(w);
    const st = stats.current, now = performance.now();
    if (!st.firstAt) return;
    if (w && st.stallStart == null) { st.stallStart = now; st.stalls++; }
    else if (!w && st.stallStart != null) { st.stallMs += now - st.stallStart; st.stallStart = null; }
  }, []);
  useEffect(() => () => leave(), [leave]);

  /** The swipe landed on `k`: it is what plays now. */
  const settleOn = useCallback((k: number, how: 'open' | 'swipe') => {
    const at = gestureAt.current;
    gestureAt.current = null;
    if (how === 'swipe' && k === curRef.current) return;
    leave();
    const x = listRef.current[k];
    startRef.current = { id: x?.kind === 'video' ? x.id : null, at: how === 'open' ? (tapTimeOf(x?.id ?? '') ?? performance.now()) : (at ?? performance.now()), how, sent: false };
    curRef.current = k;
    setPaused(false); setWaiting(true); setFailed(false);
    if (x?.kind !== 'video') { videoRef.current = null; setPlayingEl(null); }
    setCur(k);
  }, [leave]);

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

  // ── open: onto the tapped item, growing out of its tile ────────────────────────
  useLayoutEffect(() => {
    go(startIndex, true);
    settleOn(startIndex, 'open');
    const p = list[startIndex], stage = stageRef.current?.getBoundingClientRect();
    if (!from || !p?.thumb || !stage) return;
    const ar = p.kind === 'photo' && p.w && p.h ? p.w / p.h : p.kind === 'video' ? 9 / 16 : 1;
    const w = Math.min(stage.width, stage.height * ar), h = w / ar;
    const target = { left: stage.left + (stage.width - w) / 2, top: stage.top + (stage.height - h) / 2, width: w, height: h };
    setOpening({ src: p.thumb, at: 'from', style: { left: from.left, top: from.top, width: from.width, height: from.height } });
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setOpening({ src: p.thumb!, at: 'to', style: target })));
    const done = setTimeout(() => setOpening(null), 300);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  // The filter changed: stay on the same moment — the item itself, or the nearest one shot after it.
  // `lastId` is the item on screen as of the last commit (not this render's: with a new list
  // and the old index, this render would read a different item).
  const lastId = useRef(startId);
  useEffect(() => { if (list[i]) lastId.current = list[i].id; }, [i, list]);
  const filterRef = useRef(filter);
  useLayoutEffect(() => {
    if (filterRef.current === filter) return;
    filterRef.current = filter;
    const was = items.find((x) => x.id === lastId.current);
    let k = list.findIndex((x) => x.id === was?.id);
    if (k < 0) k = Math.max(0, list.findIndex((x) => (x.t || '') >= (was?.t || '')));
    if (k < 0 || k >= list.length) k = Math.max(0, list.length - 1);
    iRef.current = k; setI(k);
    go(k, true);
    curRef.current = -1;
    settleOn(k, 'swipe');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on a filter change only
  }, [list]);

  // ── which slide is in view, from the track's own scroll ────────────────────────
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const at = () => Math.round(Math.abs(el.scrollLeft) / Math.max(1, el.clientWidth)); // RTL: 0 into negative numbers
    const landed = () => { if (settle) clearTimeout(settle); settle = null; const k = at(); if (k >= 0 && k < listRef.current.length) settleOn(k, 'swipe'); };
    const onScroll = () => {
      gestureAt.current ??= performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const k = at();
        if (k !== iRef.current && k >= 0 && k < listRef.current.length) {
          z.current = { s: 1, x: 0, y: 0 };
          apply(false);
          setI(k);
        }
      });
      if (settle) clearTimeout(settle);
      settle = setTimeout(landed, SETTLE_MS);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', landed);
    return () => { el.removeEventListener('scroll', onScroll); el.removeEventListener('scrollend', landed); cancelAnimationFrame(raf); if (settle) clearTimeout(settle); };
  }, [apply, settleOn]);

  // ── keys, and the page behind ──────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // RTL: the next one is to the LEFT.
      if (e.key === 'ArrowLeft') go(iRef.current + 1);
      if (e.key === 'ArrowRight') go(iRef.current - 1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [go, onClose]);

  // The neighbouring photos' full sizes load while this one is looked at. Held in a ref: an
  // Image nobody references can be collected mid-download.
  const preloaded = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    for (const d of [1, -1, 2]) {
      const p = list[i + d];
      if (p?.kind !== 'photo' || !p.full || preloaded.current.has(p.full)) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = p.full;
      preloaded.current.set(p.full, img);
    }
  }, [i, list]);

  // ── gestures on the stage: pinch (a photo), zoomed pan, pull down to close ─────
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
    const isPhoto = () => listRef.current[iRef.current]?.kind === 'photo';
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
      if (a.length === 2 && isPhoto()) { pinch = { d: dist(a), m: mid(a) }; pan = null; pull = null; return; }
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
      if (!e.ctrlKey || !isPhoto()) return;
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

  // ── the video on screen ────────────────────────────────────────────────────────
  const onActive = useCallback((el: HTMLVideoElement) => {
    videoRef.current = el;
    setPlayingEl(el);
    el.muted = mutedRef.current;
    // A copy is attached a moment later (hls.js loads lazily): play once it can, not "paused".
    void el.play().catch(() => {
      el.addEventListener('canplay', () => { void el.play().catch(() => setPaused(true)); }, { once: true });
    });
  }, []);
  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { if (el.ended) el.currentTime = 0; void el.play().catch(() => {}); setPaused(false); } else { el.pause(); setPaused(true); }
  }, []);
  const onFailed = useCallback(() => { setFailed(true); setWaiting(false); }, []);
  // The end of a video: it stays, like a photo — stopped, the play mark showing; a tap plays
  // it again. Moving on is the viewer's own swipe (Ofer, 10-24: "not to the next video —
  // like a photo, we decide when to move").
  const onEnded = useCallback(() => { setPaused(true); }, []);

  // One tap: on a photo, shows/hides the chrome (two zoom at the point); on a video, the
  // video's own tap pauses it.
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onTap = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button,a')) return;
    if (list[i]?.kind === 'video') return;
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

  // Clamped: on a filter change this render has the new (shorter) list and the old index;
  // an empty item here unmounted the whole viewer for a frame and the track came back at 0.
  const item = list[Math.min(i, list.length - 1)];
  const playing = list[cur];
  const sharePhoto = async (p: ViewerPhoto) => {
    if (!p.full) return;
    try {
      const blob = await (await fetch(p.full)).blob();
      const file = new File([blob], `madregot-${p.id}.jpg`, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
      else window.open(p.full, '_blank');
    } catch { /* cancelled */ }
  };

  if (typeof document === 'undefined' || !item) return null;
  const isVideo = item.kind === 'video';
  const saveHref = item.kind === 'photo' ? item.full : item.src ? `${item.src}&dl=1` : null;
  // Hidden by a tap, and while the item grows out of its tile (they fade in with the black).
  const chromeCls = cn('transition-opacity duration-200', (!chrome || opening) && 'pointer-events-none opacity-0');
  const counted = list.filter((x) => x.kind === item.kind).indexOf(item) + 1;
  return createPortal(
    <div className="fixed inset-0 z-[2000] text-white" role="dialog" aria-modal="true" aria-label={title} dir="rtl">
      <div ref={bgRef} className={cn('absolute inset-0 bg-black transition-opacity duration-300', opening?.at === 'from' ? 'opacity-0' : 'opacity-100')} />

      <div ref={stageRef} onClick={onTap} className={cn('absolute inset-0 select-none overflow-hidden', opening && 'opacity-0')}>
        <div
          ref={trackRef}
          // Native snap + momentum; while zoomed the track stops paging and the finger pans.
          className={cn(
            'absolute inset-0 flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            zoomed ? 'touch-none overflow-x-hidden' : 'snap-x snap-mandatory overflow-x-auto overscroll-x-contain [touch-action:pan-x]',
          )}
        >
          {list.map((x, k) => {
            const near = Math.abs(k - i) <= RENDER_AROUND || Math.abs(k - cur) <= RENDER_AROUND;
            const mode: SlideMode = k === cur ? 'play' : Math.abs(k - cur) === 1 ? 'ready' : Math.abs(k - cur) === 2 ? 'poster' : 'none';
            return (
              <div key={x.id} data-slide={k} className="relative h-full w-full flex-none snap-center snap-always overflow-hidden">
                {near && (x.kind === 'photo'
                  ? <PhotoSlide p={x} active={k === i} />
                  : <VideoSlide x={x} k={k} mode={mode} muted={k === cur ? muted : true} onActive={onActive} onTap={togglePlay}
                      onWaiting={onWait} onFailed={onFailed} onEnded={onEnded} onFirstFrame={onFirstFrame} />)}
              </div>
            );
          })}
        </div>
        {i < list.length - 1 && (
          <button onClick={() => go(i + 1)} aria-label={t('next')} className={cn(chromeCls, 'absolute left-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 sm:grid')}><ChevronLeft className="h-6 w-6" /></button>
        )}
        {i > 0 && (
          <button onClick={() => go(i - 1)} aria-label={t('prev')} className={cn(chromeCls, 'absolute right-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 sm:grid')}><ChevronRight className="h-6 w-6" /></button>
        )}
      </div>

      {/* The video's state — drawn icons, never the ▶ character (an emoji on iOS). */}
      {playing?.kind === 'video' && cur === i && (
        <>
          {waiting && !failed && !paused && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center"><Loader2 className="h-10 w-10 animate-spin text-white/90 drop-shadow" /></div>
          )}
          {paused && !failed && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
              <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-black/45"><Play className="ms-1 h-8 w-8 text-white" fill="currentColor" strokeWidth={0} /></span>
            </div>
          )}
          {failed && playing.src && (
            <div className="absolute inset-x-8 top-1/2 z-10 -translate-y-1/2 rounded-3xl bg-black/75 p-5 text-center">
              <p className="text-[15px] font-bold leading-snug">אי אפשר לנגן את הסרטון הזה בטלפון הזה</p>
              <a href={`${playing.src}&dl=1`} download className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white px-5 text-[14px] font-extrabold text-ink-900"><Download className="h-4 w-4" />להוריד</a>
            </div>
          )}
        </>
      )}

      {/* Top: close, where in the session, sound (a video) — and the filter. No frosted glass
          over a playing video (an iPhone redraws a backdrop blur every frame). */}
      {/* Touches pass through the bar to the track; only its buttons take them. */}
      <div className={cn(chromeCls, 'pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/50 to-transparent px-3 pb-6 pt-[max(env(safe-area-inset-top),12px)] [&_button]:pointer-events-auto')}>
        <div className="flex items-center justify-between">
          <button onClick={onClose} aria-label={t('close')} className="grid h-11 w-11 place-items-center rounded-full bg-black/40"><X className="h-5 w-5" /></button>
          <div className="min-w-0 px-2 text-center leading-tight">
            <b className="block truncate text-[14px] font-extrabold" dir="auto">{title}</b>
            <span className="text-[12px] opacity-80"><bdi dir="ltr">{hhmm(item.t)}</bdi>{item.t ? ' · ' : ''}{isVideo ? 'סרטון' : 'תמונה'} <bdi dir="ltr">{counted}</bdi> מתוך <bdi dir="ltr">{list.filter((x) => x.kind === item.kind).length}</bdi></span>
          </div>
          {isVideo ? (
            <button type="button" onClick={() => { const next = !muted; setMuted(next); const el = videoRef.current; if (el) { el.muted = next; if (el.paused) void el.play().catch(() => {}); } }}
              aria-label={muted ? 'להפעיל קול' : 'להשתיק'}
              className={cn('grid h-11 w-11 place-items-center rounded-full', muted ? 'bg-white text-ink-900' : 'bg-black/40')}>
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
          ) : <span className="h-11 w-11" />}
        </div>
        {hasBoth && (
          <div className="mt-2 flex justify-center">
            <div className="flex gap-0.5 rounded-full bg-black/40 p-[3px]" role="tablist">
              {([['all', 'הכל'], ['photos', 'תמונות'], ['videos', 'סרטונים']] as const).map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={filter === v} onClick={() => setFilter(v)}
                  className={cn('min-h-[32px] rounded-full px-3.5 text-[12.5px] font-extrabold', filter === v ? 'bg-white text-ink-900' : 'text-white/80')}>{label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* The side: save (the original, full quality), share, the cover (the admin's). */}
      <div className={cn(chromeCls, 'absolute bottom-[calc(env(safe-area-inset-bottom)+128px)] start-3 z-20 flex flex-col items-center gap-3.5 text-[11px] font-bold')}>
        {saveHref && (
          <a href={saveHref} download={item.kind === 'photo' ? `madregot-${item.id}.jpg` : true} aria-label={t('save')} className="flex flex-col items-center gap-1">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/40"><Download className="h-5 w-5" /></span>{t('save')}
          </a>
        )}
        {(item.kind === 'photo' || onShareFolder) && (
          <button type="button" onClick={() => { if (item.kind === 'photo') void sharePhoto(item); else onShareFolder?.(); }} className="flex flex-col items-center gap-1">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/40"><Share2 className="h-5 w-5" /></span>{t('share')}
          </button>
        )}
        {onCover && (
          <button type="button" onClick={() => onCover(item.id)} className="flex flex-col items-center gap-1">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/40"><ImageIcon className="h-5 w-5" /></span>שער
          </button>
        )}
      </div>

      {/* Bottom: the video's progress, and the session's timeline. */}
      <div className={cn(chromeCls, 'absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/60 to-transparent pb-[max(env(safe-area-inset-bottom),14px)] pt-8')}>
        {isVideo && cur === i && <div className="px-4 pb-2"><Progress key={item.id} el={playingEl} ms={item.ms ?? null} /></div>}
        <Timeline list={list} i={i} onJump={go} />
      </div>

      {opening && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={opening.src} alt="" className="pointer-events-none fixed z-30 object-cover transition-all duration-[280ms] ease-[cubic-bezier(.2,.8,.2,1)]" style={opening.style} />
      )}
    </div>,
    document.body,
  );
}

/** A thumbnail's width on the strip: a photo square-ish, a video as wide as it is long. */
const thumbW = (x: MediaItem) => (x.kind === 'video' ? Math.round(Math.max(30, Math.min(70, 22 + ((x.ms ?? 0) / 1000) * 1.6))) : 30);
const GAP = 3;

/**
 * THE SESSION'S TIMELINE — the small strip below (mockup option א). The item on screen sits
 * under the line in the middle. A tap jumps to an item; a drag runs through the session,
 * the track following the item under the line. Half-hour marks ride under the thumbnails.
 * Positions are computed from the widths (no layout reads per scroll frame).
 */
function Timeline({ list, i, onJump }: { list: MediaItem[]; i: number; onJump: (k: number, instant?: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each item's centre from the rail's start (the right edge, RTL), and the marks.
  const { centers, total, marks } = useMemo(() => {
    const centers: number[] = [];
    const marks: Array<{ at: number; label: string }> = [];
    let x = 0, lastHalf = '';
    list.forEach((it, k) => {
      const w = thumbW(it);
      centers.push(x + w / 2);
      const hm = hhmm(it.t);
      if (hm) {
        const half = `${hm.slice(0, 2)}:${Number(hm.slice(3, 5)) < 30 ? '00' : '30'}`;
        if (half !== lastHalf) { marks.push({ at: x + w / 2, label: half }); lastHalf = half; }
      }
      x += w + (k < list.length - 1 ? GAP : 0);
    });
    return { centers, total: x, marks };
  }, [list]);
  /** Where the middle of the strip is, from the rail's start. RTL scrollLeft runs 0 → negative. */
  const middle = () => { const el = ref.current; return el ? -el.scrollLeft : 0; };
  const nearest = (pos: number) => {
    let lo = 0, hi = centers.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (centers[m] < pos) lo = m + 1; else hi = m; }
    return lo > 0 && Math.abs(centers[lo - 1] - pos) < Math.abs(centers[lo] - pos) ? lo - 1 : lo;
  };
  // The item on screen comes to the middle — unless the finger is the one moving the strip.
  useEffect(() => {
    const el = ref.current;
    if (!el || scrubbing.current || centers[i] == null) return;
    el.scrollTo({ left: -centers[i], behavior: 'smooth' });
  }, [i, centers]);
  // A new list (the filter): straight to the item, no slide across the whole strip.
  const iNow = useRef(i);
  iNow.current = i;
  useLayoutEffect(() => { const el = ref.current; if (el && centers[iNow.current] != null) el.scrollTo({ left: -centers[iNow.current] }); }, [centers]);
  const onScroll = () => {
    if (!scrubbing.current) return;
    const k = nearest(middle());
    onJump(k, true);
    if (idle.current) clearTimeout(idle.current);
    // The finger let go and the strip stopped: the item it stopped on, back in the middle.
    idle.current = setTimeout(() => { scrubbing.current = false; ref.current?.scrollTo({ left: -centers[k], behavior: 'smooth' }); }, 160);
  };
  const grab = () => { scrubbing.current = true; if (idle.current) clearTimeout(idle.current); };
  return (
    <div className="relative" dir="rtl">
      <div ref={ref} onScroll={onScroll} onTouchStart={grab} onPointerDown={grab} onWheel={grab}
        className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="relative h-[60px]" style={{ width: `calc(${total}px + 100%)`, paddingInline: '50%' }}>
          <div className="relative flex h-[42px] items-center" style={{ gap: GAP, width: total }}>
            {list.map((x, k) => (
              <button key={x.id} type="button" onClick={() => { scrubbing.current = false; onJump(k); }} aria-label={`${x.kind === 'video' ? 'סרטון' : 'תמונה'} ${k + 1}`}
                className={cn('relative h-[36px] flex-none overflow-hidden rounded-[7px] bg-white/10 transition-[transform,opacity] duration-150', k === i ? 'z-[1] scale-110 opacity-100 ring-2 ring-white' : 'opacity-60')}
                style={{ width: thumbW(x) }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {x.thumb && <img src={x.thumb} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />}
                {x.kind === 'video' && (
                  <>
                    <Play className="absolute start-[3px] top-[3px] h-2.5 w-2.5 text-white drop-shadow" fill="currentColor" strokeWidth={0} />
                    <span className="absolute bottom-px end-[3px] text-[9px] font-extrabold text-white [text-shadow:0_0_3px_#000]" dir="ltr">{clock(Math.round((x.ms ?? 0) / 1000))}</span>
                  </>
                )}
              </button>
            ))}
          </div>
          <div className="relative h-[16px]" style={{ width: total }}>
            {marks.map((m) => (
              <span key={`${m.label}-${m.at}`} className="absolute top-0.5 translate-x-1/2 text-[10.5px] font-bold text-white/75" style={{ right: m.at }} dir="ltr">{m.label}</span>
            ))}
          </div>
        </div>
      </div>
      {/* The line in the middle: the moment on screen. */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[44px] w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(0,0,0,.5)]" />
    </div>
  );
}
