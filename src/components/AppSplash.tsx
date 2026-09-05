'use client';

import { useEffect, useState } from 'react';

// App-open loading splash: ink floods the logo's staircase bottom-to-top (the
// badge is used as a mask), the mark snaps to solid ink when the fill tops out,
// then the whole layer fades out to reveal the app.
//
// Deliberately monochrome — no brand blue anywhere on this layer. The logo is a
// black mark, so a grey-to-ink fill is the mark filling itself in; the blue it
// used to be was the only colour in the whole launch and read as a different
// brand than the one on the badge. The fill still has to be *lighter* than the
// ink it settles to (see .app-fill-fluid in globals.css) or the snap at the top
// of the rise has nothing to snap to.
//
// Shows once per browser session (cold open / PWA launch), never on client-side
// route transitions.
//
// It's on the light system like everything else — it used to be a white logo on
// a dark navy field, which now means every cold launch would flash dark and then
// snap to a light app.
//
// Was: the badge grew from 10% to full while spinning a complete 360deg over
// 1900ms. That spun the circular lockup's wordmark (MADREGOT / Running Club)
// upside-down halfway through every single launch, and ran 2700ms end to end.
// The mark now doesn't move at all, so it's readable from the first frame.
//
// Timing: entrance 1530ms + hold 170ms -> start fade; fade 420ms -> unmount.
// The 1530ms is not arbitrary — it's when the fill + ink-snap finish. The
// matching per-element delays live in globals.css (.app-fill-*); the two have
// to move together or the layer starts fading mid-fill.
const ENTRANCE_MS = 1530;
const HOLD_MS = 170;
const FADE_MS = 420;
const SESSION_KEY = 'app_splash_shown';

// Whether this JS runtime has already kicked the animation off. Module scope, so
// it survives a remount but not a page load — which is exactly the distinction
// the sessionStorage check below can't make on its own.
//
// Without it, React StrictMode's dev-only mount/unmount/remount means pass 1
// writes SESSION_KEY and pass 2 reads it back and skips, so the splash never
// plays in `next dev` at all — only in a production build. That made the thing
// impossible to iterate on locally.
let startedInThisRuntime = false;

export function AppSplash() {
  // Renders visible on the very first paint (server + client identical, so no
  // hydration mismatch). The decision to skip/animate happens in effects only.
  const [phase, setPhase] = useState<'in' | 'out' | 'done'>('in');
  useEffect(() => {
    // Already shown this session (e.g. locale reload) -> skip instantly. Our own
    // key from a moment ago doesn't count, hence the runtime flag.
    if (!startedInThisRuntime && sessionStorage.getItem(SESSION_KEY)) {
      setPhase('done');
      return;
    }
    startedInThisRuntime = true;
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
      // `app-splash-layer` is the CSS-only failsafe (see globals.css): it takes
      // this layer away on its own at 4s even if none of the JS below ever runs.
      className={`app-splash-layer fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden ${
        phase === 'out' ? 'app-splash-out' : ''
      }`}
      // Card white in the middle easing out to the page grey (#DFDFDF) — the same
      // colour as the manifest's background and the app body, so there's no jump
      // when the layer fades.
      style={{ background: 'radial-gradient(120% 90% at 50% 42%, #FFFFFF 0%, #DFDFDF 60%, #D2D2D2 100%)' }}
    >
      <div className="relative flex items-center justify-center">
        {/* Blooms only once the fill tops out, so the "arrived" beat is the glow
            and the ink snap together rather than an ambient halo throughout. In
            ink rather than blue it reads as the mark casting a soft shadow onto
            the white — which is why it's kept this faint: any denser and the
            bloom looks like a smudge instead of a lift. */}
        <div
          className="app-fill-halo absolute h-[230px] w-[230px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(29,30,38,.14) 0%, rgba(29,30,38,0) 70%)', filter: 'blur(8px)' }}
        />
        <div className="relative h-[150px] w-[150px]">
          {/* The unfilled mark: the real logo flattened to black by
              `brightness-0` (the treatment the Header gives it on the page
              grey) and dropped to a hairline presence, so the lockup is
              readable before any ink arrives. */}
          <img
            src="/images/logo.png"
            alt=""
            width={150}
            height={150}
            className="absolute inset-0 h-full w-full object-contain opacity-[0.14] brightness-0"
          />
          {/* Everything inside here is clipped to the logo's silhouette. */}
          <div className="app-fill-mask absolute inset-0 overflow-hidden">
            <div className="app-fill-fluid absolute inset-x-0 bottom-0" />
            {/* The finished state: solid ink, faded in over the topped-out
                fill, matching how the mark appears everywhere else. */}
            <div className="app-fill-settle absolute inset-0" />
          </div>
        </div>
      </div>
      {/* Paces the fill so it reads as a level being reached rather than an
          animation of unknown length. Honest about what it is: both this and the
          fill run on the timer above, not on real load progress. Block child, so
          it fills from the inline start in both LTR and RTL. */}
      <div className="app-fill-level mt-[22px] h-[3px] w-[112px] overflow-hidden rounded-pill bg-ink-900/10">
        <i className="block h-full rounded-pill bg-ink-900" />
      </div>
    </div>
  );
}
