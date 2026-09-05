'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, CheckCircle2, Gauge, MessageCircle, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { requestPushOptInPrompt } from '@/components/PushOptIn';
import { FeedbackThread } from '@/components/FeedbackThread';
import { apiHeaders } from '@/lib/api';

const FEEL_FACES = ['😣', '😕', '😐', '🙂', '😄'];
// Severity color per difficulty band (1-10) — inline hex, not Tailwind classes:
// the color depends on runtime data, and Tailwind's compiler only includes
// classes it can see literally in source (same reason WORKOUT_TYPE_COLORS
// elsewhere in this app uses inline style, not bg-${x} strings).
// The light system's severity trio (accent-600 / band-3 / accent-red) plus the
// brand blue for "as expected" — the old emerald/amber/red were tuned for a dark
// card and read as washed-out pastels once these numbers sat on white.
const DIFFICULTY_COLOR = (n: number): string => (n <= 3 ? '#16a34a' : n <= 6 ? '#1525FF' : n <= 8 ? '#FF5315' : '#AD3838');
// The label that stays readable ON a given DIFFICULTY_COLOR fill. The trio spans
// from a dark brand blue to a bright orange, so no single label colour clears AA
// across all four: white measures 3.30:1 on the green and 3.23:1 on the orange,
// while ink-900 measures 2.16:1 on the blue. Picking by the fill's own luminance
// gives 5.03 / 7.66 / 5.13 / 6.18, and keeps holding if the palette is retuned.
const ON_FILL = (fill: string): string => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return lum > 0.16 ? '#1D1E26' : '#FFFFFF';
};
// One color per FEEL_FACES index (😣 worst → 😄 best) — same palette, inverted.
const FEEL_COLOR = ['#AD3838', '#FF5315', '#5F5F5F', '#1525FF', '#16a34a'];

