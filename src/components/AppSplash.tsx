'use client';

import { useEffect, useState } from 'react';

// App-open loading splash: a white logo on a black field that grows from tiny
// to full size with one smooth rotation, holds briefly, then the whole layer
// fades out to reveal the app. Shows once per browser session (cold open /
// PWA launch), never on client-side route transitions.
//
// Timing: entrance 1900ms + hold 250ms -> start fade; fade 550ms -> unmount.
const ENTRANCE_MS = 1900;
const HOLD_MS = 250;
const FADE_MS = 550;
const SESSION_KEY = 'app_splash_shown';

export function AppSplash() {
  // Renders visible on the very first paint (server + client identical, so no
  // hydration mismatch). The decision to skip/animate happens in effects only.
  const [phase, setPhase] = useState<'in' | 'out' | 'done'>('in');

  useEffect(() => {
    // Already shown this session (e.g. locale reload / re-mount) -> skip instantly.
    if (sessionStorage.getItem(SESSION_KEY)) {
      setPhase('done');
      return;
    }
    sessionStorage.setItem(SESSION_KEY, '1');

    const toOut = setTimeout(() => setPhase('out'), ENTRANCE_MS + HOLD_MS);
    const toDone = setTimeout(() => setPhase('done'), ENTRANCE_MS + HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(toOut);
      clearTimeout(toDone);
    };
  }, []);

  if (phase === 'done') return null;

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden ${
        phase === 'out' ? 'app-splash-out' : ''
      }`}
      // Match the app/manifest background (#0f172a) so there's no black→slate
      // jump on cold launch; a soft brand-indigo radial glow makes it feel
      // branded rather than utilitarian.
      style={{ background: 'radial-gradient(120% 90% at 50% 42%, #16213b 0%, #0f172a 55%, #0b1120 100%)' }}
    >
      <div className="relative flex items-center justify-center">
        <div
          className="absolute w-[280px] h-[280px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(67,56,255,.35) 0%, rgba(67,56,255,0) 70%)', filter: 'blur(8px)' }}
        />
        <img
          src="/images/logo-white.png"
          alt=""
          width={150}
          height={150}
          className="relative h-[150px] w-[150px] animate-app-open-icon"
        />
      </div>
    </div>
  );
}
