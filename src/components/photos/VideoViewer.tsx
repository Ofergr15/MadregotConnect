'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Image as ImageIcon, Loader2, Play, Share2, Volume2, VolumeX, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBackDismiss } from '@/lib/use-back-dismiss';
import { authedFetch } from '@/lib/auth/authed-fetch';
import { APP_VERSION } from '@/lib/version';

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
 *   SETTLES (scrollend, or 80 ms of quiet), not on every pixel; the videos either side
 *   already exist and hold their first seconds, so either way it starts where it lands;
 *   the progress bar is its own component, so playing never redraws the player; nothing
 *   over the video is frosted glass (a backdrop blur over a playing video is redrawn
 *   every frame on an iPhone).
 * - Quality from the first frame: a copy opens at 720p or better, never climbing from 360p
 *   (measured 10-23: the next video had loaded nothing, the current one began at 360p).
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
  ms?: number | null;
  blur?: string | null;
}

/** hls.js, loaded only when a copy has to play where the browser can't play HLS itself. */
let hlsLib: Promise<typeof import('hls.js').default> | null = null;
const loadHls = () => (hlsLib ??= import('hls.js').then((m) => m.default));

/** One `<link rel="preconnect">` per origin, for the page's lifetime. */
const preconnected = new Set<string>();
function preconnect(url: string) {
  try {
    const origin = new URL(url).origin;
    if (preconnected.has(origin) || typeof document === 'undefined') return;
    preconnected.add(origin);
    const l = document.createElement('link');
    l.rel = 'preconnect'; l.href = origin; l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  } catch { /* a bad URL warms nothing */ }
}

/** A folder with copies in it: open the line to Mux as the folder opens, before any tap. */
export function preconnectCopies(videos: ReadonlyArray<Pick<ViewerVideo, 'hls'>> | null | undefined) {
  const h = videos?.find((v) => v.hls)?.hls;
  if (h) preconnect(h);
}

const warmed = new Set<string>();
/** When the finger went down on each tile: where an "open" is timed from. */
const tapAt = new Map<string, number>();

