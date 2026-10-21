'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { currentStep, targetsOf, type TourDef } from '@/lib/tour/engine';
import { TOURS } from '@/lib/tour/coach-tour';
import { dispatchTour, TOUR_FILL_EVENT, TOUR_REPLAY_EVENT, useTour } from '@/lib/tour/store';
import { useTourPrefs } from '@/lib/tour/use-prefs';

// ═════════════════════════════════════════════════════════════════════════════
// The guided tour's overlay (mockups/coach-intro/v2.html): over the REAL screens, never a
// picture of them. A soft round spotlight on the element a step names (`data-tour`), a
// progress bar with "דילוג", and a bubble that sits under the element or, when there is no
// room, above it. "do" steps pulse and show a finger; they move on only when the real
// control is tapped (the capture listener below). Everything else on the screen is behind
// four blockers around the hole, so a stray tap cannot wander off the path.
//
// Practice: lib/tour/practice.ts holds back every write while the steps run.
// ═════════════════════════════════════════════════════════════════════════════

const BLUE = '#1525FF';
const Z = 9500;
const PAD = 6;

interface Box { top: number; left: number; width: number; height: number }

function findTarget(names: string[]): HTMLElement | null {
  for (const n of names) {
    const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${n}"]`));
    const el = all.find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (el) return el;
  }
  return null;
}

function viewport() {
  const v = typeof window !== 'undefined' ? window.visualViewport : null;
  return { w: v?.width ?? window.innerWidth, h: v?.height ?? window.innerHeight, top: v?.offsetTop ?? 0 };
}

