'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles, X } from 'lucide-react';
import { israelToday } from '@/lib/utils';

/**
 * A tip on the new thing itself, the first times someone reaches it (Apple's TipKit
 * idea — "teach in context", Ofer 2026-10-19, whats-new-v6 mockup). Shown until it is
 * closed or `until` passes; closed once, it is gone on this device.
 */
export function FeatureTip({ id, title, body, until }: { id: string; title: string; body?: string; until: string }) {
  const t = useTranslations('whatsNew');
  const key = `mc:tip:${id}`;
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(israelToday() <= until && !localStorage.getItem(key)); } catch { /* private mode: no tip */ }
  }, [key, until]);
  if (!show) return null;
  const close = () => { setShow(false); try { localStorage.setItem(key, '1'); } catch { /* */ } };
  return (
    <div role="note" className="relative mb-2.5 flex items-start gap-2.5 rounded-2xl bg-ink-900 px-3.5 py-3 text-white shadow-[0_14px_30px_-12px_rgba(0,0,0,0.45)]">
      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-brand-600"><Sparkles className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <b className="block text-[14.5px]">{title}</b>
        {body && <span className="block text-[12.5px] opacity-75">{body}</span>}
      </span>
      <button type="button" onClick={close} aria-label={t('tipClose')} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-ink-500"><X className="h-3.5 w-3.5" strokeWidth={2.6} /></button>
      <i aria-hidden className="absolute -bottom-1.5 end-20 h-3.5 w-3.5 rotate-45 rounded-[2px] bg-ink-900" />
    </div>
  );
}
