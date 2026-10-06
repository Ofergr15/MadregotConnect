'use client';

import Link from 'next/link';
import { ChevronLeft, GraduationCap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AcademySummary } from '@/app/api/academy/summary/route';

/**
 * The academy on the control room: four numbers and a way in. Everything else —
 * who coaches whom, the registration switch, the week — lives on the academy's
 * own overview, which the whole card opens. The numbers come from
 * /api/academy/summary (manager only), so the card is simply absent for anyone the
 * academy isn't theirs to run.
 */
export function AcademyCard() {
  const t = useTranslations('controlRoom');
  const { data, error } = useApi<AcademySummary>('/api/academy/summary');
  if (error) return null;

  const cells: Array<{ label: string; value: number | undefined; warn?: boolean }> = [
    { label: t('academyTrainees'), value: data?.trainees },
    { label: t('academyCoaches'), value: data?.coaches },
    { label: t('academyUnpaired'), value: data?.unpaired, warn: !!data?.unpaired },
    { label: t('academyInFunnel'), value: data?.inFunnel },
  ];

  return (
    <section>
      <p className="px-4 mb-1.5 text-2xs font-bold uppercase tracking-wider text-ink-400">{t('academy')}</p>
      <Link href="/dashboard/academy" className="block overflow-hidden rounded-card bg-card active:bg-page/60" aria-busy={!data}>
        <div className="grid grid-cols-4 divide-x divide-x-reverse divide-page">
          {cells.map((c) => (
            <div key={c.label} className="px-1 py-3 text-center">
              <span
                className={cn(
                  'block text-[22px] font-black leading-none tabular-nums',
                  data ? (c.warn ? 'text-band-3-ink' : 'text-ink-700') : 'text-ink-300',
                )}
              >
                <bdi dir="ltr">{data ? c.value : '–'}</bdi>
              </span>
              <span className="mt-1 block text-2xs font-medium text-ink-400">{c.label}</span>
            </div>
          ))}
        </div>
        <div className="flex min-h-[48px] items-center gap-3 border-t border-page px-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-600">
            <GraduationCap className="h-4 w-4 text-white" />
          </span>
          <span className="flex-1 text-[15px] font-semibold text-brand-600">{t('academyOpen')}</span>
          {data && (
            <span
              className={cn(
                'rounded-pill px-2.5 py-0.5 text-2xs font-bold',
                data.registrationOpen ? 'bg-accent-600/10 text-accent-900' : 'bg-page text-ink-500',
              )}
            >
              {data.registrationOpen ? t('academyRegistrationOpen') : t('academyRegistrationClosed')}
            </span>
          )}
          <ChevronLeft className="h-4 w-4 text-ink-300" />
        </div>
      </Link>
    </section>
  );
}
