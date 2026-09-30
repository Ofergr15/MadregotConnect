'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShownNote } from '@/lib/release-notes';
import type { WhatsNewDemo, WhatsNewEntry, WhatsNewLang } from '@/lib/whats-new/entries';

/**
 * WHAT'S NEW AS A TOUR — version A of the showcase mockup, the one he picked for
 * the evening release (lib/whats-new/evening.ts).
 *
 * Full screen, like a story: a page per headline, its card cycling through the
 * real views, and a button that opens the feature on the reader's own run or
 * week. A headline with a `demo` gets a second page that shows its editor at
 * work: a finger taps through real captures of it, where the app is tapped,
 * with a caption for each tap and the part being edited lit underneath. After
 * the headlines, one page with everything else since the last What's new. It moves on by itself after a while, but never closes by itself: the last
 * page waits for a tap.
 *
 * Tapping works as on an Instagram story, anywhere on the screen: the half the
 * reading starts from goes back, the other half goes on (in Hebrew, right is
 * back and left is next), and holding a finger down pauses until it lifts. The
 * buttons and the list sit above the two halves and stay what they are.
 *
 * The buttons are real <Link>s inside role="dialog", which is also how the
 * release rehearsal catches them and opens the page in its frame instead.
 */

const PAGE_MS = 9000;
const FRAME_MS = 1800;
/** A press longer than this is a hold (pause), not a tap. */
const HOLD_MS = 250;
/** A demo tap: the finger travels, presses, and the screen changes under it. */
const STEP_MS = 1500;
/** The finished card stays up this long after the demo's last tap. */
const DEMO_TAIL_MS = 2200;
const PARTS = ['numbers', 'logo', 'text', 'background'] as const;

type Slide = { entry: WhatsNewEntry; demo?: WhatsNewDemo };

