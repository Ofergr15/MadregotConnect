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

interface Answer {
  survey: { options_he: string[]; closes_at: string | null; multi_answer?: boolean };
  myResponse: number | null;
  /** All of mine — several on a survey with more than one answer (migration 161). */
  myResponses?: number[];
  results: Array<{ optionIndex: number; people: Array<{ id: string; name?: string }> }> | null;
}

/** The publish screen's preview (mockup publish-preview-v2): the card as it will look, before it exists. */
export interface SurveyDraft { options: string[]; closesAt: string | null; multi: boolean }

function closesIn(iso: string | null, t: ReturnType<typeof useTranslations>): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return t('surveyClosed');
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return t('surveyClosesDays', { n: days });
  return t('surveyClosesHours', { n: Math.max(1, Math.round(ms / 3600000)) });
}

export function SurveyVote({ surveyId, myAthleteId, draft }: { surveyId: string | null; myAthleteId: string | null; draft?: SurveyDraft }) {
  const t = useTranslations('publish');
  const me = myAthleteId || (typeof window !== 'undefined' ? localStorage.getItem('athlete_id') : null);
  const { data: live, mutate } = useApi<Answer>(draft || !surveyId ? null : me ? `/api/surveys/${surveyId}?athleteId=${me}` : `/api/surveys/${surveyId}`);
  const [busy, setBusy] = useState(false);
  const data: Answer | undefined = draft
    ? { survey: { options_he: draft.options, closes_at: draft.closesAt, multi_answer: draft.multi }, myResponse: null, myResponses: [], results: null }
    : live;
  if (!data?.survey) return null;
  const multi = data.survey.multi_answer === true;
  const closed = !!data.survey.closes_at && Date.parse(data.survey.closes_at) < Date.now();
  const counts = data.survey.options_he.map((_, i) => data.results?.find((r) => r.optionIndex === i)?.people.length ?? 0);
  // The share is of the people who answered: with several answers each, the bars add up past 100%.
  const voters = new Set((data.results || []).flatMap((r) => r.people.map((p) => p.id))).size;
  const total = multi ? voters : counts.reduce((a, b) => a + b, 0);
  const mineAll = data.myResponses ?? (data.myResponse !== null ? [data.myResponse] : []);
  const voted = mineAll.length > 0;
  const showResults = voted || closed;
  // "בחרו כמוך" (mockup polls-proposal, 10-20): who else picked my answer — named only when
  // the poll shows names (an anonymous poll's people come back without them).
  const alike = voted && !multi
    ? (data.results?.find((r) => r.optionIndex === mineAll[0])?.people ?? []).filter((p) => p.id !== me && p.name).map((p) => p.name!.split(' ')[0])
    : [];

  const vote = async (i: number) => {
    if (draft || !surveyId || !me || busy || closed) return;
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
        const mine = mineAll.includes(i);
        return (
          <button key={i} type="button" disabled={closed || busy} onClick={() => vote(i)} aria-pressed={mine}
            className={cn('relative flex min-h-[48px] w-full items-center gap-2.5 overflow-hidden rounded-[14px] px-3.5 text-start text-[15px] font-bold', showResults ? 'bg-page' : 'border-[1.5px] border-brand-600/30 bg-card text-brand-600')}>
            {showResults && <span aria-hidden className={cn('absolute inset-y-0 start-0', mine ? 'bg-brand-600/15' : 'bg-ink-900/[0.06]')} style={{ width: `${Math.min(100, pct)}%` }} />}
            {/* More than one answer: squares, like a checklist; one answer: no mark until voted. */}
            {multi && (
              <span aria-hidden className={cn('relative grid h-[20px] w-[20px] shrink-0 place-items-center rounded-[6px] border-2 text-[12px] font-black', mine ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 bg-card')}>{mine ? '✓' : ''}</span>
            )}
            <span dir="auto" className="relative min-w-0 flex-1 truncate text-ink-900">{o}{mine && !multi && <span className="text-brand-600"> ✓</span>}</span>
            {showResults && <span className={cn('relative shrink-0 text-sm', mine ? 'text-brand-600' : 'text-ink-500')}><bdi dir="ltr">{pct}%</bdi></span>}
          </button>
        );
      })}
      {alike.length > 0 && (
        <p className="px-1 text-xs font-semibold text-brand-600" dir="rtl">{t('choseLikeYou', { names: alike.slice(0, 3).join(', ') })}{alike.length > 3 ? <> <bdi dir="ltr">+{alike.length - 3}</bdi></> : null}</p>
      )}
      <div className="flex items-center justify-between px-1 text-xs font-semibold text-ink-400">
        <span>{draft ? (multi ? 'אפשר לבחור כמה תשובות' : 'תשובה אחת') : t('surveyAnswered', { n: total })}{!draft && multi ? ' · אפשר לבחור כמה' : ''}{closesIn(data.survey.closes_at, t) ? <> · {closesIn(data.survey.closes_at, t)}</> : null}</span>
        {!draft && surveyId && <Link href={`/dashboard/surveys/${surveyId}`} className="inline-flex min-h-[36px] items-center font-bold text-brand-600">{t('whoAnswered')} ‹</Link>}
      </div>
    </div>
  );
}
