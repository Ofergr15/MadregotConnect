'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { CheckCircle2, HelpCircle, Loader2 } from 'lucide-react';
import { Card, EmptyState, LoadingBlock } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Survey {
  id: string;
  question_he: string;
  question_en: string | null;
  options_he: string[];
  options_en: string[] | null;
  closes_at: string | null;
}

export default function SurveyPage() {
  const t = useTranslations('surveys');
  const locale = useLocale();
  const params = useParams();
  const surveyId = params.id as string;

  const [athleteId, setAthleteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [myResponse, setMyResponse] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const id = localStorage.getItem('athlete_id') || '';
    setAthleteId(id);
    fetch(`/api/surveys/${surveyId}${id ? `?athleteId=${id}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setSurvey(d.survey); setMyResponse(d.myResponse); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [surveyId]);

  const answer = async (optionIndex: number) => {
    if (!athleteId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/surveys/${surveyId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId, optionIndex }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('submitError'));
      setMyResponse(optionIndex);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  const closed = !!(survey?.closes_at && new Date(survey.closes_at) < new Date());
  const question = locale === 'en' && survey?.question_en ? survey.question_en : survey?.question_he;
  const options = locale === 'en' && survey?.options_en?.length ? survey.options_en : survey?.options_he;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <LoadingBlock />
      </div>
    );
  }

  if (notFound || !survey) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <EmptyState icon={HelpCircle} title={t('notFound')} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <Card className="max-w-md w-full">
        <p className="text-xs font-bold text-primary-400 uppercase tracking-wider mb-2">{t('title')}</p>
        <h1 className="text-lg font-bold text-white mb-5" dir="auto">{question}</h1>

        {closed ? (
          <EmptyState icon={HelpCircle} title={t('closed')} />
        ) : (
          <div className="space-y-2">
            {(options || []).map((opt, i) => {
              const mine = myResponse === i;
              return (
                <button
                  key={i}
                  onClick={() => answer(i)}
                  disabled={submitting}
                  dir="auto"
                  className={cn(
                    'w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-start min-h-[48px] transition-colors disabled:opacity-60',
                    mine
                      ? 'bg-primary-600/15 border-primary-500 text-white font-semibold'
                      : 'bg-slate-800/60 border-slate-700 text-slate-200 hover:border-slate-600',
                  )}
                >
                  <span>{opt}</span>
                  {mine && <CheckCircle2 className="h-5 w-5 text-primary-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {submitting && (
          <div className="flex items-center justify-center gap-2 mt-4 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('submitting')}
          </div>
        )}
        {error && <p className="text-sm text-red-400 mt-4 text-center">{error}</p>}
        {myResponse !== null && !submitting && !closed && (
          <p className="text-xs text-slate-500 mt-4 text-center">{t('changeAnswerHint')}</p>
        )}
      </Card>
    </div>
  );
}