export function WhatsNewStory({
  entries, more, version, onClose, offsetTop = 0,
}: {
  /** The headlines lead; any other entry joins the last page with `more`. */
  entries: WhatsNewEntry[];
  more: ShownNote[];
  version: string;
  onClose: () => void;
  /** Room left at the top for something drawn over the tour (the rehearsal's bar). */
  offsetTop?: number;
}) {
  const t = useTranslations('whatsNew');
  const lang: WhatsNewLang = useLocale() === 'en' ? 'en' : 'he';
  const headlines = entries.filter((e) => e.cards?.length);
  const rows = entries.filter((e) => !e.cards?.length);
  const slides: Slide[] = headlines.flatMap((e) => (e.demo ? [{ entry: e }, { entry: e, demo: e.demo }] : [{ entry: e }]));
  const hasRest = rows.length + more.length > 0;
  const pages = slides.length + (hasRest ? 1 : 0);
  const [at, setAt] = useState(0);
  const [spent, setSpent] = useState(0);
  const [progress, setProgress] = useState(0);
  const [mounted, setMounted] = useState(false);
  const still = useRef(false);
  const held = useRef(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; go: () => void } | null>(null);

  useEffect(() => {
    setMounted(true);
    still.current = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const last = at >= pages - 1;
  const next = () => (last ? onClose() : setAt((n) => n + 1));
  const prev = () => setAt((n) => Math.max(0, n - 1));

  // The page's own clock: the bar fills, then the next page. Not on the last one.
  // It only runs while no finger is held down, and the art stops with it.
  const demoSteps = slides[at]?.demo?.steps.length;
  useEffect(() => {
    setProgress(0);
    setSpent(0);
    if (still.current) return;
    const length = demoSteps ? demoSteps * STEP_MS + DEMO_TAIL_MS : PAGE_MS;
    let ran = 0;
    let before = Date.now();
    const bar = setInterval(() => {
      const now = Date.now();
      if (!held.current) ran += now - before;
      before = now;
      const p = Math.min(1, ran / length);
      setProgress(p);
      setSpent(ran);
      if (p >= 1 && at < pages - 1) setAt((n) => n + 1);
      if (p >= 1) clearInterval(bar);
    }, 80);
    return () => clearInterval(bar);
  }, [at, pages, demoSteps]);

  // A short press turns the page, a long one pauses it for as long as it lasts.
  const down = (go: () => void) => () => {
    held.current = false;
    press.current = { go, timer: setTimeout(() => { held.current = true; }, HOLD_MS) };
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (held.current) held.current = false;
    else p.go();
  };
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    held.current = false;
  };
  const zone = (go: () => void, label: string, side: string) => (
    <button
      type="button"
      aria-label={label}
      onPointerDown={down(go)}
      onPointerUp={up}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}
      className={cn('absolute inset-y-0 w-1/2 select-none [-webkit-touch-callout:none]', side)}
    />
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted || pages === 0) return null;
  const slide = slides[at];
  const entry = slide?.entry;
  const demo = slide?.demo;
  const copy = demo ? demo[lang] : entry?.[lang];
  const frames = entry?.cards ?? [];
  const shown = frames.length ? frames[Math.floor(spent / FRAME_MS) % frames.length] : null;
  // Where the demo is: which tap, how far into it, and so which screen is up.
  // Reduced motion shows the finished card and no finger.
  const steps = demo?.steps ?? [];
  const tap = still.current ? steps.length : Math.min(steps.length, Math.floor(spent / STEP_MS));
  const into = tap < steps.length ? (spent - tap * STEP_MS) / STEP_MS : 1;
  const screen = tap + (tap < steps.length && into > 0.62 ? 1 : 0);
  const step = steps[tap];
  const ring = step && into > 0.45 ? Math.min(1, (into - 0.45) / 0.35) : 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      className="fixed inset-0 z-[460] flex flex-col bg-[#0b0d1d] px-[18px] pb-[calc(22px+env(safe-area-inset-bottom))] text-white"
      style={{ paddingTop: `calc(env(safe-area-inset-top) + ${10 + offsetTop}px)` }}
    >
      <div className="absolute inset-0 z-0">
        {zone(prev, t('tourBack'), 'start-0')}
        {zone(next, t('tourNext'), 'end-0')}
      </div>
      <div className="pointer-events-none relative z-[1] flex gap-1" aria-hidden>
        {Array.from({ length: pages }, (_, i) => (
          <i key={i} className="h-[3px] flex-1 overflow-hidden rounded-sm bg-white/25">
            <b className="block h-full bg-white" style={{ width: `${i < at ? 100 : i === at ? progress * 100 : 0}%` }} />
          </i>
        ))}
      </div>
      <div className="pointer-events-none relative z-[1] mt-2.5 flex items-center justify-between text-[12.5px] font-bold text-white/80">
        <span>{t('title')} · <bdi dir="ltr">{version}</bdi></span>
        <button type="button" onClick={onClose} aria-label={t('tourClose')} className="pointer-events-auto -me-2 flex h-10 w-10 items-center justify-center text-white active:opacity-60">
          <X className="h-5 w-5" />
        </button>
      </div>

      {entry && copy ? (
        <>
          {demo ? (
            <div className="pointer-events-none relative z-[1] flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-3">
              <div className="relative aspect-[390/844] h-full max-h-[460px] min-h-0 overflow-hidden rounded-[18px] bg-[#0b0d1d] shadow-[0_0_0_3px_#2a2d45,0_8px_28px_rgba(0,0,0,.5)]">
                {[demo.first, ...steps.map((x) => x.key)].map((key, i) => (
                  <img
                    key={key}
                    src={`/whats-new/edit/${key}.jpg`}
                    alt=""
                    className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-200', i === screen ? 'opacity-100' : 'opacity-0')}
                  />
                ))}
                {step && (
                  <>
                    <i
                      className="absolute -ms-[15px] -mt-[15px] h-[30px] w-[30px] rounded-full border-[3px] border-[#FF5A28]"
                      style={{ left: `${(step.x / 390) * 100}%`, top: `${(step.y / 844) * 100}%`, opacity: ring > 0 && ring < 1 ? 1 - ring : 0, transform: `scale(${1 + ring * 2.2})` }}
                    />
                    <i
                      className="absolute -ms-[15px] -mt-[15px] h-[30px] w-[30px] rounded-full bg-white/85 shadow-[0_0_0_3px_rgba(255,90,40,.9),0_4px_14px_rgba(0,0,0,.5)] transition-[left,top,transform] duration-[600ms] ease-in-out"
                      style={{ left: `${(step.x / 390) * 100}%`, top: `${(step.y / 844) * 100}%`, transform: `scale(${into > 0.42 && into < 0.6 ? 0.8 : 1})` }}
                    />
                  </>
                )}
              </div>
              <span className="rounded-pill bg-[#FF5A28] px-2.5 py-0.5 text-2xs font-bold">
                {step ? <><bdi dir="ltr">{tap + 1}/{steps.length}</bdi> · {step[lang]}</> : t('demoReady')}
              </span>
              <div className="flex gap-1.5">
                {PARTS.map((part) => (
                  <span
                    key={part}
                    className={cn('rounded-pill px-2 py-0.5 text-3xs font-extrabold transition-colors', step?.part === part ? 'bg-white text-ink-900' : 'bg-white/[.08] text-white/55')}
                  >
                    {t(`demoPart.${part}`)}
                  </span>
                ))}
              </div>
            </div>
          ) : (
          <div className="pointer-events-none relative z-[1] flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-3">
            <div className="pointer-events-none relative aspect-[9/16] h-full max-h-[400px] min-h-0 overflow-hidden rounded-[14px] bg-[#1b1150] shadow-[0_8px_28px_rgba(0,0,0,.45)]">
              {frames.map((f) => (
                <img
                  key={f.key}
                  src={`/whats-new/${f.key}.${lang}.jpg`}
                  alt=""
                  className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-300', f === shown ? 'opacity-100' : 'opacity-0')}
                />
              ))}
            </div>
            {shown && (
              <span className="pointer-events-none rounded-pill bg-white/15 px-2.5 py-0.5 text-2xs font-bold">{shown[lang]}</span>
            )}
          </div>
          )}
          <div className="pointer-events-none relative z-[1]">
          {copy.kicker && <p className="text-xs font-extrabold tracking-wide text-[#FF8A5C]">{copy.kicker}</p>}
          <h2 className={cn('mt-1 font-black leading-tight', demo ? 'text-2xl' : 'text-[26px]')}>{copy.title}</h2>
          <p className="mt-2 text-[14.5px] leading-normal text-white/75">{copy.body}</p>
          {copy.where && <p className="mt-2 text-xs text-white/55">{copy.where}</p>}
          </div>
          <div className="relative z-[1] mt-4 flex gap-2">
            <Link
              href={entry.href}
              onClick={onClose}
              className="flex h-[50px] flex-1 items-center justify-center rounded-[14px] bg-white text-[14.5px] font-extrabold text-ink-900 active:opacity-80"
            >
              {copy.cta}
            </Link>
            <button type="button" onClick={next} className="h-[50px] w-[110px] rounded-[14px] bg-white/[.12] text-[14.5px] font-extrabold active:opacity-80">
              {last ? t('tourDone') : t('tourNext')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="pointer-events-none relative z-[1] mt-4 text-xs font-extrabold tracking-wide text-[#FF8A5C]">{t('tourRestKicker')}</p>
          <h2 className="pointer-events-none relative z-[1] mt-1 text-[26px] font-black leading-tight">{t('more', { count: rows.length + more.length })}</h2>
          <ul className="relative z-[1] -mx-1 mt-3 min-h-0 flex-1 divide-y divide-white/10 overflow-y-auto px-1">
            {rows.map((e) => (
              <li key={e.slug}>
                <Link href={e.href} onClick={onClose} className="flex gap-3 py-3 active:opacity-70">
                  <span aria-hidden className="w-6 shrink-0 text-center text-lg">{e.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{e[lang].title}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-white/60">{e[lang].body}</span>
                  </span>
                </Link>
              </li>
            ))}
            {more.map((n) => (
              <li key={n.id} className="flex gap-3 py-3">
                <span aria-hidden className="w-6 shrink-0 text-center text-lg">{n.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{n.title}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-white/60">{n.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="relative z-[1] mt-4 flex gap-2">
            {slides.length > 0 && (
              <button type="button" onClick={prev} className="h-[50px] w-[110px] rounded-[14px] bg-white/[.12] text-[14.5px] font-extrabold active:opacity-80">
                {t('tourBack')}
              </button>
            )}
            <button type="button" onClick={onClose} className="h-[50px] flex-1 rounded-[14px] bg-white text-[14.5px] font-extrabold text-ink-900 active:opacity-80">
              {t('tourDone')}
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
