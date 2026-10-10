'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { N, PrimaryButton } from './ui';

// ── The wheel (second tap on a blue number) ─────────────────────────────────────────────
//
// For the change the − + would take twenty taps to make: 800 → 2000, 4:05 → 3:40. An iOS
// picker wheel — scroll-snap, the value under the band is the value — because that is the
// control an iPhone user already has in their thumb, and Apple's guidance is exactly this
// split: a stepper for small moves, a picker when large changes are likely.
//
// Every row is also a button, so the wheel works without scrolling at all (and with a
// keyboard or VoiceOver), and the confirm button is 56px at the bottom where the thumb is.

const ROW = 48;

export function Wheel({ title, options, value, format, onPick, onClose }: {
  title: string;
  options: number[];
  value: number;
  format: (v: number) => string;
  onPick: (v: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations('workoutBook');
  const list = useRef<HTMLDivElement>(null);
  const start = Math.max(0, options.findIndex(o => Math.abs(o - value) < 1e-6));
  const [index, setIndex] = useState(start);

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = start * ROW;
  }, [start]);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setIndex(Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ROW)))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [options.length]);

  const choose = (i: number) => {
    setIndex(i);
    list.current?.scrollTo({ top: i * ROW, behavior: 'smooth' });
  };

  return (
    <>
      <button type="button" aria-label={t('a11y.closeWheel')} onClick={onClose} className="absolute inset-0 z-10 bg-black/20" />
      <div
        role="dialog"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 z-20 rounded-t-[22px] bg-white px-[18px] pt-3 shadow-[0_-10px_30px_rgba(20,22,40,.12)]"
        style={{ paddingBottom: 'max(30px, env(safe-area-inset-bottom))' }}
        dir="rtl"
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-ink-300" aria-hidden />
        <p className="text-center text-sm font-extrabold text-ink-400">{title}</p>
        <div className="relative my-2">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-12 -translate-y-1/2 rounded-xl bg-[#F4F4F8]" />
          <div
            ref={list}
            role="listbox"
            aria-label={title}
            className="relative h-[240px] snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none]"
            style={{ paddingTop: ROW * 2, paddingBottom: ROW * 2 }}
          >
            {options.map((o, i) => (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={i === index}
                onClick={() => choose(i)}
                className={cn(
                  'flex w-full snap-center items-center justify-center transition-[font-size,color]',
                  i === index ? 'text-[30px] font-black text-ink-900' : 'text-xl font-bold text-ink-400',
                )}
                style={{ height: ROW }}
              >
                <N>{format(o)}</N>
              </button>
            ))}
          </div>
        </div>
        <PrimaryButton className="w-full" onClick={() => onPick(options[index] ?? value)}>{t('wheelDone')}</PrimaryButton>
      </div>
    </>
  );
}
