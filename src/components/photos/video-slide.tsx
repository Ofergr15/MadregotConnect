'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { authedFetch } from '@/lib/auth/authed-fetch';
import { APP_VERSION } from '@/lib/version';

/**
 * ONE VIDEO IN THE VIEWER (components/photos/MediaViewer), and what gets it there fast.
 *
 * Measured and tuned on 10-23 (Ofer: "very, very efficient", "Instagram level"):
 * - the copy at Mux plays when there is one (lib/photos/mux) — natively on an iPhone, through
 *   hls.js elsewhere — opening at 720p and climbing to 1080p; the 4K original otherwise;
 * - the slides either side already hold their first seconds, so a swipe lands on a video
 *   that is ready (0.8–1.05 s → 0.22 s in the bench);
 * - the picture stays on top until a frame is painted (no black between them);
 * - only the one on screen has sound (an iPhone allows one; unmuting all froze it);
 * - the finger going down on a tile opens the connections to Mux (warmVideo);
 * - every start and its stalls are posted to /api/photos/video-timing (real phones).
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
/** The tile's touch time for this video, if it was touched (the open is timed from it). */
export const tapTimeOf = (id: string) => tapAt.get(id);

/** One measurement line (api/photos/video-timing → the server log). Best-effort. */
export function report(line: Record<string, unknown>) {
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

export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** The bar and the clock: they follow the playing element themselves, so the player doesn't redraw. */
export function Progress({ el, ms }: { el: HTMLVideoElement | null; ms: number | null }) {
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

export type SlideMode = 'play' | 'ready' | 'poster' | 'none';

/** Seconds held ahead: plenty for the one playing, just the opening for its neighbours (they share the line). */
const bufferFor = (mode: SlideMode) => (mode === 'play' ? 20 : 4);

/**
 * One video's page. `play`: on screen, playing. `ready`: the one before or after — its
 * <video> exists, paused, holding its first seconds, so it is the same element that plays
 * when it lands (and going back resumes where it was). `poster`: a picture. `none`: an
 * empty page (far away; memory). Memoised: the player's progress updates never redraw the
 * slides that aren't playing.
 */
export const VideoSlide = memo(function VideoSlide({ x, k, mode, muted, onActive, onTap, onWaiting, onFailed, onEnded, onFirstFrame }: {
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
    <div className="relative h-full w-full [contain:strict]">
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
          // The neighbours load their first seconds — a copy ('metadata' gets an iPhone the
          // list and no video) and an original too: on 'metadata' a swipe onto an original
          // waited ~0.97 s for its opening, on 'auto' (measured 10-23). The one behind was
          // playing a moment ago, so in practice only the next one loads.
          preload="auto"
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
