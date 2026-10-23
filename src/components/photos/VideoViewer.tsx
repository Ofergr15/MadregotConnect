'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Image as ImageIcon, Loader2, Play, Share2, Volume2, VolumeX, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBackDismiss } from '@/lib/use-back-dismiss';

/**
 * A folder's videos, full screen and vertical, like a story (mockup
 * ~/.cache/madregot/photos-videos.html, 3; Ofer 2026-10-23: "very, very efficient").
 *
 * - Swipe up / down for the next / previous one (scroll snap, no library).
 * - Only the video on screen has a <video>; every other slide is its poster, so opening a
 *   folder of 180 videos loads one; the next one's poster is already there.
 * - Muted on every open (Ofer, 10-23: "keep the volume off, turn it on at the top"); the 🔊
 *   at the top turns it on, and it stays on while swiping until the player closes.
 * - The swipe (Ofer: "very, very smooth and fast"): the slide changes when the scroll
 *   SETTLES (scrollend, or 80 ms of quiet), not on every pixel; the next video's element
 *   already exists and has read its opening (preload="metadata"), so it starts where it
 *   lands; slides are memoised, so the progress bar's updates don't redraw the list.
 * - While it buffers, a spinner over the poster; a video this phone can't play (an HEVC
 *   .mov on some Android phones and on a desktop) says so and offers the download.
 * - Tap: pause / play. The sound choice carries to the next video.
 * - Save downloads the original (full quality); share sends the folder; the admin may set
 *   the video's frame as the folder's cover.
 */

export interface ViewerVideo {
  id: string;
  thumb: string | null;
  poster: string | null;
  src: string | null;
  /** The viewing copy at Mux (lib/photos/mux), signed — preferred over the original. */
  hls?: string | null;
  /** A few moving seconds of it, shown while it starts. */
  preview?: string | null;
  ms?: number | null;
  blur?: string | null;
}

