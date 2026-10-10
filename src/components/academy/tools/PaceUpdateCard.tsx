'use client';

import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { israelToday } from '@/lib/utils';
import type { PaceUpdateCard as Card } from '@/lib/academy/coach-tools-payload';
import { RICH, clockText } from '../book/ui';

// ── "<coach> עדכן את הקצבים שלך" (mockup academy-coach-tools.html, phone 6) ─────────────
//
// One clear card on the trainee's academy home when their coach updates their paces: what
// changed, in words ("חזרות ב־3:58 במקום 4:05"), and why ("רצת מהר מהתוכנית ב־4 מ־5
// האחרונים"). The week under it already carries the new paces, and so does the watch.

export function PaceUpdateCard({ card }: { card: Card }) {
  const t = useTranslations('academyTools');
  const started = israelToday() >= card.fromWeek;
  const faster = card.direction === 'faster';
  const coach = card.coachName?.split(' ')[0] ?? null;
  return (
    <section
      className="flex gap-3 rounded-[20px] border-2 bg-white px-3.5 py-3"
      style={{ borderColor: faster ? '#1FA55B' : '#E8892B' }}
      aria-label={coach ? t.markup('card.title', { coach, bdi: (c) => c }) : t('card.titleNoName')}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: faster ? '#E5F6EC' : '#FDF0E2', color: faster ? '#0E7A3C' : '#8A4308' }}>
        {faster ? <ArrowUp className="h-5 w-5" strokeWidth={3} /> : <ArrowDown className="h-5 w-5" strokeWidth={3} />}
      </span>
      <div className="min-w-0 flex-1">
        <b className="block text-[16px] font-black leading-tight text-ink-900">
          {coach ? t.rich('card.title', { ...RICH, coach }) : t('card.titleNoName')}
        </b>
        <p className="mt-1 text-[14.5px] leading-snug text-ink-700">
          {card.of > 0 && <>{t.rich(faster ? 'card.whyFaster' : 'card.whySlower', { ...RICH, moved: card.moved, of: card.of })} </>}
          {started ? t('card.fromNow') : t('card.fromNext')}{' '}
          {card.kinds.map((k, i) => (
            <span key={k.kind}>
              {i > 0 && t('card.sep')}
              {t.rich('card.item', { ...RICH, kind: t(`kind.${k.kind}`), to: clockText(k.toSec), from: clockText(k.fromSec) })}
            </span>
          ))}
          .
        </p>
      </div>
    </section>
  );
}
