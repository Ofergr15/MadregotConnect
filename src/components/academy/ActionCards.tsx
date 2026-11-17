'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { actionCardKeys, type ActionCard, type ActionKind } from '@/lib/academy/action-cards';
import { cn } from '@/lib/utils';

const EDGE: Record<ActionCard['tone'], string> = {
  red: 'border-s-accent-red',
  orange: 'border-s-band-3',
  brand: 'border-s-brand-600',
};

/**
 * The "what to do now" cards (lib/academy/action-cards.ts): a verb title, one sentence with
 * the count inside it, one button. Each CTA is either a link (`href`) or a handler (`onAction`).
 */
export function ActionCards({ cards, href, onAction, header = true, approveNote = false }: {
  cards: ActionCard[];
  href?: (kind: ActionKind) => string | null;
  onAction?: (kind: ActionKind) => void;
  header?: boolean;
  /** Entry queue only: approving also lets the person past a maintenance window. */
  approveNote?: boolean;
}) {
  const t = useTranslations('actionCards');
  if (!cards.length) return null;
  return (
    <section className="space-y-2" dir="rtl" aria-label={t('header')}>
      {header && <h2 className="px-1 text-xs font-bold text-ink-400">{t('header')}</h2>}
      {cards.map((c) => {
        const k = actionCardKeys(c.kind);
        const to = href?.(c.kind) ?? null;
        const ctaClass = 'inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white active:opacity-80';
        const cta = (
          <>
            {t(k.cta)}
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </>
        );
        return (
          <div key={c.kind} data-action-card={c.kind} className={cn('rounded-card border-s-4 bg-card p-3.5', EDGE[c.tone])}>
            <b className="block text-[17px] font-bold leading-tight text-ink-900">{t(k.title)}</b>
            <p className="mt-1 text-sm font-light leading-snug text-ink-500">
              {t.rich(k.text, {
                count: c.count,
                extra: c.extra,
                n: (chunks) => <bdi className="font-bold text-ink-700">{chunks}</bdi>,
              })}
              {approveNote && c.kind === 'approve' && <>. {t('approveNote')}</>}
            </p>
            <div className="mt-2.5">
              {to ? (
                <Link href={to} className={ctaClass}>{cta}</Link>
              ) : (
                <button type="button" onClick={() => onAction?.(c.kind)} className={ctaClass}>{cta}</button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
