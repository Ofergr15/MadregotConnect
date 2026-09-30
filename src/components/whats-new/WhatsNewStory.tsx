'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShownNote } from '@/lib/release-notes';
import type { WhatsNewEntry, WhatsNewLang } from '@/lib/whats-new/entries';

/**
 * WHAT'S NEW AS A TOUR — version A of the showcase mockup, the one he picked for
 * the evening release (lib/whats-new/evening.ts).
 *
 * Full screen, like a story: a page per headline, its card cycling through the
 * real views, and a button that opens the feature on the reader's own run or
 * week. After the headlines, one page with everything else since the last What's
 * new. It moves on by itself after a while, but never closes by itself: the last
 * page waits for a tap.
 *
 * The buttons are real <Link>s inside role="dialog", which is also how the
 * release rehearsal catches them and opens the page in its frame instead.
 */

const PAGE_MS = 9000;
const FRAME_MS = 1800;

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
  const hasRest = rows.length + more.length > 0;
  const pages = headlines.length + (hasRest ? 1 : 0);
  const [at, setAt] = useState(0);
  const [frame, setFrame] = useState(0);
  const [progress, setProgress] = useState(0);
  const [mounted, setMounted] = useState(false);
  const still = useRef(false);

  useEffect(() => {
    setMounted(true);
    still.current = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const last = at >= pages - 1;
  const next = () => (last ? onClose() : setAt((n) => n + 1));
  const prev = () => setAt((n) => Math.max(0, n - 1));

  // The page's own clock: the bar fills, then the next page. Not on the last one.
  useEffect(() => {
    setProgress(0);
    setFrame(0);
    if (still.current) return;
    const start = Date.now();
    const bar = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / PAGE_MS);
      setProgress(p);
      if (p >= 1 && at < pages - 1) setAt((n) => n + 1);
      if (p >= 1) clearInterval(bar);
    }, 80);
    const cards = setInterval(() => setFrame((n) => n + 1), FRAME_MS);
    return () => { clearInterval(bar); clearInterval(cards); };
  }, [at, pages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted || pages === 0) return null;
  const entry = headlines[at];
  const copy = entry?.[lang];
  const frames = entry?.cards ?? [];
  const shown = frames.length ? frames[frame % frames.length] : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      className="fixed inset-0 z-[460] flex flex-col bg-[#0b0d1d] px-[18px] pb-[calc(22px+env(safe-area-inset-bottom))] text-white"
      style={{ paddingTop: `calc(env(safe-area-inset-top) + ${10 + offsetTop}px)` }}
    >
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: pages }, (_, i) => (
          <i key={i} className="h-[3px] flex-1 overflow-hidden rounded-sm bg-white/25">
            <b className="block h-full bg-white" style={{ width: `${i < at ? 100 : i === at ? progress * 100 : 0}%` }} />
          </i>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[12.5px] font-bold text-white/80">
        <span>{t('title')} · <bdi dir="ltr">{version}</bdi></span>
        <button type="button" onClick={onClose} aria-label={t('tourClose')} className="-me-2 flex h-10 w-10 items-center justify-center text-white active:opacity-60">
          <X className="h-5 w-5" />
        </button>
      </div>

      {entry && copy ? (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-3">
            {/* The two halves of the stage turn the page, as a story does: the start
                edge back, the end edge on. */}
            <button type="button" aria-label={t('tourBack')} onClick={prev} className="absolute inset-y-0 start-0 w-1/3" />
            <button type="button" aria-label={t('tourNext')} onClick={next} className="absolute inset-y-0 end-0 w-1/3" />
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
          {copy.kicker && <p className="text-xs font-extrabold tracking-wide text-[#FF8A5C]">{copy.kicker}</p>}
          <h2 className="mt-1 text-[26px] font-black leading-tight">{copy.title}</h2>
          <p className="mt-2 text-[14.5px] leading-normal text-white/75">{copy.body}</p>
          {copy.where && <p className="mt-2 text-xs text-white/55">{copy.where}</p>}
          <div className="mt-4 flex gap-2">
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
          <p className="mt-4 text-xs font-extrabold tracking-wide text-[#FF8A5C]">{t('tourRestKicker')}</p>
          <h2 className="mt-1 text-[26px] font-black leading-tight">{t('more', { count: rows.length + more.length })}</h2>
          <ul className="-mx-1 mt-3 min-h-0 flex-1 divide-y divide-white/10 overflow-y-auto px-1">
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
          <div className="mt-4 flex gap-2">
            {headlines.length > 0 && (
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
