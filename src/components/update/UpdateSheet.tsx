'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UpdateContent } from '@/lib/update-flow';

// "New version" — the mandatory update sheet (option A, picked 2026-09-30).
//
// Looks like the What's new sheet on purpose: the same card, the same rows, the
// starred notes on top and the rest behind one line. What it does NOT share is
// the drawer. Every other sheet is the vaul drawer, and vaul dismisses on a
// swipe, on Escape, on the backdrop and — through useBackDismiss — on the back
// gesture. This one has no way out except the button, so it is its own fixed
// layer with none of those: no handle, no ✕, a backdrop that does nothing, no
// "Later".
//
// The rows are not links, unlike the digest's. The sheet does not close, so a
// row that navigated would only change the page under it.
export function UpdateSheet({
  content, busy, onUpdate,
}: { content: UpdateContent; busy: boolean; onUpdate: () => void }) {
  const t = useTranslations('update');
  const { version, starred, rest } = content;
  // A release of fixes only has no big rows; its list is the whole content.
  const [open, setOpen] = useState(starred.length === 0);
  const button = useRef<HTMLButtonElement>(null);

  // Take focus off whatever field was under it, and put it somewhere a keyboard
  // or VoiceOver can act on.
  useEffect(() => { button.current?.focus({ preventScroll: true }); }, []);

  return (
    <>
      <div className="fixed inset-0 z-[400] touch-none bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mc-update-title"
        className="fixed inset-x-0 bottom-0 z-[405] flex max-h-[92dvh] flex-col rounded-t-card border-t border-page bg-card pb-[env(safe-area-inset-bottom)] mc-update-sheet"
      >
        <div className="px-4 pb-1 pt-5 text-center">
          <h2 id="mc-update-title" className="inline-flex items-center gap-1.5 text-lg font-bold text-ink-900">
            <Sparkles className="h-5 w-5 text-brand-600" />
            {t('title')}
          </h2>
          {version && (
            <div>
              <bdi dir="ltr" className="mt-1.5 inline-block rounded-pill bg-brand-600/10 px-2.5 py-0.5 text-2xs font-bold tabular-nums text-brand-600">
                {version}
              </bdi>
            </div>
          )}
          <p className="mt-2 text-xs text-ink-500">{t('lead')}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2">
          <div className="divide-y divide-page">
            {starred.map((n) => (
              <div key={n.id} className="flex items-center gap-3 py-3">
                <span className="flex h-[48px] w-[64px] shrink-0 items-center justify-center rounded-xl bg-brand-600/10 text-2xl">
                  {n.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-ink-900">{n.title}</span>
                    <span className="rounded-pill bg-brand-600/10 px-1.5 py-0.5 text-3xs font-bold text-brand-600">
                      {t('badge')}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-ink-500">{n.body}</span>
                </span>
              </div>
            ))}
            {rest.length > 0 && (
              <div>
                {starred.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 py-3 text-start text-sm font-bold text-brand-600"
                  >
                    {t('more', { count: rest.length })}
                    <ChevronDown className={cn('ms-auto h-4 w-4 transition-transform', open && 'rotate-180')} />
                  </button>
                )}
                {open && (
                  <ul className="pb-1">
                    {rest.map((n) => (
                      <li key={n.id} className="flex items-start gap-2.5 py-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-page text-sm">{n.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-bold text-ink-900">{n.title}</span>
                          <span className="block text-xs leading-snug text-ink-500">{n.body}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-page px-4 pb-4 pt-3">
          <button
            ref={button}
            type="button"
            onClick={onUpdate}
            disabled={busy}
            className="w-full rounded-card bg-brand-600 py-3.5 text-sm font-bold text-white active:opacity-80 disabled:opacity-70"
          >
            {t('cta')}
          </button>
          <p className="mt-2 text-center text-2xs text-ink-400">{t('mandatory')}</p>
        </div>
      </div>
    </>
  );
}
