'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A recorded demo of a change, playing inside a phone frame on a soft tint — the
 * "What's new" pages and the page for one change (mockup ~/.cache/madregot/whats-new-v6.html,
 * Ofer 2026-10-19). Silent, looping, inline; for someone who asked the phone for less
 * motion it stays on the still (`poster`) with a tap to play.
 */

export const DEMO_TINTS = [
  ['#E8ECFF', '#C9D2FF'],
  ['#FCE9F2', '#F6C9DE'],
  ['#FFF0E3', '#FBD7B8'],
  ['#E6F6EC', '#BFE6CD'],
] as const;

export function DemoPhone({ src, poster, tint = 0, height, phoneWidth, className, playing = true }: {
  src: string;
  poster?: string;
  /** Which of DEMO_TINTS, so neighbouring pages differ. */
  tint?: number;
  /** The panel's height; the phone runs off its bottom edge. */
  height: number;
  phoneWidth: number;
  className?: string;
  /** False pauses it — a page that is not the one on screen. */
  playing?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(false);
  useEffect(() => { setStill(!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches); }, []);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing && !still) v.play().catch(() => { /* autoplay refused: the poster stays */ });
    else v.pause();
  }, [playing, still]);
  const [a, b] = DEMO_TINTS[tint % DEMO_TINTS.length];
  return (
    <div className={cn('relative overflow-hidden', className)} style={{ height, background: `radial-gradient(120% 90% at 50% 0%, ${a} 0%, ${b} 100%)` }}>
      <div className="absolute left-1/2 top-7 -translate-x-1/2 rounded-[38px] bg-[#0B0B0D] p-[7px] shadow-[0_28px_46px_-18px_rgba(20,24,60,0.55)]" style={{ width: phoneWidth }}>
        <div className="relative overflow-hidden rounded-[31px] bg-page" dir="ltr">
          <div className="flex h-[26px] items-center justify-between bg-[#E6E6E6] pe-[18px] ps-[22px] text-[10.5px] font-bold text-[#111]">
            <span>07:12</span>
            <span className="flex items-center gap-1" aria-hidden>
              <i className="block h-2 w-[13px] bg-[#111] [clip-path:polygon(0_100%,100%_0,100%_100%)]" />
              <i className="block h-[9px] w-[19px] rounded-[3px] border-[1.4px] border-[#111] p-px"><i className="block h-full w-[70%] rounded-[1px] bg-[#111]" /></i>
            </span>
          </div>
          <video
            ref={ref}
            src={src}
            poster={poster}
            muted
            loop
            playsInline
            preload="metadata"
            className="block w-full"
            onClick={() => { if (still && ref.current) { ref.current.play().catch(() => {}); setStill(false); } }}
          />
          <i className="absolute left-1/2 top-1.5 h-4 w-[30%] -translate-x-1/2 rounded-[10px] bg-[#0B0B0D]" aria-hidden />
        </div>
      </div>
    </div>
  );
}
