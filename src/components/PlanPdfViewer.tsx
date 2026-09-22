'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Maximize2, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  atZoom,
  canZoom,
  clampZoom,
  FIT_ZOOM,
  renderScale,
  scrollAnchor,
  stepZoom,
  zoomScroll,
} from '@/lib/pdf/zoom';
import type { PDFDocumentLoadingTask, PDFPageProxy, RenderTask } from 'pdfjs-dist';

/**
 * The week's plan PDF, with zoom.
 *
 * It used to be `<iframe src={pdfUrl}>` — the browser's own PDF viewer. That gives
 * us no zoom control at all, and on iOS it is worse than that: Safari renders a PDF
 * in an iframe as a single static first page with no scrolling and no pinch. The
 * training plan is five pages of **A4 landscape** (842×595), so fit-to-width on a
 * 390pt phone squeezes a whole week's table into 275px of height. Unreadable, and
 * the only way out was "open in a new tab", which leaves the app.
 *
 * So pdf.js rasterises the pages onto canvases we own, and the zoom is ours too.
 * Three rules hold the whole thing up, and each one is a bug that was reported:
 *
 *  1. **A pinch is a CSS transform, never React state.** The gesture updates one
 *     `style.transform` imperatively, at frame rate, and nothing re-renders. Driving
 *     `zoom` state from `touchmove` re-laid-out five canvases per frame AND raced
 *     React: `touchmove` is a continuous event, so the commit can land after the
 *     frame that tried to correct the scroll, the correction then clamps against the
 *     old scroll range, and the page fights the fingers. The scale is committed to
 *     state once, when the fingers lift.
 *  2. **The scroll correction runs in a layout effect**, not a `requestAnimationFrame`
 *     — the new scroll range exists only after React has committed the new page
 *     sizes, and a layout effect is the only hook that is guaranteed to be after
 *     that and before paint.
 *  3. **Renders are serialised per page.** Each zoom used to start a `page.render()`
 *     on a canvas whose previous render was still cancelling; pdf.js refuses that,
 *     and the rejection was swallowed by a bare `.catch(() => {})`, so the page went
 *     white. `cancel()` is not enough on its own: it settles asynchronously, so the
 *     cancellation has to be awaited before the canvas is touched again.
 *
 * Only visible pages are rasterised (see PdfPage). At 300% a landscape A4 canvas is
 * ~32 MB; five of them held at once is how iOS Safari decides to throw the whole
 * tab away.
 */

/** Where `copy-pdf-worker.mjs` puts the worker on predev/prebuild. */
const WORKER_SRC = '/pdf.worker.min.mjs';

/**
 * How long after the last committed zoom the pages are redrawn at the new scale.
 * Short, and only there so three quick taps on "+" rasterise once.
 */
const RERENDER_DELAY_MS = 120;

/** What counts as a tap rather than a scroll, so a flick can't zoom the plan. */
const TAP_MAX_MS = 250;
const TAP_SLOP_PX = 10;
/** Two taps this close together, in time and in place, are a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 32;
/** What a double tap zooms to when the page is at fit. */
const DOUBLE_TAP_ZOOM = 2;

/**
 * Safari's own pinch. It is not in any standard and TypeScript's DOM library does
 * not know it, but it is what every iPhone reports for two fingers — and an
 * installed PWA gets no page-level pinch to fall back on, so this is the gesture.
 * `scale` is cumulative from the start of the gesture.
 */
