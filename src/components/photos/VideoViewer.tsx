'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
 * - With sound (Ofer, 10-23: "why is there no sound"): it was opened by a tap, which lets
 *   a phone play sound. Only if the phone still refuses does it play muted, saying so.
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
  ms?: number | null;
  blur?: string | null;
}

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
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [failed, setFailed] = useState(false);
  const [t, setT] = useState({ at: 0, dur: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  useBackDismiss(true, onClose);

  // Open on the tapped one.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: index * el.clientHeight });
  }, [index]);

  // Which slide is on screen: the nearest to the scroll position, once it settles.
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const k = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
    if (k !== cur && k >= 0 && k < videos.length) { setCur(k); setPaused(false); setWaiting(true); setFailed(false); setT({ at: 0, dur: 0 }); }
  }, [cur, videos.length]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Play with sound; the phone may refuse sound without a tap on the video itself — then
  // muted, and the 🔊 button lights up to say so.
  const start = useCallback((el: HTMLVideoElement) => {
    el.muted = muted;
    el.play().catch(() => { el.muted = true; setMuted(true); void el.play().catch(() => setPaused(true)); });
  }, [muted]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play().catch(() => {}); setPaused(false); } else { v.pause(); setPaused(true); }
  };
  const v = videos[cur];
  // The portal needs the page's body: never on the server.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black text-white" dir="rtl" role="dialog" aria-modal="true" aria-label={title}>
      <div ref={listRef} onScroll={onScroll} className="h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none]">
        {videos.map((x, k) => (
          <div key={x.id} className="relative h-full w-full snap-start snap-always">
            {k === cur && x.src ? (
              <video
                ref={videoRef}
                key={x.id}
                src={x.src}
                poster={x.poster || x.thumb || undefined}
                muted={muted}
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => start(e.currentTarget)}
                onWaiting={() => setWaiting(true)}
                onPlaying={() => { setWaiting(false); setPaused(false); }}
                onCanPlay={() => setWaiting(false)}
                onError={() => { setFailed(true); setWaiting(false); }}
                onClick={togglePlay}
                onTimeUpdate={(e) => setT({ at: e.currentTarget.currentTime, dur: e.currentTarget.duration || 0 })}
                onEnded={() => { const el = listRef.current; if (el && cur < videos.length - 1) el.scrollTo({ top: (cur + 1) * el.clientHeight, behavior: 'smooth' }); }}
                className="absolute inset-0 h-full w-full object-contain"
              />
            ) : Math.abs(k - cur) <= 2 ? (
              // The neighbours: their poster only, so the swipe lands on a picture at once.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={x.poster || x.thumb || ''} alt="" className="absolute inset-0 h-full w-full object-contain" />
            ) : null}
          </div>
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