/** One measurement line (api/photos/video-timing → the server log). Best-effort. */
function report(line: Record<string, unknown>) {
  void authedFetch('/api/photos/video-timing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...line, v: APP_VERSION }), keepalive: true }).catch(() => {});
}
/**
 * Get a copy's way ready before the player opens — called on the finger going DOWN on its
 * tile. A copy comes from three Mux hosts (its list, the quality's list, the video's
 * chunks), each a new secure connection of ~0.2 s before a byte moves: measured 10-23 at
 * ~1.6 s for the first open, and that is what Instagram-like apps do ahead of the tap.
 * Fetches the two short lists (Mux sends the first no-store, so what this buys is the open
 * connections, not a cached copy) and preconnects to the third; for the original, its host.
 */
export function warmVideo(v: Pick<ViewerVideo, 'id' | 'hls' | 'src'>) {
  tapAt.set(v.id, performance.now());
  if (warmed.has(v.id)) return;
  warmed.add(v.id);
  if (!v.hls) { if (v.src) preconnect(new URL(v.src, location.href).toString()); return; }
  preconnect(v.hls);
  if (!document.createElement('video').canPlayType('application/vnd.apple.mpegurl')) void loadHls();
  const first = (text: string, base: string) => { const l = text.split('\n').find((x) => x && !x.startsWith('#')); return l ? new URL(l, base).toString() : null; };
  void fetch(v.hls).then((r) => r.text()).then((master) => {
    const rend = first(master, v.hls!);
    if (!rend) return;
    preconnect(rend);
    return fetch(rend).then((r) => r.text()).then((pl) => { const seg = first(pl, rend); if (seg) preconnect(seg); });
  }).catch(() => { /* a warm-up only */ });
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
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [failed, setFailed] = useState(false);
  /** The playing element, for the progress bar. */
  const [playingEl, setPlayingEl] = useState<HTMLVideoElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useBackDismiss(true, onClose);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // ── The measurement (Ofer, 10-23: "measure the times") ─────────────────────────────
  // From the finger — the tile's touch for the first, the swipe's first move for the next —
  // to a frame on screen; then, on leaving, how much of it stalled. Posted per video.
  const curRef = useRef(index);
  const gestureAt = useRef<number | null>(null);
  const [start] = useState(() => ({ id: videos[index]?.id, at: tapAt.get(videos[index]?.id ?? '') ?? performance.now(), how: 'open' as 'open' | 'swipe', sent: false }));
  const startRef = useRef(start);
  const stats = useRef({ firstAt: 0, stalls: 0, stallMs: 0, stallStart: null as number | null });
  const leave = useCallback(() => {
    const s = startRef.current, st = stats.current, el = videoRef.current;
    if (!s.sent || !s.id) return;
    if (st.stallStart != null) st.stallMs += performance.now() - st.stallStart;
    report({ event: 'leave', id: s.id, how: s.how, watchedS: el?.currentTime ?? 0, stalls: st.stalls, stallMs: st.stallMs });
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
    const at = gestureAt.current;
    gestureAt.current = null;
    if (k === curRef.current || k < 0 || k >= videos.length) return;
    leave();
    startRef.current = { id: videos[k].id, at: at ?? performance.now(), how: 'swipe', sent: false };
    stats.current = { firstAt: 0, stalls: 0, stallMs: 0, stallStart: null };
    curRef.current = k;
    setPaused(false); setWaiting(true); setFailed(false);
    setCur(k);
  }, [videos, leave]);
  const onScroll = useCallback(() => {
    gestureAt.current ??= performance.now();
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
    setPlayingEl(el);
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
          <VideoSlide key={x.id} x={x} k={k} mode={k === cur ? 'play' : Math.abs(k - cur) === 1 ? 'ready' : Math.abs(k - cur) === 2 ? 'poster' : 'none'}
            muted={k === cur ? muted : true} onActive={onActive} onTap={togglePlay}
            onWaiting={onWait} onFailed={onFailed} onEnded={goNext} onFirstFrame={onFirstFrame} />
        ))}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-3.5 pt-[calc(env(safe-area-inset-top)+10px)]">
        <button type="button" onClick={onClose} aria-label="סגירה" className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-black/40"><X className="h-5 w-5" /></button>
        <b className="text-[14px] font-extrabold"><bdi dir="ltr">{cur + 1} / {videos.length}</bdi></b>
        <button type="button" onClick={() => { const next = !muted; setMuted(next); const el = videoRef.current; if (el) { el.muted = next; if (el.paused) void el.play().catch(() => {}); } }} aria-label={muted ? 'להפעיל קול' : 'להשתיק'}
          className={cn('pointer-events-auto grid h-11 w-11 place-items-center rounded-full', muted ? 'bg-white text-ink-900' : 'bg-black/40')}>
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      </div>

      {/* Buffering, paused, or a format this phone can't play — drawn icons, never the ▶ character (an emoji on iOS). */}
      {waiting && !failed && !paused && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center"><Loader2 className="h-10 w-10 animate-spin text-white/90 drop-shadow" /></div>
      )}
      {paused && !failed && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-black/45"><Play className="ms-1 h-8 w-8 text-white" fill="currentColor" strokeWidth={0} /></span>
        </div>
      )}
      {failed && v?.src && (
        <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-3xl bg-black/75 p-5 text-center">
          <p className="text-[15px] font-bold leading-snug">אי אפשר לנגן את הסרטון הזה בטלפון הזה</p>
          <a href={`${v.src}&dl=1`} download className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white px-5 text-[14px] font-extrabold text-ink-900"><Download className="h-4 w-4" />להוריד</a>
        </div>
      )}

      <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+150px)] start-3 flex flex-col items-center gap-4 text-[11px] font-bold">
        {v?.src && (
          <a href={`${v.src}&dl=1`} download aria-label="לשמור" className="flex flex-col items-center gap-1">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/40"><Download className="h-5 w-5" /></span>לשמור
          </a>
        )}
        {onShare && (
          <button type="button" onClick={onShare} className="flex flex-col items-center gap-1">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/40"><Share2 className="h-5 w-5" /></span>לשתף
          </button>
        )}
        {onCover && v && (
          <button type="button" onClick={() => onCover(v.id)} className="flex flex-col items-center gap-1">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/40"><ImageIcon className="h-5 w-5" /></span>שער
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+18px)]">
        <b className="block truncate text-[15px] font-extrabold" dir="auto">{title}</b>
        <p className="text-[12.5px] opacity-80">{cur < videos.length - 1 ? 'מחליקים למעלה לסרטון הבא' : 'זה הסרטון האחרון בתיקייה'}</p>
        <Progress key={cur} el={playingEl} ms={v?.ms ?? null} />
      </div>
    </div>,
    document.body,
  );
}