export function TourOverlay() {
  const s = useTour();
  const router = useRouter();
  const def: TourDef | null = s.tour ? TOURS[s.tour] ?? null : null;
  const step = currentStep(s, def);
  const { save } = useTourPrefs(s.phase !== 'idle');
  const [box, setBox] = useState<Box | null>(null);
  const [mounted, setMounted] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubbleH, setBubbleH] = useState(160);
  const savedEnd = useRef<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // A replay from "עוד": open the coach area, then start at step 1.
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail || 'coach';
      router.push('/dashboard/academy');
      setTimeout(() => dispatchTour({ type: 'START', tour: id }), 450);
    };
    window.addEventListener(TOUR_REPLAY_EVENT, on);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, on);
  }, [router]);

  // How it ended is remembered once, so it is never offered again.
  useEffect(() => {
    if (s.phase === 'done' && s.tour && s.ended && savedEnd.current !== `${s.tour}:${s.ended}`) {
      savedEnd.current = `${s.tour}:${s.ended}`;
      save({ tour: s.tour, state: s.ended });
    }
    if (s.phase !== 'done') savedEnd.current = null;
  }, [s.phase, s.tour, s.ended, save]);

  // Follow the target: it may not be on screen yet (a page loading, a sheet opening), and it
  // moves with scrolling, rotation and the keyboard.
  useEffect(() => {
    if (!step) { setBox(null); return; }
    const names = targetsOf(step);
    let raf = 0;
    let scrolled = false;
    const tick = () => {
      const el = findTarget(names);
      if (el) {
        if (!scrolled) {
          scrolled = true;
          const r0 = el.getBoundingClientRect();
          const { h } = viewport();
          if (r0.top < 70 || r0.bottom > h - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        const r = el.getBoundingClientRect();
        setBox((b) => (b && Math.abs(b.top - r.top) < 0.5 && Math.abs(b.left - r.left) < 0.5 && b.width === r.width && b.height === r.height
          ? b : { top: r.top, left: r.left, width: r.width, height: r.height }));
      } else {
        setBox(null);
      }
      raf = window.setTimeout(tick, 180) as unknown as number;
    };
    tick();
    return () => window.clearTimeout(raf);
  }, [step]);

  useLayoutEffect(() => {
    if (bubbleRef.current) setBubbleH(bubbleRef.current.getBoundingClientRect().height);
  }, [step, box]);

  // "do" steps: the real control was tapped. The trainee row is the one exception that is
  // taken over: the tour opens that trainee's week itself (the row would open a sheet).
  useEffect(() => {
    if (!step || step.kind !== 'do') return;
    const names = targetsOf(step);
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const hit = t?.closest<HTMLElement>(names.map((n) => `[data-tour="${n}"]`).join(','));
      if (!hit) return;
      const name = hit.getAttribute('data-tour') || names[0];
      if (step.id === 'trainee') {
        const athleteId = hit.getAttribute('data-tour-athlete');
        e.preventDefault();
        e.stopPropagation();
        if (athleteId) router.push(`/dashboard/academy/week?athleteId=${encodeURIComponent(athleteId)}`);
      }
      setTimeout(() => dispatchTour({ type: 'TARGET_TAPPED', target: name }), 60);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [step, router]);

  const next = useCallback(() => {
    if (step?.id === 'text') {
      // Fill the box if it is still empty, then the real "continue" — the next step is on the adjust screen.
      const box = document.querySelector<HTMLTextAreaElement>('[data-tour="quick-text"] textarea, textarea[data-tour="quick-text"]');
      if (box && !box.value.trim()) window.dispatchEvent(new Event(TOUR_FILL_EVENT));
      setTimeout(() => {
        document.querySelector<HTMLButtonElement>('[data-tour="quick-continue"] button, button[data-tour="quick-continue"]')?.click();
        dispatchTour({ type: 'NEXT' });
      }, 120);
      return;
    }
    dispatchTour({ type: 'NEXT' });
  }, [step]);

  if (!mounted || !def || s.phase === 'idle' || s.phase === 'done') return null;

  const total = def.steps.length;

  if (s.phase === 'opening' || s.phase === 'closing') {
    const sheet = s.phase === 'opening' ? def.opening : def.closing;
    const closing = s.phase === 'closing';
    return createPortal(
      <div className="fixed inset-0 flex items-end" style={{ zIndex: Z }} dir="rtl" role="dialog" aria-modal="true" aria-label={sheet.title}>
        <div className="absolute inset-0 bg-[rgba(8,10,28,.5)]" />
        <div className="relative w-full rounded-t-[28px] bg-white px-[22px] pt-2.5 text-center" style={{ paddingBottom: 'calc(26px + env(safe-area-inset-bottom))' }}>
          <div className="mx-auto mb-3.5 h-[5px] w-10 rounded-full bg-[#D1D5DB]" />
          <div className="text-[46px] leading-none" aria-hidden>{sheet.emoji}</div>
          <h3 className="mb-1.5 mt-2 text-[23px] font-black text-ink-900">{sheet.title}</h3>
          <p className="mb-3 text-[15px] leading-relaxed text-ink-500">{sheet.body}</p>
          <div className="mb-3 space-y-2 text-start">
            {sheet.points.map((p, i) => (
              <div key={p} className="flex items-center gap-2.5 rounded-2xl bg-[#F6F7F9] px-3.5 py-2.5 text-[15px] font-bold text-ink-900">
                {closing && <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-[13px] font-black text-white" style={{ background: BLUE }}>{i + 1}</span>}
                <span>{p}</span>
              </div>
            ))}
          </div>
          {sheet.note && <p className="mb-3 text-[13px] leading-relaxed text-ink-400">{sheet.note}</p>}
          <button type="button"
            onClick={() => {
              if (closing) { dispatchTour({ type: 'FINISH' }); router.push('/dashboard/academy'); }
              else dispatchTour({ type: 'BEGIN' });
            }}
            className="min-h-[54px] w-full rounded-2xl text-[17px] font-black text-white" style={{ background: BLUE }}>
            {sheet.cta}
          </button>
          <button type="button" onClick={() => (closing ? (dispatchTour({ type: 'FINISH' }), router.push('/dashboard/academy')) : dispatchTour({ type: 'LATER' }))}
            className="mt-2 min-h-[44px] w-full text-[14px] font-bold text-ink-500">
            {sheet.secondary}
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  if (!step) return null;
  const { w: vw, h: vh, top: vTop } = viewport();
  const hole = box ? { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 } : null;
  const doing = step.kind === 'do';
  // The bubble: under the hole when it fits, otherwise above; never off screen.
  const bw = Math.min(320, vw - 24);
  let bTop = vh / 2 - bubbleH / 2;
  let arrowUp = true;
  if (hole) {
    const below = hole.top + hole.height + 16;
    if (below + bubbleH < vh - 16) { bTop = below; arrowUp = true; }
    else { bTop = Math.max(64, hole.top - bubbleH - 16); arrowUp = false; }
  }
  const center = hole ? hole.left + hole.width / 2 : vw / 2;
  const bLeft = Math.min(Math.max(12, center - bw / 2), vw - bw - 12);
  const arrowX = Math.min(Math.max(22, center - bLeft), bw - 22);
  const block = (st: React.CSSProperties) => <div className="fixed" style={{ ...st, zIndex: Z }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} />;

  return createPortal(
    <div dir="rtl" aria-live="polite">
      {/* Four blockers around the hole: the rest of the screen does nothing while touring. */}
      {hole ? (
        <>
          {block({ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) })}
          {block({ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 })}
          {block({ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height })}
          {block({ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height })}
          {!doing && block({ top: hole.top, left: hole.left, width: hole.width, height: hole.height })}
        </>
      ) : block({ inset: 0 })}
      {/* The spotlight: a rounded window, the rest dimmed by its own shadow. */}
      <div className={doing ? 'mc-tour-spot mc-tour-pulse' : 'mc-tour-spot'} aria-hidden
        style={{
          position: 'fixed', zIndex: Z + 1, pointerEvents: 'none', borderRadius: 16, transition: 'all .25s ease',
          ...(hole ? { top: hole.top, left: hole.left, width: hole.width, height: hole.height } : { top: vh / 2, left: vw / 2, width: 0, height: 0 }),
          boxShadow: '0 0 0 4px #fff, 0 0 0 200vmax rgba(8,10,28,.64)',
        }} />
      {/* Progress, with the way out. */}
      <div className="fixed flex items-center gap-2.5 rounded-[14px] bg-white/95 px-3 py-2 shadow-[0_4px_14px_rgba(0,0,0,.2)]"
        style={{ zIndex: Z + 2, top: `calc(${vTop + 8}px + env(safe-area-inset-top))`, insetInline: 12 }}>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#E5E7EB]">
          <span className="block h-full rounded-full" style={{ width: `${((s.index + 1) / total) * 100}%`, background: BLUE }} />
        </span>
        <span className="whitespace-nowrap text-[12.5px] font-extrabold text-ink-700">{def.name} · <bdi dir="ltr">{s.index + 1}/{total}</bdi></span>
        <button type="button" onClick={() => dispatchTour({ type: 'SKIP' })} className="-my-2 min-h-[40px] px-1 text-[12.5px] font-bold text-ink-500">דילוג</button>
      </div>
      {/* The bubble. */}
      <div ref={bubbleRef} className="fixed rounded-[20px] bg-white px-4 pb-3 pt-3.5 shadow-[0_18px_40px_rgba(0,0,0,.4)]"
        style={{ zIndex: Z + 3, top: bTop, left: bLeft, width: bw, transition: 'top .25s ease, left .25s ease' }}>
        {hole && <i aria-hidden className="absolute h-[18px] w-[18px] rotate-45 bg-white" style={{ [arrowUp ? 'top' : 'bottom']: -8, left: arrowX - 9 }} />}
        <b className="relative block text-[17.5px] font-black text-ink-900">{step.title}</b>
        <p className="relative mb-3 mt-1.5 text-[14.5px] leading-relaxed text-ink-700">{hole ? step.body : 'רגע, המסך נטען…'}</p>
        <div className="relative flex flex-wrap items-center justify-end gap-2">
          {step.id === 'text' && (
            <button type="button" onClick={() => window.dispatchEvent(new Event(TOUR_FILL_EVENT))}
              className="min-h-[40px] rounded-xl px-3 text-[13.5px] font-black text-white" style={{ background: `linear-gradient(90deg,#7C3AED,${BLUE})` }}>
              ✨ הקלד בשבילי דוגמה
            </button>
          )}
          {doing
            ? <span className="rounded-xl bg-[#EEF0FF] px-3.5 py-2.5 text-[14px] font-black" style={{ color: BLUE }}>👆 לחצו על המקום המואר</span>
            : <button type="button" onClick={next} disabled={!hole} className="min-h-[40px] rounded-xl px-4 text-[14.5px] font-black text-white disabled:opacity-50" style={{ background: BLUE }}>{step.next ?? 'הבא'}</button>}
        </div>
      </div>
      {doing && hole && (
        <div aria-hidden className="mc-tour-hand fixed text-[40px]"
          style={{ zIndex: Z + 2, pointerEvents: 'none', top: Math.min(hole.top + hole.height - 6, vh - 56), left: hole.left + hole.width / 2 - 14 }}>👆</div>
      )}
      <style>{`
        .mc-tour-pulse{animation:mcTourPulse 1.5s ease-in-out infinite}
        @keyframes mcTourPulse{50%{box-shadow:0 0 0 9px rgba(255,255,255,.7),0 0 0 200vmax rgba(8,10,28,.64)}}
        .mc-tour-hand{animation:mcTourHand 1.1s ease-in-out infinite;filter:drop-shadow(0 5px 8px rgba(0,0,0,.35))}
        @keyframes mcTourHand{50%{transform:translateY(-12px) scale(.95)}}
        @media (prefers-reduced-motion: reduce){.mc-tour-pulse,.mc-tour-hand{animation:none}}
      `}</style>
    </div>,
    document.body,
  );
}
