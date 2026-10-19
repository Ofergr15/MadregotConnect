'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, CheckCircle2, Gauge, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui';
import { requestPushOptInPrompt } from '@/components/PushOptIn';
import { FeedbackThread } from '@/components/FeedbackThread';
import { ExecutionQuality } from '@/components/activity/ExecutionQuality';
import { useExecutionVerdict } from '@/components/activity/execution-context';
import { apiHeaders } from '@/lib/api';
import { announceReadOnly, useViewAsReadOnly } from '@/lib/view-as-person';

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

function FeedbackForm() {
  const t = useTranslations('workoutFeedback');
  // Greyed while an admin views the app as this runner (lib/view-as-person.ts).
  const readOnly = useViewAsReadOnly();
  const params = useSearchParams();
  const router = useRouter();
  const activityId = params.get('activity') || '';

  const [athleteId, setAthleteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [activityName, setActivityName] = useState('');
  // The URL carries the GARMIN id (that's what the push was built with); the
  // grade is keyed by the internal uuid, which the GET below returns.
  const [activityUuid, setActivityUuid] = useState('');
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
  const [noteOpen, setNoteOpen] = useState(false);

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
          setActivityUuid(data.activity.id || '');
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
          // Feel the same way into 0–4 (a raw Garmin 0–100 that skipped the sync's division
          // reads /25, as feelPrefillOf does) — the route refuses anything outside it.
          if (data.watchFeel != null) {
            const f = data.watchFeel > 4 ? data.watchFeel / 25 : data.watchFeel;
            setFeel(Math.min(Math.max(Math.round(f), 0), 4));
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        // The home's "איך הרגשת?" faces open this form on the face that was tapped
        // (`&feel=0..4`, components/home/TodayHome.tsx) — the tap wins over the watch.
        const tapped = Number(params.get('feel'));
        if (params.get('feel') != null && Number.isInteger(tapped) && tapped >= 0 && tapped <= 4) setFeel(tapped);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once with the run, as activityId is
  }, [activityId]);

  // Always the athlete's own run — the form is reached from their own push and
  // the API it reads is scoped to them.
  const { verdict, loading: loadingVerdict } = useExecutionVerdict(activityUuid, {
    enabled: !!activityUuid,
  });

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
        <p className="text-xl font-black text-ink-900" dir="rtl">{t('thanks')}</p>
        <p className="text-sm text-ink-500" dir="rtl">
          {difficulty != null && <>{t('difficulty')} <bdi dir="ltr">{difficulty}</bdi></>}
          {feel != null && <> · {FEEL_FACES[feel]}</>}
          {pain === false && <> · {t('noPain')}</>}
        </p>
      </div>
    );
  }

  // Adaptive: if the watch said high effort, ask about recovery; if it said the
  // run felt poor, foreground the pain question.
  const highEffort = (watchRpe != null && watchRpe >= 8) || (difficulty != null && difficulty >= 8);
  const feltPoor = (watchFeel != null && watchFeel <= 1) || (feel != null && feel <= 1);

  const scale = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const words = t.raw('rpeWords') as string[];
  const fromWatch = watchRpe != null || watchFeel != null;
  // "קצת" is a yes with the word in the detail, so the coach reads how much.
  const painLevel: 'no' | 'little' | 'yes' | null = pain === false ? 'no' : pain === true ? (painDetail.trim() === t('painLittle') ? 'little' : 'yes') : null;
  const setPainLevel = (v: 'no' | 'little' | 'yes') => {
    if (v === 'no') { setPain(false); setPainDetail(''); return; }
    setPain(true);
    if (v === 'little') setPainDetail(t('painLittle'));
    else if (painDetail.trim() === t('painLittle')) setPainDetail('');
  };
  const card = 'rounded-[20px] bg-card p-4 shadow-sm';

  // ONE SCREEN (Ofer, 2026-10-19, mockups/morning-1019): the run on top so it is clear
  // what is being answered; what the watch already knows is already marked, so when
  // it is right the whole form is one tap on "שליחה".
  return (
    <div className="mx-auto max-w-md space-y-2.5 px-4 pb-2 pt-4" dir="rtl">
      <h1 className="text-xl font-black text-ink-900">{t('title')}</h1>
      {activityName && (
        <div className={cn(card, 'flex items-center gap-3 py-3')}>
          <span aria-hidden className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-brand-600/10 text-xl">🏃</span>
          <p className="min-w-0 truncate text-[15px] font-bold text-ink-900" dir="auto">{activityName}</p>
        </div>
      )}

      {/* The percentage the push quoted, before the questions — the answer to "how did
          it go?" reads differently once you can see how the run compared to the plan. */}
      <ExecutionQuality verdict={verdict} loading={loadingVerdict} />

      {/* Thread with the coach — reachable as soon as a feedback row exists. */}
      {feedbackId && (
        <div className="rounded-xl border border-brand-600/30 bg-brand-600/12 p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <MessageCircle className="h-4 w-4 text-brand-600" />
            <span className="text-xs font-bold text-brand-600">{t('coachReply')}</span>
          </div>
          <FeedbackThread feedbackId={feedbackId} viewerEmail={athleteEmail} />
        </div>
      )}

      {/* Effort, 1-10: one row of steps from green to red, the chosen one says its word. */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-extrabold text-ink-500">{t('difficulty')}</p>
          {difficulty != null && (
            <p className="text-sm font-black" style={{ color: DIFFICULTY_COLOR(difficulty) }}>
              {words[difficulty - 1]} · <bdi dir="ltr">{difficulty}/10</bdi>
            </p>
          )}
        </div>
        <div className="mt-2.5 grid grid-cols-10 gap-1">
          {scale.map(n => {
            const hue = 120 - (n - 1) * 13;
            const on = difficulty === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setDifficulty(n)}
                aria-pressed={on}
                aria-label={`${n} · ${words[n - 1]}`}
                className={cn('h-11 rounded-[10px] text-sm font-extrabold transition-transform', on && 'scale-110')}
                style={on
                  ? { background: `hsl(${hue} 65% 42%)`, color: '#fff', boxShadow: `0 4px 10px hsl(${hue} 60% 40% / .35)` }
                  : { background: `hsl(${hue} 70% 94%)`, color: `hsl(${hue} 60% 28%)` }}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-2xs text-ink-400">
          <span>{words[0]}</span>
          <span>{words[9]}</span>
        </div>
        {fromWatch && (
          <p className="mt-2.5 flex items-center gap-1.5 rounded-[10px] bg-page/70 px-2.5 py-1.5 text-xs text-ink-500">
            <Gauge className="h-3.5 w-3.5" /> {t('watchPrefilled')}
          </p>
        )}
      </div>

      {/* Feel 0-4 — five big faces, the chosen one ringed. */}
      <div className={card}>
        <p className="text-sm font-extrabold text-ink-500">{t('howFeel')}</p>
        <div className="mt-2 flex justify-between">
          {FEEL_FACES.map((f, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setFeel(i)}
              aria-pressed={feel === i}
              className={cn('grid h-14 w-14 place-items-center rounded-[18px] text-3xl transition', feel === i ? 'bg-brand-600/10' : 'bg-page/70 opacity-60 grayscale-[.6]')}
              style={feel === i ? { boxShadow: `0 0 0 2.5px ${FEEL_COLOR[i]}` } : undefined}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Pain: no / a little / yes. */}
      <div className={card}>
        <p className="text-sm font-extrabold text-ink-500">{highEffort ? t('painAfterHard') : t('pain')}</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(['no', 'little', 'yes'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setPainLevel(v)}
              aria-pressed={painLevel === v}
              className={cn('min-h-[44px] rounded-xl text-[15px] font-extrabold transition',
                painLevel === v ? (v === 'no' ? 'bg-brand-600 text-white' : 'bg-accent-red/85 text-white') : 'bg-page/70 text-ink-500')}
            >
              {v === 'no' ? t('no') : v === 'little' ? t('painLittle') : t('yes')}
            </button>
          ))}
        </div>
        {painLevel === 'yes' && (
          <input value={painDetail} onChange={e => setPainDetail(e.target.value)} placeholder={t('painDetail')}
            aria-label={`${highEffort ? t('painAfterHard') : t('pain')} ${t('painDetail')}`}
            className="mt-2 w-full rounded-lg border border-page bg-page/50 px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600" />
        )}
      </div>

      {/* The coach: a switch, not a required yes/no. */}
      <div className={cn(card, 'flex items-center justify-between gap-3')}>
        <p className="text-[15px] font-bold text-ink-900">{feltPoor ? t('wantHelp') : t('wantFeedback')}</p>
        <Switch checked={wantsFeedback === true} onChange={(v) => setWantsFeedback(v)} ariaLabel={feltPoor ? t('wantHelp') : t('wantFeedback')} />
      </div>

      {noteOpen || comment ? (
        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} autoFocus={noteOpen && !comment}
          placeholder={t('commentPlaceholder')}
          aria-label={t('comment')}
          className="w-full rounded-[20px] border border-page bg-card px-4 py-3 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600" />
      ) : (
        <button type="button" onClick={() => setNoteOpen(true)} className="min-h-[44px] w-full text-sm font-extrabold text-brand-600">
          ＋ {t('addNote')}
        </button>
      )}

      {submitError && <p className="text-center text-sm text-accent-red" dir="rtl">{t('submitError')}</p>}

      <div className="sticky bottom-0 -mx-4 bg-page/95 px-4 pb-2 pt-3 backdrop-blur-sm">
        <button onClick={readOnly ? announceReadOnly : submit}
          aria-disabled={readOnly || undefined}
          className={cn('flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl text-[17px] font-black',
            readOnly ? 'bg-page text-ink-400' : 'bg-brand-600 text-white shadow-[0_8px_20px_rgba(21,37,255,.3)] hover:bg-brand-700')}>
          {t('submit')}
        </button>
      </div>
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