/** The bar and the clock: they follow the playing element themselves, so the player doesn't redraw. */
function Progress({ el, ms }: { el: HTMLVideoElement | null; ms: number | null }) {
  const [t, setT] = useState({ at: 0, dur: 0 });
  useEffect(() => {
    if (!el) return;
    const on = () => setT({ at: el.currentTime, dur: el.duration || 0 });
    el.addEventListener('timeupdate', on);
    return () => el.removeEventListener('timeupdate', on);
  }, [el]);
  return (
    <>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/30" dir="ltr">
        <i className="block h-full rounded-full bg-white" style={{ width: `${t.dur ? (t.at / t.dur) * 100 : 0}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] opacity-80" dir="ltr"><span>{clock(t.at)}</span><span>{t.dur ? clock(t.dur) : ms ? clock(ms / 1000) : ''}</span></div>
    </>
  );
}

type SlideMode = 'play' | 'ready' | 'poster' | 'none';

/**
 * One video's page. `play`: on screen, playing. `ready`: the one before or after — its
 * <video> exists, paused, holding its first seconds, so it is the same element that plays
 * when it lands (and going back resumes where it was). `poster`: a picture. `none`: an empty page (far away; memory). Memoised: the
 * player's progress updates never redraw the slides that aren't playing.
 */
/** Seconds held ahead: plenty for the one playing, just the opening for its neighbours (they share the line). */
const bufferFor = (mode: SlideMode) => (mode === 'play' ? 20 : 4);

const VideoSlide = memo(function VideoSlide({ x, k, mode, muted, onActive, onTap, onWaiting, onFailed, onEnded, onFirstFrame }: {
  x: ViewerVideo; k: number; mode: SlideMode; muted: boolean;
  onActive: (el: HTMLVideoElement) => void; onTap: () => void;
  onWaiting: (w: boolean) => void; onFailed: () => void; onEnded: (k: number) => void;
  onFirstFrame: (id: string, el: HTMLVideoElement, preloaded: boolean, copy: boolean) => void;
}) {
  /** Whether it was already holding its opening when it landed — what preloading is for. */
  const landedReady = useRef(false);
  const ref = useRef<HTMLVideoElement>(null);
  const live = mode === 'play' || mode === 'ready';
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const hlsRef = useRef<import('hls.js').default | null>(null);
  // The copy: natively on an iPhone (HLS), through hls.js elsewhere. The original when there is no copy.
  const useCopy = !!x.hls;
  useEffect(() => {
    const el = ref.current;
    if (!el || !live || !x.hls) return;
    if (el.canPlayType('application/vnd.apple.mpegurl')) { if (el.src !== x.hls) el.src = x.hls; return; }
    let gone = false;
    void loadHls().then((Hls) => {
      if (gone || !Hls.isSupported()) { if (!gone && x.src) el.src = x.src; return; }
      // One instance from "beside" to "playing": what it fetched ahead is what plays. It
      // starts loading itself, at 720p — the quick start — and climbs to 1080p within
      // seconds (Ofer, 10-23: "720 to start fast, then 1080, fine"); left alone, hls.js loads a
      // neighbour's list but none of its video, and opens on the lowest quality.
      const h = new Hls({ autoStartLoad: false, maxBufferLength: bufferFor(modeRef.current), capLevelToPlayerSize: true, abrEwmaDefaultEstimate: 10_000_000 });
      h.on(Hls.Events.MANIFEST_PARSED, (_e, d) => {
        const quick = d.levels.findIndex((l) => l.height >= 720);
        h.startLevel = quick >= 0 ? quick : d.levels.length - 1;
        h.startLoad(0);
      });
      h.loadSource(x.hls!); h.attachMedia(el); hlsRef.current = h;
    });
    return () => { gone = true; hlsRef.current?.destroy(); hlsRef.current = null; };
  }, [live, x.hls, x.src]);
  useEffect(() => { if (hlsRef.current) hlsRef.current.config.maxBufferLength = bufferFor(mode); }, [mode]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (mode === 'play') { landedReady.current = el.readyState >= 3; onActive(el); }
    else if (!el.paused) el.pause();
  }, [mode, onActive]);
  // Only the one on screen ever has sound: an iPhone allows one video with sound, and
  // unmuting the neighbours too froze the picture (Ofer, 10-23).
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);
  // The picture stays on top until the video has PAINTED a frame. Swapping it for the
  // <video> showed black for seconds while an iPhone decoded the first frame (Ofer, 10-23:
  // "I see the picture, then black, then it loads"). Once shown, it stays shown.
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || mode !== 'play' || painted) return;
    const done = () => { setPainted(true); onFirstFrame(x.id, el, landedReady.current, !!x.hls); };
    if (typeof el.requestVideoFrameCallback === 'function') {
      const id = el.requestVideoFrameCallback(done);
      return () => el.cancelVideoFrameCallback(id);
    }
    const on = () => { if (el.currentTime > 0) done(); };
    el.addEventListener('timeupdate', on);
    return () => el.removeEventListener('timeupdate', on);
  }, [mode, painted, onFirstFrame, x.id, x.hls]);
  const poster = x.poster || x.thumb || undefined;
  return (
    <div className="relative h-full w-full snap-start snap-always [contain:strict]">
      {mode !== 'none' && !painted && (x.thumb || poster) && (
        // The grid's own thumbnail first (already loaded, so never an empty frame), the sharp poster over it.
        <div className="pointer-events-none absolute inset-0 z-[1]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {x.thumb && <img src={x.thumb} alt="" className="absolute inset-0 h-full w-full object-contain" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {poster && poster !== x.thumb && <img src={poster} alt="" decoding="async" className="absolute inset-0 h-full w-full object-contain" />}
        </div>
      )}
      {live && (x.src || x.hls) && (
        <video
          ref={ref}
          src={useCopy ? undefined : x.src || undefined}
          poster={poster}
          muted
          playsInline
          // A neighbour's copy loads its first seconds ('metadata' gets an iPhone the list and
          // no video); a neighbour's original only its header (4K, up to 573 MB).
          preload={mode === 'play' || useCopy ? 'auto' : 'metadata'}
          onWaiting={mode === 'play' ? () => onWaiting(true) : undefined}
          onPlaying={mode === 'play' ? () => onWaiting(false) : undefined}
          onCanPlay={mode === 'play' ? () => onWaiting(false) : undefined}
          onError={mode === 'play' ? onFailed : undefined}
          onClick={onTap}
          onEnded={mode === 'play' ? () => onEnded(k) : undefined}
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
    </div>
  );
});
