'use client';

import { useEffect, useState } from 'react';

export interface ViewportBox { top: number; height: number }

/**
 * The box a full-screen fixed layer should occupy so the iOS keyboard does not
 * cover its bottom (brief 2026-11-18, 3.1). On iOS a `position:fixed; inset:0`
 * element keeps the layout-viewport height when the keyboard opens; the visual
 * viewport is what shrinks (and may be panned by `offsetTop`). Null when the
 * visual viewport is the whole window (no keyboard, desktop), so the CSS 100dvh
 * height stands.
 */
export function viewportBox(innerHeight: number, vv: { height: number; offsetTop: number } | null | undefined): ViewportBox | null {
  if (!vv || !(vv.height > 0)) return null;
  if (Math.abs(innerHeight - vv.height) < 1 && vv.offsetTop < 1) return null;
  return { top: Math.max(0, Math.round(vv.offsetTop)), height: Math.round(vv.height) };
}

/**
 * Tracks `viewportBox` for the current window. For ONE screen (the staff thread),
 * deliberately not the global viewport meta (`interactive-widget`), which would
 * change every page of the app.
 */
export function useVisualViewportBox(): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBox(viewportBox(window.innerHeight, vv));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return box;
}