// A small "still needs your input" marker — every question the watch can't
// answer (pain, coach-feedback) plus difficulty/feel when there was no watch
// data to pre-fill them at all. Disappears the moment that question is
// answered, so progress through the form is visible at a glance instead of
// every Yes/No pair looking equally unanswered.
function RequiredTag({ show }: { show: boolean }) {
  const t = useTranslations('workoutFeedback');
  if (!show) return null;
  return (
    <span className="text-[10px] font-bold text-band-3-ink bg-band-3/15 px-1.5 py-0.5 rounded-full">
      {t('required')}
    </span>
  );
}

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
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [athleteEmail, setAthleteEmail] = useState('');
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  useEffect(() => {
    const id = localStorage.getItem('athlete_id') || '';
    setAthleteId(id);
    setAthleteEmail(localStorage.getItem('athlete_email') || '');
    if (!id || !activityId) { setLoading(false); return; }
    apiHeaders()
      .then(headers => fetch(`/api/workout-feedback?athleteId=${id}&activityId=${activityId}`, { headers }))
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
          setFeedbackId(data.existing.id || null);
        } else {
          // Clamp into the app's 1-10 difficulty scale — Garmin's raw
          // self-eval RPE can be 0 ("nothing at all"), which none of the
          // form's 10 buttons (1-10) match, so an unclamped 0 looked
          // completely unanswered even though a real watch value was
          // captured, and a difficulty:0 submit would violate the 1-10
          // invariant src/lib/feedback-scales.ts already assumes everywhere else.
          if (data.watchRpe != null) setDifficulty(Math.min(Math.max(Math.round(data.watchRpe), 1), 10));
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
        headers: await apiHeaders(true),
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
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 text-brand-600 animate-spin" /></div>;
  }
  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <CheckCircle2 className="h-12 w-12 text-accent-600" />
        <p className="text-ink-700 font-bold" dir="rtl">{t('thanks')}</p>
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
      <h1 className="text-xl font-black text-ink-700">{t('title')} 🏃</h1>
      {activityName && <p className="text-sm text-ink-400 mt-1">{activityName}</p>}

      {/* Thread with the coach — reachable as soon as a feedback row exists
          (the athlete can start it too, not just receive a reply). */}
      {feedbackId && (
        <div className="mt-4 rounded-xl bg-brand-600/12 border border-brand-600/30 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <MessageCircle className="h-4 w-4 text-brand-600" />
            <span className="text-xs font-bold text-brand-600">{t('coachReply')}</span>
          </div>
          <FeedbackThread feedbackId={feedbackId} viewerEmail={athleteEmail} />
        </div>
      )}

      {(watchRpe != null || watchFeel != null) && (
        <div
          className="flex items-start gap-2 mt-4 rounded-xl border p-3"
          style={{
            borderColor: `${watchRpe != null ? DIFFICULTY_COLOR(Math.round(watchRpe)) : '#1525FF'}55`,
            background: `${watchRpe != null ? DIFFICULTY_COLOR(Math.round(watchRpe)) : '#1525FF'}18`,
          }}
        >
          <Gauge className="h-4 w-4 mt-0.5 shrink-0" style={{ color: watchRpe != null ? DIFFICULTY_COLOR(Math.round(watchRpe)) : '#159AFF' }} />
          <div className="text-xs">
            {/* Was text-indigo-100 — a near-white, which sat on a 10% tint of the
                effort colour over a white card, i.e. white on white. */}
            <p className="text-ink-700">
              {t('fromWatch')}: {watchRpe != null && `${t('effort')} ${Math.round(watchRpe)}/10`}
              {watchRpe != null && watchFeel != null && ' · '}
              {watchFeel != null && `${t('feel')} ${FEEL_FACES[Math.round(watchFeel)]}`}
              {highEffort && ` — ${t('adaptRecovery')}`}
            </p>
            {/* Makes explicit that this pre-fill isn't final — the numbers/face
                below are real inputs, not a locked read-only summary. */}
            <p className="flex items-center gap-1 text-ink-400 mt-1">
              <Pencil className="h-3 w-3" /> {t('watchEditableHint')}
            </p>
          </div>
        </div>
      )}

      {/* Difficulty 1-10 — color intensity mirrors severity (green→blue→amber→red), same palette as the watch banner above, so the selected value's color IS the answer, not just a highlight. */}
      <div className="flex items-center gap-1.5 mt-5 mb-2">
        <p className="text-sm font-semibold text-ink-700">{t('difficulty')}</p>
        <RequiredTag show={difficulty == null} />
      </div>
      <div className="grid grid-cols-5 gap-2">
        {scale.map(n => (
          <button key={n} onClick={() => setDifficulty(n)}
            className="aspect-square rounded-lg text-sm font-bold transition"
            // Unselected was `rgba(51,65,85,.5)` on `#cbd5e1` — slate-700 and
            // slate-300, a leftover from the dark card. Over the light page that
            // composites to #89909a carrying #cbd5e1 text: 2.17:1, on a 1-10
            // control that is the main thing this form asks for. Now the page
            // grey with body ink, which is how every other unselected pill in
            // the light system reads.
            style={difficulty === n
              ? { background: DIFFICULTY_COLOR(n), color: ON_FILL(DIFFICULTY_COLOR(n)) }
              : { background: '#DFDFDF', color: '#2D2E38' }}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Feel 0-4 — selected face gets a colored ring instead of just dimming
          the rest, so it reads as "this is the answer" at a glance. */}
      <div className="flex items-center gap-1.5 mt-5 mb-2">
        <p className="text-sm font-semibold text-ink-700">{t('howFeel')}</p>
        <RequiredTag show={feel == null} />
      </div>
      <div className="flex justify-between">
        {FEEL_FACES.map((f, i) => (
          <button
            key={i}
            onClick={() => setFeel(i)}
            className={cn('text-3xl rounded-full transition p-1.5', feel === i ? 'scale-110' : 'opacity-50')}
            style={feel === i ? { background: `${FEEL_COLOR[i]}2A`, boxShadow: `0 0 0 2px ${FEEL_COLOR[i]}` } : undefined}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Pain */}
      <div className="flex items-center gap-1.5 mt-5 mb-2">
        <p className="text-sm font-semibold text-ink-700">{highEffort ? t('painAfterHard') : t('pain')}</p>
        <RequiredTag show={pain == null} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => setPain(true)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm transition',
            pain === true ? 'bg-accent-red/80 text-white' : 'bg-page/50 text-ink-500')}>{t('yes')}</button>
        <button onClick={() => setPain(false)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm transition',
            pain === false ? 'bg-brand-600 text-white' : 'bg-page/50 text-ink-500')}>{t('no')}</button>
      </div>
      {pain === true && (
        <input value={painDetail} onChange={e => setPainDetail(e.target.value)} placeholder={t('painDetail')}
          className="w-full mt-2 bg-page/50 border border-page rounded-lg px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600" />
      )}

      {/* Want feedback */}
      <div className="flex items-center gap-1.5 mt-5 mb-2">
        <p className="text-sm font-semibold text-ink-700">{feltPoor ? t('wantHelp') : t('wantFeedback')}</p>
        <RequiredTag show={wantsFeedback == null} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => setWantsFeedback(true)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm transition',
            wantsFeedback === true ? 'bg-brand-600 text-white' : 'bg-page/50 text-ink-500')}>{t('yes')}</button>
        <button onClick={() => setWantsFeedback(false)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm transition',
            wantsFeedback === false ? 'bg-ink-300 text-ink-700' : 'bg-page/50 text-ink-500')}>{t('no')}</button>
      </div>

      {/* Free-text comment */}
      <p className="text-sm font-semibold text-ink-700 mt-5 mb-2">{t('comment')}</p>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
        placeholder={t('commentPlaceholder')}
        className="w-full bg-page/50 border border-page rounded-lg px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600" />

      {submitError && <p className="mt-4 text-sm text-accent-red text-center" dir="rtl">{t('submitError')}</p>}

      <button onClick={submit}
        className="w-full mt-6 min-h-[52px] rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold flex items-center justify-center gap-2">
        {t('submit')}
      </button>
    </div>
  );
}

export default function WorkoutFeedbackPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 text-brand-600 animate-spin" /></div>}>
      <FeedbackForm />
    </Suspense>
  );
}