/** hls.js, loaded only when a copy has to play where the browser can't play HLS itself. */
let hlsLib: Promise<typeof import('hls.js').default> | null = null;
const loadHls = () => (hlsLib ??= import('hls.js').then((m) => m.default));

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function VideoViewer({ videos, index, title, onClose, onShare, onCover }: {
  videos: ViewerVideo[];
  index: number;
  title: string;
  onClose: () => void;
  onShare?: () => void;
  /** The admin's only: this video's frame becomes the folder's cover. */
  onCover?: (videoId: string) => void;
}) {
  const [cur, setCur] = useState(index);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [failed, setFailed] = useState(false);
  const [t, setT] = useState({ at: 0, dur: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useBackDismiss(true, onClose);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Open on the tapped one.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: index * el.clientHeight });
  }, [index]);

  // Which slide is on screen — once the swipe settles: `scrollend` where the browser has
  // it, else 80 ms without a scroll event. Changing on every pixel restarted the video
  // mid-swipe and re-rendered the list as the finger moved.
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pick = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const k = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
    setCur((c) => {
      if (k === c || k < 0 || k >= videos.length) return c;
      setPaused(false); setWaiting(true); setFailed(false); setT({ at: 0, dur: 0 });
      return k;
    });
  }, [videos.length]);
  const onScroll = useCallback(() => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(pick, 80);
  }, [pick]);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const end = () => { if (settle.current) clearTimeout(settle.current); pick(); };
    el.addEventListener('scrollend', end);
    return () => el.removeEventListener('scrollend', end);
  }, [pick]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // The slide that lands plays; the one before it stops (and keeps its place).
  const onActive = useCallback((el: HTMLVideoElement) => {
    videoRef.current = el;
    el.muted = mutedRef.current;
    // A copy is attached a moment later (hls.js loads lazily): play once it can, not "paused".
    void el.play().catch(() => {
      el.addEventListener('canplay', () => { void el.play().catch(() => setPaused(true)); }, { once: true });
    });
  }, []);

  // Stable, so the memoised slides are not redrawn by the progress bar's updates.
  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { void el.play().catch(() => {}); setPaused(false); } else { el.pause(); setPaused(true); }
  }, []);
  const onFailed = useCallback(() => { setFailed(true); setWaiting(false); }, []);
  const goNext = useCallback((k: number) => {
    const el = listRef.current;
    if (el && k < videos.length - 1) el.scrollTo({ top: (k + 1) * el.clientHeight, behavior: 'smooth' });
  }, [videos.length]);
  const v = videos[cur];
  // The portal needs the page's body: never on the server.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black text-white" dir="rtl" role="dialog" aria-modal="true" aria-label={title}>
      <div ref={listRef} onScroll={onScroll} className="h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [-webkit-overflow-scrolling:touch]">
        {videos.map((x, k) => (
          <VideoSlide key={x.id} x={x} k={k} mode={k === cur ? 'play' : k === cur + 1 ? 'ready' : Math.abs(k - cur) <= 2 ? 'poster' : 'none'}
            muted={muted} onActive={onActive} onTap={togglePlay}
            onWaiting={setWaiting} onFailed={onFailed}
            onTime={k === cur ? setT : undefined} onEnded={goNext} />
        ))}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-3.5 pt-[calc(env(safe-area-inset-top)+10px)]">
        <button type="button" onClick={onClose} aria-label="סגירה" className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur"><X className="h-5 w-5" /></button>
        <b className="text-[14px] font-extrabold"><bdi dir="ltr">{cur + 1} / {videos.length}</bdi></b>
        <button type="button" onClick={() => { const next = !muted; setMuted(next); const el = videoRef.current; if (el) { el.muted = next; if (el.paused) void el.play().catch(() => {}); } }} aria-label={muted ? 'להפעיל קול' : 'להשתיק'}
          className={cn('pointer-events-auto grid h-11 w-11 place-items-center rounded-full backdrop-blur', muted ? 'bg-white text-ink-900' : 'bg-white/15')}>
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      </div>

      {/* Buffering, paused, or a format this phone can't play — drawn icons, never the ▶ character (an emoji on iOS). */}
      {waiting && !failed && !paused && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center"><Loader2 className="h-10 w-10 animate-spin text-white/90 drop-shadow" /></div>
      )}
      {paused && !failed && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-black/35 backdrop-blur-md"><Play className="ms-1 h-8 w-8 text-white" fill="currentColor" strokeWidth={0} /></span>
        </div>
      )}
      {failed && v?.src && (
        <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-3xl bg-black/60 p-5 text-center backdrop-blur-md">
          <p className="text-[15px] font-bold leading-snug">אי אפשר לנגן את הסרטון הזה בטלפון הזה</p>
          <a href={`${v.src}&dl=1`} download className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white px-5 text-[14px] font-extrabold text-ink-900"><Download className="h-4 w-4" />להוריד</a>
        </div>
      )}

      <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+150px)] start-3 flex flex-col items-center gap-4 text-[11px] font-bold">
        {v?.src && (
          <a href={`${v.src}&dl=1`} download aria-label="לשמור" className="flex flex-col items-center gap-1">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur"><Download className="h-5 w-5" /></span>לשמור
          </a>
        )}
        {onShare && (
          <button type="button" onClick={onShare} className="flex flex-col items-center gap-1">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur"><Share2 className="h-5 w-5" /></span>לשתף
          </button>
        )}
        {onCover && v && (
          <button type="button" onClick={() => onCover(v.id)} className="flex flex-col items-center gap-1">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur"><ImageIcon className="h-5 w-5" /></span>שער
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+18px)]">
        <b className="block truncate text-[15px] font-extrabold" dir="auto">{title}</b>
        <p className="text-[12.5px] opacity-80">{cur < videos.length - 1 ? 'מחליקים למעלה לסרטון הבא' : 'זה הסרטון האחרון בתיקייה'}</p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/30" dir="ltr">
          <i className={cn('block h-full rounded-full bg-white')} style={{ width: `${t.dur ? (t.at / t.dur) * 100 : 0}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] opacity-80" dir="ltr"><span>{clock(t.at)}</span><span>{t.dur ? clock(t.dur) : v?.ms ? clock(v.ms / 1000) : ''}</span></div>
      </div>
    </div>,
    document.body,
  );
}

type SlideMode = 'play' | 'ready' | 'poster' | 'none';

/**
 * One video's page. `play`: on screen, playing. `ready`: the next one — its <video> exists,
 * paused, having read only its opening, so it is the same element that plays when it
 * lands. `poster`: a picture. `none`: an empty page (far away; memory). Memoised: the
 * player's progress updates never redraw the slides that aren't playing.
 */
const VideoSlide = memo(function VideoSlide({ x, k, mode, muted, onActive, onTap, onWaiting, onFailed, onTime, onEnded }: {
  x: ViewerVideo; k: number; mode: SlideMode; muted: boolean;
  onActive: (el: HTMLVideoElement) => void; onTap: () => void;
  onWaiting: (w: boolean) => void; onFailed: () => void;
  onTime?: (t: { at: number; dur: number }) => void; onEnded: (k: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const live = mode === 'play' || mode === 'ready';
  const [playing, setPlaying] = useState(false);
  // The copy: natively on an iPhone (HLS), through hls.js elsewhere; the next slide fetches
  // just its first seconds so it starts the moment it lands. The original when there is no copy.
  const useCopy = !!x.hls;
  useEffect(() => {
    const el = ref.current;
    if (!el || !live || !x.hls) return;
    if (el.canPlayType('application/vnd.apple.mpegurl')) { if (el.src !== x.hls) el.src = x.hls; return; }
    let hls: { destroy: () => void } | null = null;
    let gone = false;
    void loadHls().then((Hls) => {
      if (gone || !Hls.isSupported()) { if (!gone && x.src) el.src = x.src; return; }
      // One instance from "next" to "playing": what it fetched ahead is what plays.
      const h = new Hls({ maxBufferLength: 12, startLevel: -1, capLevelToPlayerSize: true });
      h.loadSource(x.hls!); h.attachMedia(el); hls = h;
    });
    return () => { gone = true; hls?.destroy(); };
  }, [live, x.hls, x.src]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (mode === 'play') onActive(el);
    else if (!el.paused) el.pause();
  }, [mode, onActive]);
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);
  const poster = x.poster || x.thumb || undefined;
  return (
    <div className="relative h-full w-full snap-start snap-always [contain:strict]">
      {/* While it starts: a few moving seconds of the copy over the still, so people see at
          once whether they are in it (Ofer, 10-23). Gone the moment it plays. */}
      {mode === 'play' && x.preview && !playing && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={x.preview} alt="" className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-contain" />
      )}
      {live && (x.src || x.hls) ? (
        <video
          ref={ref}
          src={useCopy ? undefined : x.src || undefined}
          poster={poster}
          muted
          playsInline
          preload={mode === 'play' ? 'auto' : 'metadata'}
          onWaiting={mode === 'play' ? () => onWaiting(true) : undefined}
          onPlaying={mode === 'play' ? () => { onWaiting(false); setPlaying(true); } : undefined}
          onCanPlay={mode === 'play' ? () => onWaiting(false) : undefined}
          onError={mode === 'play' ? onFailed : undefined}
          onClick={onTap}
          onTimeUpdate={onTime ? (e) => onTime({ at: e.currentTarget.currentTime, dur: e.currentTarget.duration || 0 }) : undefined}
          onEnded={mode === 'play' ? () => onEnded(k) : undefined}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : mode !== 'none' && poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" decoding="async" className="absolute inset-0 h-full w-full object-contain" />
      ) : null}
    </div>
  );
});
