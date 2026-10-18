'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { cn } from '@/lib/utils';

// A survey on the feed (mockup publish, C4): tap an answer to vote, the results show at once
// for everyone, a ✓ on mine; closed surveys only show results. The survey and the vote are the
// existing /api/surveys/[id] routes; the card around it is the post's own (likes, comments).

interface Answer { survey: { options_he: string[]; closes_at: string | null }; myResponse: number | null; results: Array<{ optionIndex: number; people: Array<{ id: string }> }> | null }

function closesIn(iso: string | null, t: ReturnType<typeof useTranslations>): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return t('surveyClosed');
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return t('surveyClosesDays', { n: days });
  return t('surveyClosesHours', { n: Math.max(1, Math.round(ms / 3600000)) });
}

export function SurveyVote({ surveyId, myAthleteId }: { surveyId: string; myAthleteId: string | null }) {
  const t = useTranslations('publish');
  const me = myAthleteId || (typeof window !== 'undefined' ? localStorage.getItem('athlete_id') : null);
  const { data, mutate } = useApi<Answer>(me ? `/api/surveys/${surveyId}?athleteId=${me}` : `/api/surveys/${surveyId}`);
  const [busy, setBusy] = useState(false);
  if (!data?.survey) return null;
  const closed = !!data.survey.closes_at && Date.parse(data.survey.closes_at) < Date.now();
  const counts = data.survey.options_he.map((_, i) => data.results?.find((r) => r.optionIndex === i)?.people.length ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const voted = data.myResponse !== null;
  const showResults = voted || closed;

  const vote = async (i: number) => {
    if (!me || busy || closed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/surveys/${surveyId}/respond`, { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ athleteId: me, optionIndex: i }) });
      if (res.ok) await mutate();
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 space-y-2" dir="rtl">
      {data.survey.options_he.map((o, i) => {
        const pct = total ? Math.round((counts[i] / total) * 100) : 0;
        const mine = data.myResponse === i;
        return (
          <button key={i} type="button" disabled={closed || busy} onClick={() => vote(i)} aria-pressed={mine}
            className={cn('relative flex min-h-[48px] w-full items-center overflow-hidden rounded-[14px] px-3.5 text-start text-[15px] font-bold', showResults ? 'bg-page' : 'border-[1.5px] border-brand-600/30 bg-card text-brand-600')}>
            {showResults && <span aria-hidden className={cn('absolute inset-y-0 start-0', mine ? 'bg-brand-600/15' : 'bg-ink-900/[0.06]')} style={{ width: `${pct}%` }} />}
            <span dir="auto" className="relative min-w-0 flex-1 truncate text-ink-900">{o}{mine && <span className="text-brand-600"> ✓</span>}</span>
            {showResults && <span className={cn('relative shrink-0 text-sm', mine ? 'text-brand-600' : 'text-ink-500')}><bdi dir="ltr">{pct}%</bdi></span>}
          </button>
        );
      })}
      <div className="flex items-center justify-between px-1 text-xs font-semibold text-ink-400">
        <span>{t('surveyAnswered', { n: total })}{closesIn(data.survey.closes_at, t) ? <> · {closesIn(data.survey.closes_at, t)}</> : null}</span>
        <Link href={`/dashboard/surveys/${surveyId}`} className="inline-flex min-h-[36px] items-center font-bold text-brand-600">{t('whoAnswered')} ‹</Link>
      </div>
    </div>
  );
}
