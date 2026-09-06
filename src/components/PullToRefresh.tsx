'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { APP_SCROLL_ID, appScrollTop } from '@/lib/app-scroll';

// Native-style pull-to-refresh for the installed iOS PWA (Safari's built-in PTR
// doesn't exist in standalone mode, so we hand-roll it).
//
// The app scrolls inside <main>, not the document (see lib/app-scroll.ts), so
// "am I at the very top?" is that element's scrollTop — and the nested-scroller
// bail-out below has to let it through, or it would swallow every pull on every
// screen. We still listen on window because touch events bubble there.
// We only engage when already at the top and the gesture is a downward drag.
// A spinner follows the finger with a
// resistance curve; releasing past THRESHOLD triggers a full reload
// (window.location.reload) — dashboard pages fetch their data on mount, so a
// reload is the correct, complete refresh.
//
// Mounted once in the dashboard layout → works on every /dashboard/* page.
const THRESHOLD = 70; // px pulled before a release triggers refresh
const MAX_PULL = 110; // px cap on the indicator travel
const RESISTANCE = 0.5; // drag feels heavier than 1:1 finger movement

export function PullToRefresh() {
  const pathname = usePathname();
  const disabled = pathname.startsWith('/dashboard/run-chat/');
  const [pull, setPull] = useState(0); // current indicator offset in px
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const dragging = useRef(false);
  const pullRef = useRef(0); // mirror of `pull` for the touchend handler

  useEffect(() => {
    // Skip entirely on non-touch devices — no gesture to support.
    if (
      typeof window === 'undefined' ||
      !('ontouchstart' in window) ||
      disabled
    ) {
      return;
    }

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest(
          '[data-pull-to-refresh-ignore], input, textarea, [contenteditable="true"]',
        )
      ) {
        dragging.current = false;
        return;
      }

      // Nested scroll areas own their vertical gesture, even when they are at
      // scrollTop 0. Otherwise a chat/list drag can become a page reload.
      let ancestor: Element | null = target;
      while (ancestor && ancestor !== document.body) {
        // The app scroller is the page as far as this gesture is concerned — it
        // is what the "at the top?" test below reads. Only scrollers INSIDE it
        // (a chat pane, a lap table) own their own vertical drag.
        if (ancestor.id === APP_SCROLL_ID) break;
        const style = window.getComputedStyle(ancestor);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          ancestor.scrollHeight > ancestor.clientHeight
        ) {
          dragging.current = false;
          return;
        }
        ancestor = ancestor.parentElement;
      }

      // Only begin if scrolled to the very top and not already refreshing.
      if (refreshing) return;
      if (appScrollTop() > 0) { dragging.current = false; return; }
      startY.current = e.touches[0].clientY;
      dragging.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        // Upward / no movement → not our gesture; release it back to the page.
        if (pullRef.current !== 0) { pullRef.current = 0; setPull(0); }
        return;
      }
      // Downward drag from the top: we own it. preventDefault needs a
      // non-passive listener (added below) so the native rubber-band doesn't fight us.
      e.preventDefault();
      const offset = Math.min(dy * RESISTANCE, MAX_PULL);
      pullRef.current = offset;
      setPull(offset);
    };

    const onTouchEnd = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (pullRef.current >= THRESHOLD && !refreshing) {
        setRefreshing(true);
        pullRef.current = THRESHOLD;
        setPull(THRESHOLD);
        // Let the spinner paint one frame, then reload.
        setTimeout(() => window.location.reload(), 150);
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [disabled, refreshing]);

  // Progress 0→1 toward the threshold; drives rotation + fade before release.
  const progress = Math.min(pull / THRESHOLD, 1);
  const visible = pull > 0 || refreshing;

  if (disabled) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-[150] flex justify-center pointer-events-none"
      style={{
        transform: `translateY(${(refreshing ? THRESHOLD : pull) - 44}px)`,
        transition: dragging.current ? 'none' : 'transform 0.24s cubic-bezier(.2,.8,.2,1)',
        opacity: visible ? 1 : 0,
      }}
    >
      <div
        className="mt-2 flex items-center justify-center w-9 h-9 rounded-full bg-card/95 border border-ink-300 shadow-lg safe-top"
        style={{ boxShadow: '0 4px 14px rgba(0,0,0,.35)' }}
      >
        <RefreshCw
          className={refreshing ? 'h-4.5 w-4.5 text-brand-600 animate-spin' : 'h-4.5 w-4.5 text-brand-600'}
          style={
            refreshing
              ? undefined
              : { transform: `rotate(${progress * 270}deg)`, opacity: 0.5 + progress * 0.5 }
          }
        />
      </div>
    </div>
  );
}
