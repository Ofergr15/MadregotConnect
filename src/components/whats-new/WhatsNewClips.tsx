'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WhatsNewEntry } from '@/lib/whats-new/entries';
import { DemoPhone } from './DemoPhone';

/**
 * "What's new" after an update, when the news comes with demos (mockup
 * ~/.cache/madregot/whats-new-v6.html, Ofer 2026-10-19 — after looking at how Linear,
 * Spotify, Venmo and Apple do it): one page per change, its recorded clip in a phone
 * frame, a title and a sentence, swiped through or skipped. Whatever came without a
 * clip is one list on the last page. Opened by WhatsNewAutoSheet under the same
 * once-per-device ledger as the sheet; it marks nothing itself.
 */
export function WhatsNewClips({ entries, rest, onClose }: {
  /** The entries with `media`, in order. */
  entries: WhatsNewEntry[];
  /** The rest of the same news, listed on the last page. */
  rest: WhatsNewEntry[];
  onClose: () => void;
}) {
  const t = useTranslations('whatsNew');
  const lang = useLocale().startsWith('en') ? 'en' : 'he';
  const [i, setI] = useState(0);
  const [mounted, setMounted] = useState(false);
  const start = useRef<number | null>(null);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const last = i === entries.length - 1;
  const go = (d: number) => setI((v) => Math.min(entries.length - 1, Math.max(0, v + d)));
  const e = entries[i];
  if (!mounted || !e) return null;
  const copy = e[lang];
  const Chevron = lang === 'he' ? ChevronLeft : ChevronRight;

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex flex-col bg-[#A9ADB9]/90" role="dialog" aria-label={t('title')}>
      <div
        className="mt-[max(env(safe-area-inset-top),40px)] flex flex-1 flex-col rounded-t-[30px] bg-card px-2.5 pb-[max(env(safe-area-inset-bottom),24px)] pt-2"
        onPointerDown={(ev) => { start.current = ev.clientX; }}
        onPointerUp={(ev) => {
          if (start.current == null) return;
          const dx = ev.clientX - start.current; start.current = null;
          // RTL: the next page comes in from the left, so a swipe to the right moves on.
          if (Math.abs(dx) > 50) go((lang === 'he' ? dx > 0 : dx < 0) ? 1 : -1);
        }}
      >
        <div className="relative">
          <i className="mx-auto block h-[5px] w-[38px] rounded-full bg-ink-300/50" />
          <button type="button" onClick={onClose} className="absolute -top-0.5 start-3 min-h-[36px] text-sm font-semibold text-ink-500">{t('clipsSkip')}</button>
        </div>
        <div className="mt-4 overflow-hidden rounded-[24px]">
          {entries.map((x, k) => (
            <div key={x.slug} className={k === i ? 'block' : 'hidden'}>
              {x.media && <DemoPhone src={x.media.src} poster={x.media.poster} tint={k} height={340} phoneWidth={200} playing={k === i} />}
            </div>
          ))}
        </div>
        <div className="mt-3.5 flex justify-center gap-1.5" aria-hidden>
          {entries.map((x, k) => (
            <i key={x.slug} className={cn('block h-[7px] rounded-full transition-all', k === i ? 'w-5 bg-brand-600' : 'w-[7px] bg-ink-300/50')} />
          ))}
        </div>
        <span className="mt-3 block text-center text-[12.5px] font-extrabold text-brand-600">{t('clipsKicker')}</span>
        <h2 className="mt-0.5 text-center text-[24px] font-extrabold tracking-tight text-ink-900">{copy.title}</h2>
        <p className="mt-1.5 line-clamp-2 px-5 text-center text-[15px] leading-relaxed text-ink-500">{copy.body}</p>
        {last && rest.length > 0 && (
          <div className="mx-4 mt-3 rounded-2xl bg-page/70 px-3.5 py-2.5">
            <span className="text-xs font-extrabold text-ink-500">{t('clipsMore', { n: rest.length })}</span>
            <ul className="mt-1 space-y-0.5">
              {rest.slice(0, 4).map((r) => <li key={r.slug} className="truncate text-[13px] text-ink-700">{r[lang].title}</li>)}
            </ul>
          </div>
        )}
        <div className="mt-auto flex flex-col items-center gap-3 px-3.5 pt-4">
          {last ? (
            <button type="button" onClick={onClose} className="flex h-[52px] w-full items-center justify-center rounded-2xl bg-ink-900 text-base font-bold text-white">{t('clipsDone')}</button>
          ) : (
            <button type="button" onClick={() => go(1)} className="flex h-[52px] w-full items-center justify-center rounded-2xl bg-ink-900 text-base font-bold text-white">{t('clipsNext')}</button>
          )}
          <Link href={e.href} onClick={onClose} className="flex min-h-[36px] items-center gap-0.5 text-[14.5px] font-semibold text-brand-600">
            {t('clipsTry')}<Chevron className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
