'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';

/**
 * "סקר פתוח מחכה לך" on the runner's home (mockup ~/.cache/madregot/polls-proposal.html,
 * 10-20): one line per open poll this runner hasn't answered, gone the moment they do.
 * /api/surveys/open answers only for the signed-in caller.
 */
export function OpenPolls() {
  const t = useTranslations('dashboard');
  const { data } = useApi<{ polls: Array<{ id: string; question: string; closesAt: string | null }> }>('/api/surveys/open');
  const polls = data?.polls ?? [];
  if (!polls.length) return null;
  const closes = (iso: string | null) => {
    if (!iso) return null;
    const h = (Date.parse(iso) - Date.now()) / 3_600_000;
    return h < 24 ? t('pollClosesHours', { n: Math.max(1, Math.round(h)) }) : t('pollClosesDays', { n: Math.floor(h / 24) });
  };
  return (
    <div className="space-y-2">
      {polls.map((p) => (
        <Link key={p.id} href={`/dashboard/surveys/${p.id}`}
          className="flex min-h-[60px] items-center gap-3 rounded-[22px] bg-card px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-[#EEF0FF] text-[19px]">📊</span>
          <span className="min-w-0 flex-1">
            <b className="block text-[15px] font-extrabold text-ink-900">{t('pollWaiting')}</b>
            <small dir="auto" className="block truncate text-13 text-ink-500">{p.question}{closes(p.closesAt) ? ` · ${closes(p.closesAt)}` : ''}</small>
          </span>
          <ChevronLeft className="h-5 w-5 shrink-0 text-ink-300 ltr:rotate-180" />
        </Link>
      ))}
    </div>
  );
}
