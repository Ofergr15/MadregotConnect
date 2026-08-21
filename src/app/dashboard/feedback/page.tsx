'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, CheckCircle2, Gauge, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { requestPushOptInPrompt } from '@/components/PushOptIn';

const FEEL_FACES = ['😣', '😕', '😐', '🙂', '😄'];

function FeedbackForm() {
  const t = useTranslations('workoutFeedback');
  const params = useSearchParams();
  const router = useRouter();
  const activityId = params.get('activity') || '';

  const [athleteId, setAthleteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [activityName, setActivityName] = useState('');
  const [watchRpe, setWatchRpe] = useState<number | null>(null);
  const [watchFeel, setWatchFeel] = useState<number | null>(null);

  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [feel, setFeel] = useState<number | null>(null);
  const [pain, setPain] = useState<boolean | null>(null);
  const [painDetail, setPainDetail] = useState('');
  const [wantsFeedback, setWantsFeedback] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [coachReply, setCoachReply] = useState<string | null>(null);
  const [replyIsNew, setReplyIsNew] = useState(false);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  useEffect(() => {
    const id = localStorage.getItem('athlete_id') || '';
    setAthleteId(id);
    if (!id || !activityId) { setLoading(false); return; }
    fetch(`/api/workout-feedback?athleteId=${id}&activityId=${activityId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        if (data.activity) {
          const km = data.activity.distance ? (data.activity.distance / 1000).toFixed(1) : '';
          setActivityName([data.activity.activity_name, km && `${km} ק"מ`].filter(Boolean).join(' · '));
        }
        setWatchRpe(data.watchRpe);
        setWatchFeel(data.watchFeel);
        // Pre-fill from the watch Self-Evaluation when present.
        if (data.existing) {
          setDifficulty(data.existing.difficulty ?? null);
          setFeel(data.existing.feel ?? null);
          setPain(data.existing.pain ?? null);
          setPainDetail(data.existing.pain_detail || '');
          setWantsFeedback(data.existing.wants_feedback ?? null);
          setComment(data.existing.comment || '');
          setCoachReply(data.existing.coach_reply || null);
          // A reply the athlete hasn't opened yet → mark it seen (clears the badge).
          if (data.existing.coach_reply && !data.existing.reply_seen_at && data.existing.id) {
            setReplyIsNew(true);
            fetch('/api/workout-feedback/reply', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ feedbackId: data.existing.id, athleteId: id }),
            }).catch(() => {});
          }
        } else {
          if (data.watchRpe != null) setDifficulty(Math.round(data.watchRpe));
          if (data.watchFeel != null) setFeel(Math.round(data.watchFeel));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activityId]);

  const submit = async () => {
    if (!athleteId) return;
    // Optimistic: show the "thanks" screen immediately and head back; the save
    // runs in the background. If it fails, drop back to the form with an error
    // so nothing is silently lost.
    setDone(true);
    const t = setTimeout(() => router.push('/dashboard'), 1500);
    try {
      const res = await fetch('/api/workout-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId, activityId, difficulty, feel, pain, painDetail, wantsFeedback, comment }),
      });
      if (!res.ok) throw new Error('save failed');
      // Right now is the moment push notifications become concretely useful —
      // a coach reply could land any time after this. Ask for the permission
      // here (if not already granted/denied/dismissed) instead of on every
      // dashboard visit.
      requestPushOptInPrompt();
    } catch {
      clearTimeout(t);
      setDone(false);
      setSubmitError(true);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 text-primary-600 animate-spin" /></div>;
  }
  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <CheckCircle2 className="h-12 w-12 text-green-400" />
        <p className="text-white font-bold" dir="rtl">{t('thanks')}</p>
      </div>
    );
  }

  // Adaptive: if the watch said high effort, ask about recovery; if it said the
  // run felt poor, foreground the pain question.
  const highEffort = (watchRpe != null && watchRpe >= 8) || (difficulty != null && difficulty >= 8);
  const feltPoor = (watchFeel != null && watchFeel <= 1) || (feel != null && feel <= 1);

  const scale = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  return (
    <div className="max-w-md mx-auto px-4 py-6" dir="rtl">
      <h1 className="text-xl font-black text-white">{t('title')} 🏃</h1>
      {activityName && <p className="text-sm text-slate-400 mt-1">{activityName}</p>}

      {/* Coach reply — surfaced whenever a coach has responded to this workout. */}
      {coachReply && (
        <div className="mt-4 rounded-xl bg-primary-600/12 border border-primary-600/30 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <MessageCircle className="h-4 w-4 text-primary-300" />
            <span className="text-xs font-bold text-primary-300">{t('coachReply')}</span>
            {replyIsNew && (
              <span className="text-3xs font-black uppercase tracking-wide text-white bg-primary-600 rounded-full px-2 py-0.5 ms-auto">{t('new')}</span>
            )}
          </div>
          <p className="text-sm text-indigo-100" dir="auto">{coachReply}</p>
        </div>
      )}

      {(watchRpe != null || watchFeel != null) && (
        <div className="flex items-start gap-2 mt-4 rounded-xl bg-primary-600/12 border border-primary-600/30 p-3">
          <Gauge className="h-4 w-4 text-primary-600 mt-0.5 shrink-0" />
          <p className="text-xs text-indigo-200">
            {t('fromWatch')}: {watchRpe != null && `${t('effort')} ${Math.round(watchRpe)}/10`}
            {watchRpe != null && watchFeel != null && ' · '}
            {watchFeel != null && `${t('feel')} ${FEEL_FACES[Math.round(watchFeel)]}`}
            {highEffort && ` — ${t('adaptRecovery')}`}
          </p>
        </div>
      )}

      {/* Difficulty 1-10 */}
      <p className="text-sm font-semibold text-slate-200 mt-5 mb-2">{t('difficulty')}</p>
      <div className="grid grid-cols-5 gap-2">
        {scale.map(n => (
          <button key={n} onClick={() => setDifficulty(n)}
            className={cn('aspect-square rounded-lg text-sm font-bold transition',
              difficulty === n ? 'bg-primary-600 text-white' : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700')}>
            {n}
          </button>
        ))}
      </div>

      {/* Feel 0-4 */}
      <p className="text-sm font-semibold text-slate-200 mt-5 mb-2">{t('howFeel')}</p>
      <div className="flex justify-between">
        {FEEL_FACES.map((f, i) => (
          <button key={i} onClick={() => setFeel(i)}
            className={cn('text-3xl transition', feel === i ? 'opacity-100 scale-110' : 'opacity-40')}>
            {f}
          </button>
        ))}
      </div>

      {/* Pain */}
      <p className="text-sm font-semibold text-slate-200 mt-5 mb-2">{highEffort ? t('painAfterHard') : t('pain')}</p>
      <div className="flex gap-2">
        <button onClick={() => setPain(true)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm transition',
            pain === true ? 'bg-red-600/80 text-white' : 'bg-slate-700/50 text-slate-300')}>{t('yes')}</button>
        <button onClick={() => setPain(false)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm transition',
            pain === false ? 'bg-primary-600 text-white' : 'bg-slate-700/50 text-slate-300')}>{t('no')}</button>
      </div>
      {pain === true && (
        <input value={painDetail} onChange={e => setPainDetail(e.target.value)} placeholder={t('painDetail')}
          className="w-full mt-2 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-600" />
      )}

      {/* Want feedback */}
      <p className="text-sm font-semibold text-slate-200 mt-5 mb-2">{feltPoor ? t('wantHelp') : t('wantFeedback')}</p>
      <div className="flex gap-2">
        <button onClick={() => setWantsFeedback(true)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm transition',
            wantsFeedback === true ? 'bg-primary-600 text-white' : 'bg-slate-700/50 text-slate-300')}>{t('yes')}</button>
        <button onClick={() => setWantsFeedback(false)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm transition',
            wantsFeedback === false ? 'bg-slate-600 text-white' : 'bg-slate-700/50 text-slate-300')}>{t('no')}</button>
      </div>

      {/* Free-text comment */}
      <p className="text-sm font-semibold text-slate-200 mt-5 mb-2">{t('comment')}</p>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
        placeholder={t('commentPlaceholder')}
        className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-600" />

      {submitError && <p className="mt-4 text-sm text-red-400 text-center" dir="rtl">{t('submitError')}</p>}

      <button onClick={submit}
        className="w-full mt-6 min-h-[52px] rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-bold flex items-center justify-center gap-2">
        {t('submit')}
      </button>
    </div>
  );
}

export default function WorkoutFeedbackPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 text-primary-600 animate-spin" /></div>}>
      <FeedbackForm />
    </Suspense>
  );
}
