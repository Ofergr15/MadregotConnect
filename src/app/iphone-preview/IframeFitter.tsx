'use client';

import { useEffect } from 'react';

// Scales each fixed-size (390x844 logical px) iframe to fit its phone
// frame's actual on-screen box. Runs in a post-hydration effect (not an
// inline <script>) so the server-rendered markup and first client render
// match exactly — mutating .ipv-scaler's inline style during SSR/hydration
// would otherwise trigger a hydration mismatch.
export function IframeFitter() {
  useEffect(() => {
    const fit = () => {
      document.querySelectorAll<HTMLElement>('.ipv-screen').forEach((screen) => {
        const w = parseFloat(screen.dataset.w || '390');
        const box = screen.getBoundingClientRect();
        const scale = box.width / w;
        const scaler = screen.querySelector<HTMLElement>('.ipv-scaler');
        if (!scaler) return;
        scaler.style.width = `${w}px`;
        scaler.style.height = `${screen.dataset.h || '844'}px`;
        scaler.style.transform = `scale(${scale})`;
      });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  return null;
}