interface GestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * MEASURED: iOS Safari has `ongesturechange` on `window`, but some WebKit builds
 * (Playwright's, among others) ship the events and the constructor WITHOUT the
 * on-handler property — so detecting only the handler misses a WebKit that does
 * send gestures, and the touch path then has to carry it. Either signal is enough.
 */
const HAS_GESTURE_EVENTS =
  typeof window !== 'undefined' &&
  ('ongesturechange' in window || typeof (window as { GestureEvent?: unknown }).GestureEvent === 'function');

interface Props {
  url: string;
  /** For the `<canvas>` fallback text and the iframe title. */
  title: string;
}

export function PlanPdfViewer({ url, title }: Props) {
  const t = useTranslations('program');
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  // The committed zoom (what the pages are laid out at) and the zoom the bitmaps
  // are drawn at, which trails it by `RERENDER_DELAY_MS`.
  const [zoom, setZoom] = useState(FIT_ZOOM);
  const [renderZoom, setRenderZoom] = useState(FIT_ZOOM);
  // The gesture handlers are attached once and must not be re-attached on every
  // zoom change, so they read the current zoom from here rather than from state.
  const zoomRef = useRef(FIT_ZOOM);
  // Where to scroll to once React has laid the pages out at the new zoom. See
  // rule 2 in the docblock: this cannot be applied before the commit.
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  // Width of the scroller's content box, which is what "fit" is measured against.
  // Watched rather than read once: rotating the phone changes it, and a plan
  // rendered for the old width is either clipped or leaves half the screen empty.
  //
  // The content box specifically, not `clientWidth` — clientWidth *includes*
  // padding, and this scroller has `p-2 sm:p-4`. The old code compensated with a
  // hardcoded 8px subtraction downstream, which was short by 8px on mobile and
  // 24px on desktop, so "fit to width" reliably overflowed and put a horizontal
  // scrollbar on a page that was supposed to fit exactly. `contentRect` is that
  // measurement rather than an approximation of it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setContainerWidth(
        el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0'),
      );
    };
    measure();
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setContainerWidth(box.width);
      else measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    // The loading task, not the document: in pdf.js 6 `destroy()` lives here, and
    // it is also what has to be torn down if we unmount mid-parse.
    let task: PDFDocumentLoadingTask | null = null;

    (async () => {
      try {
        // Dynamic, so pdf.js (~350 KB gzipped, plus a 1.2 MB worker) is fetched
        // only by someone who actually opened a plan — it must not sit in the
        // shared chunk every screen in the app pays for.
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
        task = pdfjs.getDocument({ url });
        const doc = await task.promise;
        if (cancelled) return;
        const loaded = await Promise.all(
          Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
        );
        if (cancelled) return;
        setPages(loaded);
        setState('ready');
      } catch {
        // A missing worker, a moved file, a PDF pdf.js won't parse — all land here,
        // and all get the browser's own viewer instead of an error screen.
        if (!cancelled) setState('failed');
      }
    })();

    return () => {
      cancelled = true;
      // Frees the worker and every page's cached operator list.
      task?.destroy();
    };
  }, [url]);

  /**
   * Commit a zoom, holding one point of the CONTENT still.
   *
   * `point` is measured inside the content's own unscaled box (`touch - contentRect`),
   * not against the viewport, because that is the only phrasing that survives RTL:
   * in an RTL scroller `scrollLeft` is 0 at the right edge and runs negative
   * leftwards. See `zoomScroll`.
   */
  const commitZoom = useCallback((next: number, point?: { x: number; y: number }) => {
    const target = clampZoom(next);
    const prev = zoomRef.current;
    if (atZoom(target, prev)) return;
    zoomRef.current = target;

    const el = scrollRef.current;
    const content = contentRef.current;
    if (el && content) {
      const rect = content.getBoundingClientRect();
      const p = point ?? {
        // No anchor (the buttons): hold the middle of what is on screen.
        x: el.clientWidth / 2 + el.getBoundingClientRect().left - rect.left,
        y: el.clientHeight / 2 + el.getBoundingClientRect().top - rect.top,
      };
      const ratio = target / prev;
      // In RTL the scrollable area grows LEFTWARDS while scrollLeft 0 stays pinned
      // to the right, so the horizontal anchor has to be measured from the content's
      // right edge — the one that does not move. See `scrollAnchor`.
      const rtl = getComputedStyle(el).direction === 'rtl';
      pendingScroll.current = {
        left: zoomScroll({
          scroll: el.scrollLeft,
          pointInContent: scrollAnchor({
            pointInContent: p.x,
            contentSize: rect.width,
            growsFromEnd: rtl,
          }),
          ratio,
        }),
        top: zoomScroll({
          scroll: el.scrollTop,
          pointInContent: scrollAnchor({
            pointInContent: p.y,
            contentSize: rect.height,
            // Blocks always grow downwards, whatever the writing direction.
            growsFromEnd: false,
          }),
          ratio,
        }),
      };
    }
    setZoom(target);
  }, []);

  // Rule 2: after the commit, before the paint. In a `requestAnimationFrame` this
  // can run before React has resized the pages, and the assignment is then clamped
  // to the old, smaller scroll range and silently lost.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = pendingScroll.current;
    if (!el || !p) return;
    pendingScroll.current = null;
    // Assigned, not clamped by us: the browser clamps into the range this element
    // actually scrolls, which in RTL runs the other way.
    el.scrollLeft = p.left;
    el.scrollTop = p.top;
  }, [zoom]);

  // The bitmaps catch up once the zoom has stopped moving.
  useEffect(() => {
    const id = setTimeout(() => setRenderZoom(zoom), RERENDER_DELAY_MS);
    return () => clearTimeout(id);
  }, [zoom]);

  // Pinch, double tap, and ctrl+wheel (which is what a trackpad pinch arrives as).
  //
  // All on native listeners with `passive: false` where a default has to be
  // prevented: React registers `touchmove` and `wheel` passively on the root, so
  // `preventDefault` from a JSX prop is a no-op and the browser scrolls the page
  // out from under the gesture.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || state !== 'ready') return;

    // The live pinch. `scale` is applied as a transform and never as state.
    let pinchDist = 0;
    let pinchZoom = FIT_ZOOM;
    let pinchScale = 1;
    let originX = 0;
    let originY = 0;
    // Tap tracking, so a scroll flick is not mistaken for a tap.
    let downAt = 0;
    let downX = 0;
    let downY = 0;
    let moved = false;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    const spread = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const preview = (scale: number) => {
      const content = contentRef.current;
      if (!content) return;
      content.style.transformOrigin = `${originX}px ${originY}px`;
      content.style.transform = `scale(${scale})`;
    };
    const clearPreview = () => {
      const content = contentRef.current;
      if (!content) return;
      content.style.transform = '';
      content.style.transformOrigin = '';
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        downAt = Date.now();
        downX = touch.clientX;
        downY = touch.clientY;
        moved = false;
        return;
      }
      if (e.touches.length !== 2) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      const content = contentRef.current;
      if (!content) return;
      // The origin is taken once, at the start, in the content's unscaled
      // coordinates — the midpoint wanders during a pinch, and a transform-origin
      // that wanders with it makes the page swim.
      const rect = content.getBoundingClientRect();
      originX = (a.clientX + b.clientX) / 2 - rect.left;
      originY = (a.clientY + b.clientY) / 2 - rect.top;
      // On Safari the scale comes from `gesturechange`, which has already done this
      // arithmetic; leaving `pinchDist` at 0 keeps the two paths from both scaling.
      pinchDist = HAS_GESTURE_EVENTS ? 0 : spread(a, b);
      pinchZoom = zoomRef.current;
      pinchScale = 1;
      moved = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        if (Math.abs(touch.clientX - downX) > TAP_SLOP_PX || Math.abs(touch.clientY - downY) > TAP_SLOP_PX) {
          moved = true;
        }
        return;
      }
      if (e.touches.length !== 2) return;
      // Without this the scroller pans on two fingers as well, so the page runs
      // away from the gesture that is trying to scale it. Needed on Safari too,
      // where the scale itself comes from the gesture events below.
      e.preventDefault();
      if (pinchDist <= 0) return;
      const raw = spread(e.touches[0], e.touches[1]) / pinchDist;
      // Previewed within the zoom limits, so the page cannot be stretched to
      // somewhere it will snap back from when the fingers lift.
      pinchScale = clampZoom(pinchZoom * raw) / pinchZoom;
      preview(pinchScale);
    };

    const onTouchEnd = (e: TouchEvent) => {
      // A pinch ends when either finger leaves: commit what it reached.
      if (pinchDist > 0 && e.touches.length < 2) {
        pinchDist = 0;
        clearPreview();
        commitZoom(pinchZoom * pinchScale, { x: originX, y: originY });
        pinchScale = 1;
        return;
      }
      if (e.touches.length > 0) return;

      const touch = e.changedTouches[0];
      if (!touch || moved || Date.now() - downAt > TAP_MAX_MS) {
        moved = false;
        return;
      }
      // A double tap toggles between fit and 2× — the gesture everyone tries on a
      // document before they look for buttons. Guarded by `moved`/`TAP_MAX_MS`,
      // because two scroll flicks that happen to end near each other are not it.
      const now = Date.now();
      const near =
        Math.abs(touch.clientX - lastTapX) < DOUBLE_TAP_SLOP_PX &&
        Math.abs(touch.clientY - lastTapY) < DOUBLE_TAP_SLOP_PX;
      if (now - lastTapAt < DOUBLE_TAP_MS && near) {
        lastTapAt = 0;
        const rect = contentRef.current?.getBoundingClientRect();
        const at = rect
          ? { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
          : undefined;
        commitZoom(zoomRef.current > FIT_ZOOM ? FIT_ZOOM : DOUBLE_TAP_ZOOM, at);
        return;
      }
      lastTapAt = now;
      lastTapX = touch.clientX;
      lastTapY = touch.clientY;
    };

    const onTouchCancel = () => {
      pinchDist = 0;
      pinchScale = 1;
      clearPreview();
    };

    const onWheel = (e: WheelEvent) => {
      // A trackpad pinch is a wheel event with ctrlKey set. A plain wheel is
      // scrolling and is left alone.
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = contentRef.current?.getBoundingClientRect();
      const at = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : undefined;
      commitZoom(zoomRef.current * Math.exp(-e.deltaY / 180), at);
    };

    // Safari — which is every iPhone, including this app installed to the home
    // screen — reports a two-finger pinch as its own `gesture*` events as well as
    // as touches, and it gives those events the scale it has already decided on.
    // Using them is both smoother and closer to what the OS thinks is happening,
    // so where they exist they win and the touch pinch above stands down.
    const onGestureStart = (e: GestureEvent) => {
      e.preventDefault();
      const content = contentRef.current;
      if (!content) return;
      const rect = content.getBoundingClientRect();
      originX = e.clientX - rect.left;
      originY = e.clientY - rect.top;
      pinchZoom = zoomRef.current;
      pinchScale = 1;
      // So the finger that lifts out of a pinch cannot also read as a tap.
      moved = true;
    };

    const onGestureChange = (e: GestureEvent) => {
      e.preventDefault();
      pinchScale = clampZoom(pinchZoom * e.scale) / pinchZoom;
      preview(pinchScale);
    };

    const onGestureEnd = (e: GestureEvent) => {
      e.preventDefault();
      clearPreview();
      commitZoom(pinchZoom * pinchScale, { x: originX, y: originY });
      pinchScale = 1;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    if (HAS_GESTURE_EVENTS) {
      el.addEventListener('gesturestart', onGestureStart as EventListener, { passive: false });
      el.addEventListener('gesturechange', onGestureChange as EventListener, { passive: false });
      el.addEventListener('gestureend', onGestureEnd as EventListener, { passive: false });
    }
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
      el.removeEventListener('gestureend', onGestureEnd as EventListener);
      clearPreview();
    };
  }, [state, commitZoom]);

  const canOut = canZoom(zoom, -1);
  const canIn = canZoom(zoom, 1);
  const atFit = atZoom(zoom, FIT_ZOOM);

  const header = (
    <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-page/60">
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-ink-400" />
        <span className="truncate text-sm font-medium">{title}</span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('openInNewTab')}</span>
      </a>
    </div>
  );

  if (state === 'failed') {
    return (
      <div className="bg-card/60 rounded-card border border-page/60 overflow-hidden">
        {header}
        <div className="w-full" style={{ height: '80vh' }}>
          <iframe src={url} className="w-full h-full border-0" title={title} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card/60 rounded-card border border-page/60 overflow-hidden">
      {header}

      {/* The zoom bar. Its own row under the title rather than crowded in beside
          the new-tab link: on a 320pt screen a title, a link and three controls in
          one row is how the title ends up two characters wide. */}
      <div className="flex items-center justify-center gap-1 px-4 sm:px-5 py-2 border-b border-page/60 bg-card/40">
        <button
          type="button"
          onClick={() => commitZoom(stepZoom(zoomRef.current, -1))}
          disabled={!canOut}
          aria-label={t('zoomOut')}
          className={cn(
            // `touch-manipulation` is not a nicety. Without it the browser keeps
            // its own double-tap-to-zoom gesture on these buttons, and the SECOND
            // of two fast taps is swallowed as part of that gesture — which is what
            // "only by the buttons, and even then" meant: tapping "+" twice quickly
            // moved the zoom one step, or none.
            'grid place-items-center w-11 h-11 rounded-xl transition-colors touch-manipulation',
            canOut ? 'text-ink-700 active:bg-page' : 'text-ink-300 cursor-not-allowed',
          )}
        >
          <Minus className="h-4 w-4" />
        </button>

        {/* dir="ltr" and tabular-nums: a percentage is not RTL text, and without
            fixed-width digits the label jitters the buttons sideways on every tap. */}
        <button
          type="button"
          onClick={() => commitZoom(FIT_ZOOM)}
          disabled={atFit}
          aria-label={t('zoomFit')}
          className={cn(
            'inline-flex items-center gap-1.5 min-w-[92px] h-11 justify-center rounded-xl px-3 text-xs font-bold transition-colors touch-manipulation',
            atFit ? 'text-ink-400' : 'text-ink-700 active:bg-page',
          )}
        >
          <Maximize2 className="h-3.5 w-3.5 shrink-0" />
          <span dir="ltr" className="tabular-nums">{Math.round(zoom * 100)}%</span>
        </button>

        <button
          type="button"
          onClick={() => commitZoom(stepZoom(zoomRef.current, 1))}
          disabled={!canIn}
          aria-label={t('zoomIn')}
          className={cn(
            // `touch-manipulation` is not a nicety. Without it the browser keeps
            // its own double-tap-to-zoom gesture on these buttons, and the SECOND
            // of two fast taps is swallowed as part of that gesture — which is what
            // "only by the buttons, and even then" meant: tapping "+" twice quickly
            // moved the zoom one step, or none.
            'grid place-items-center w-11 h-11 rounded-xl transition-colors touch-manipulation',
            canIn ? 'text-ink-700 active:bg-page' : 'text-ink-300 cursor-not-allowed',
          )}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        // Scrolls in both axes because zoomed-in pages are wider than the screen.
        // `overscroll-contain` stops a swipe that runs out of plan from carrying on
        // into the page behind it, which on a phone reads as the app jumping.
        className="w-full overflow-auto overscroll-contain bg-page/40 p-2 sm:p-4"
        // One finger pans natively — momentum and all — and two fingers are ours.
        // Without `pan-x pan-y` iOS can claim the second finger for a scroll before
        // the handler above ever sees it.
        style={{ height: '80vh', touchAction: 'pan-x pan-y' }}
      >
        {state === 'loading' ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
          </div>
        ) : (
          <div
            ref={contentRef}
            className="flex flex-col gap-3"
            style={{
              // `will-change` so the live pinch is composited rather than repainted:
              // the transform is written every frame the fingers move.
              willChange: 'transform',
              // NOT `items-center`, and this is a measured bug, not a preference.
              // A flex item centred on the cross axis that is WIDER than its
              // container overflows in both directions, and the half that overflows
              // towards the container's start edge cannot be scrolled to: at 263% the
              // pages measured 934px wide while the scroller reported a scrollWidth of
              // 653, so ~280px of every page was unreachable. That is most of what
              // "the zoom breaks everything" was.
              //
              // `max-content` + auto inline margins is the fix: the box is as wide as
              // the widest page, it is centred while it fits, and once it does not,
              // the auto margins resolve to zero and every pixel of it is inside the
              // scrollable area.
              width: 'max-content',
              marginInline: 'auto',
            }}
          >
            {pages.map((page, i) => (
              <PdfPage
                key={page.pageNumber}
                page={page}
                containerWidth={containerWidth}
                zoom={zoom}
                renderZoom={renderZoom}
                scroller={scrollRef}
                label={t('pdfPageOf', { page: i + 1, total: pages.length })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One page, rasterised only while it is near the viewport.
 *
 * The placeholder is sized from the page's own aspect ratio before anything is
 * drawn, so the scroller's height is right from the first paint — otherwise every
 * page that rasterises shoves the ones below it down and reading page 3 means
 * chasing it up the screen.
 */
function PdfPage({
  page,
  containerWidth,
  zoom,
  renderZoom,
  scroller,
  label,
}: {
  page: PDFPageProxy;
  containerWidth: number;
  /** The committed zoom, which is what the page is laid out at. */
  zoom: number;
  /** What the bitmap is drawn at — the same number, a beat later. */
  renderZoom: number;
  scroller: React.RefObject<HTMLDivElement | null>;
  label: string;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const [near, setNear] = useState(false);

  const base = page.getViewport({ scale: 1 });
  // Fit the page's width to the container, then apply the user's zoom on top.
  // `containerWidth` is already the padding-free content width (measured in the
  // parent), so there is nothing left to subtract here.
  const fit = containerWidth > 0 ? containerWidth / base.width : 0;
  const cssW = Math.max(1, Math.floor(base.width * fit * zoom));
  const cssH = Math.max(1, Math.floor(base.height * fit * zoom));

  // A generous margin: pages one screen away are drawn before they're scrolled to,
  // so normal reading never waits, and pages further off are released.
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => setNear(entries.some(e => e.isIntersecting)),
      { root: scroller.current, rootMargin: '150% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scroller]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !near || fit <= 0) return;
    let dropped = false;

    (async () => {
      // SERIALISED, and this is the whole point of the ref. Two renders on one
      // canvas make pdf.js reject the second ("Cannot use the same canvas during
      // multiple render() operations"), and the page stays blank — which is what
      // tapping the zoom buttons twice in a row used to do. `cancel()` alone is not
      // enough: it settles asynchronously, so the canvas is still in use when the
      // next tap arrives. Awaiting the cancellation is what frees it.
      const running = taskRef.current;
      if (running) {
        running.cancel();
        await running.promise.catch(() => {});
      }
      if (dropped || !canvasRef.current) return;

      // Draw at the device's real resolution. This used to be capped at 2, which on a
      // DPR-3 iPhone meant the bitmap was upscaled 1.5× by the compositor — an A4
      // nutrition plan is already rendered at ~53% of paper size on a 320pt screen, so
      // softening it on top of that is most of why it reads as illegible.
      //
      // 3 is kept as a sanity bound because a DPR the ladder was never sized against
      // should not be trusted blindly; `renderScale` is what actually keeps the
      // canvas inside what iOS will hand back.
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const scale = renderScale(base.width, base.height, fit * renderZoom * dpr);
      const viewport = page.getViewport({ scale });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      const task = page.render({ canvas, viewport });
      taskRef.current = task;
      // Cancelling a render rejects its promise; that is the normal path when zoom
      // changes mid-draw and is not an error.
      await task.promise.catch(() => {});
      if (taskRef.current === task) taskRef.current = null;
    })();

    return () => {
      dropped = true;
      taskRef.current?.cancel();
    };
  }, [page, near, fit, renderZoom, base.width, base.height]);

  // Released when the page scrolls far away, so five zoomed-in pages don't sit in
  // memory at once.
  useEffect(() => {
    if (near) return;
    taskRef.current?.cancel();
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, [near]);

  return (
    <div
      ref={holderRef}
      className="shrink-0 rounded-lg bg-white shadow-sm overflow-hidden"
      style={{ width: cssW, height: cssH }}
    >
      {/* The bitmap is stretched to the CSS size rather than matching it, which is
          what lets the page be laid out at the new zoom while the redraw is still a
          beat behind: it is briefly a scaled copy of itself, then it sharpens.
          Sized here rather than imperatively so it can never disagree with the
          holder. */}
      <canvas
        ref={canvasRef}
        aria-label={label}
        className="block"
        style={{ width: cssW, height: cssH }}
      />
    </div>
  );
}
