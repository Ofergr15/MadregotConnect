'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { addDaysToDateStr, cn, israelNow, israelToday } from '@/lib/utils';
import { ConfirmSheet, Switch } from '@/components/ui';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import {
  BarButton, CARD, FlowOverlay, FlowScreen, PrimaryButton, RICH, SectionLabel, kmText,
} from '@/components/academy/book/ui';
import { WorkoutEditorPanel } from '@/components/WorkoutEditor';
import { ProfileStrip, WorkoutLines } from '@/components/day-session/WorkoutLines';
import { DAY_SESSION_FOR_ALL } from '@/lib/day-session/flag';
import {
  defaultPushCopy, MAX_DESCRIPTION, MAX_PUSH_BODY, MAX_PUSH_TITLE, MAX_TITLE, numberRuns, parseWorkout, totalsOf, NUTRITION_WHENS,
  type DaySession, type NutritionLine, type NutritionWhen,
} from '@/lib/day-session/model';
import { hasRunning, workoutTitle } from '@/lib/day-session/workout';
import { WatchChoose, WatchTrack, useRoster, useWatchTrack } from '@/components/day-session/WatchSend';
import { countsOf } from '@/lib/day-session/watch-status';
import { packPace, paceRangeText } from '@/lib/plans/session-profile';

// ── "אימון ליום אחד" — the coach's form (mockup manual-day-workout, phones 1 and 2) ──────
//
// Phone 1: when (מחר by default), the hour and the place, the session typed the way it goes
// into WhatsApp with "הבנתי כך" under it — the club's notation, a pace per pack written
// `3:15 (3:25) ((3:35))` and a range `4:40 - 5:15` (lib/day-session/workout.ts). Phone 2:
// the nutrition for this session only — before / during / after, free text — and how it
// goes out.
//
// Two ways to fill the workout: "לכתוב במשפט" (the sentence → "הבנתי כך", then "✎ לערוך")
// or "להכניס ידנית" (from an empty list). Both edit in the PLANNER's own editor
// (WorkoutEditorPanel), so every option the planner has is here: pace per pack, ranges,
// time / distance / lap, repeat blocks, notes, duplicate, drag, undo. Once edited, the
// EDITED steps are what is sent and stored — the sentence is kept only as the coach's own
// words. The title follows the session until the coach writes his own (here or in the
// editor's name field); "הערות לאימון" is free text for the card.
//
// Picking a date that already has a session loads it — its STORED steps, not a re-parse of
// its sentence — so the same form edits it and takes it off the feed. Gated by
// lib/day-session/model.ts; the route says 403 to anyone else.

const FOOD_ICON: Record<NutritionWhen, string> = { before: '🍌', during: '💧', after: '🥤' };
const BLANK_FOOD: NutritionLine[] = NUTRITION_WHENS.map((when) => ({ when, text: '' }));

type Chip = 'today' | 'tomorrow' | 'dayAfter' | 'other';

/** Past midnight the session being written is the morning's, so "today" is the default until 05:00. */
const EARLY_HOURS = 5;
type Mode = 'text' | 'manual';

export default function DaySessionPage() {
  const t = useTranslations('daySession');
  const tc = useTranslations('common');
  const router = useRouter();
  const dayNames = tc.raw('dayNames') as string[];

  const today = israelToday();
  const [chip, setChip] = useState<Chip>(() => (israelNow().hour < EARLY_HOURS ? 'today' : 'tomorrow'));
  const [otherDate, setOtherDate] = useState(addDaysToDateStr(today, 2));
  const date = chip === 'today' ? today : chip === 'tomorrow' ? addDaysToDateStr(today, 1) : chip === 'dayAfter' ? addDaysToDateStr(today, 2) : otherDate;
  const whenText = (d: string) => (d === today ? t('today') : d === addDaysToDateStr(today, 1) ? t('tomorrow') : dateLabel(d));

  const { data: reminderCfg } = useApi<{ config?: { workoutHour?: number } }>('/api/reminder-config');
  const { data: loaded, error: loadError, mutate } = useApi<{ setup: boolean; session: DaySession | null }>(`/api/day-session?date=${date}`);
  // Where the send to the watches stands (api/day-session/watch); polls while it runs.
  const track = useWatchTrack(date);
  const trackCounts = track.data ? countsOf(track.data.runners) : null;
  const existing = loaded?.session ?? null;

  const [step, setStep] = useState<1 | 2 | 'watch' | 'track'>(1);
  // The workout the planner's editor opened on, fixed for as long as it is open: the panel
  // resets its draft whenever this object changes.
  const [editing, setEditing] = useState<ParsedWorkout | null>(null);
  const [time, setTime] = useState('');
  const [place, setPlace] = useState('');
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  // Null = the steps follow the sentence. Otherwise the editor's steps (or the stored ones).
  const [edited, setEdited] = useState<WorkoutStep[] | null>(null);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [description, setDescription] = useState('');
  const [food, setFood] = useState<NutritionLine[]>(BLANK_FOOD);
  const [inFeed, setInFeed] = useState(true);
  const [notify, setNotify] = useState(true);
  const [toWatch, setToWatch] = useState(false);
  // "אימון איכות": people say whether they are coming. Off: a run on your own, no RSVP.
  const [quality, setQuality] = useState(false);
  const roster = useRoster();
  // The notification's text: null = the default, which follows the session.
  const [pushTitle, setPushTitle] = useState<string | null>(null);
  const [pushBody, setPushBody] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // A date with a session already: the form becomes that session.
  useEffect(() => {
    if (!loaded) return;
    const s = loaded.session;
    setMessage(null);
    if (s) {
      setTime(s.startTime || '');
      setPlace(s.place || '');
      setMode(s.quickText ? 'text' : 'manual');
      setText(s.quickText);
      setEdited(s.steps);
      setTitle(s.title);
      setTitleTouched(!!s.title && s.title !== workoutTitle(s.steps));
      setDescription(s.description || '');
      setFood(s.nutrition.length ? s.nutrition : BLANK_FOOD);
      setInFeed(!!s.publishedAt);
      setNotify(s.notify);
      setQuality(s.quality);
    } else {
      setText(''); setPlace(''); setFood(BLANK_FOOD); setInFeed(true); setNotify(true); setQuality(false);
      setMode('text'); setEdited(null); setTitle(''); setTitleTouched(false); setDescription('');
    }
  }, [loaded]);

  // The club's practice hour as the default time, until the coach types one.
  useEffect(() => {
    const h = reminderCfg?.config?.workoutHour;
    if (time || existing || typeof h !== 'number') return;
    setTime(`${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);
  }, [reminderCfg, existing, time]);

  const parse = useMemo(() => parseWorkout(text), [text]);
  const steps = edited ?? (mode === 'text' ? parse.steps : []);
  const totals = steps.length ? totalsOf(steps) : null;
  const ready = steps.length > 0 && hasRunning(steps);
  const autoTitle = steps.length ? workoutTitle(steps) : '';
  const shownTitle = titleTouched ? title : autoTitle;
  const pushDefault = defaultPushCopy({ date, steps, startTime: time || null, place: place || null, nutrition: food.filter((l) => l.text.trim()) }, today);

  // The planner's editor saves the whole workout: its steps, and its name as the title
  // when the coach changed it there.
  const doneEditing = (next: WorkoutStep[], name: string) => {
    setEdited(next);
    const nextAuto = workoutTitle(next);
    if (name.trim() && name.trim() !== shownTitle && name.trim() !== nextAuto) { setTitle(name.trim()); setTitleTouched(true); }
  };
  const openEditor = (from: WorkoutStep[] = steps) =>
    setEditing({ dayOfWeek: new Date(`${date}T12:00:00`).getDay(), name: shownTitle, steps: from });
  const pickMode = (next: Mode) => {
    if (next === mode) return;
    if (steps.length && !window.confirm(t('restartConfirm'))) return;
    setMode(next);
    if (next === 'manual') {
      setEdited([]);
      openEditor([]);
    } else {
      setEdited(null);
    }
  };

  const forbidden = (loadError as { status?: number } | undefined)?.status === 403;
  const notSetUp = loaded?.setup === false;
  const alreadySent = !!existing?.notifiedAt;

  const dateLabel = (d: string) => `${dayNames[new Date(`${d}T12:00:00`).getDay()]} ${d.slice(8, 10)}.${d.slice(5, 7)}`;

  const save = async (publish: boolean) => {
    if (!ready || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/day-session', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({
          date, startTime: time || null, place,
          quickText: mode === 'text' ? text : '',
          // The steps as shown — the edit when there is one, never re-parsed by the server.
          steps: edited ?? parse.steps,
          title: titleTouched ? title.trim() : null,
          description,
          quality,
          pushTitle: pushTitle?.trim() || null,
          pushBody: pushBody?.trim() || null,
          nutrition: food.filter((l) => l.text.trim()),
          publish, notify,
        }),
      });
      if (res.status === 503) { setMessage({ tone: 'bad', text: t('notSetUp') }); return; }
      if (res.status === 400) { setMessage({ tone: 'bad', text: t('notUnderstood') }); return; }
      if (!res.ok) { setMessage({ tone: 'bad', text: t('failed') }); return; }
      const body = await res.json().catch(() => null) as { session?: DaySession } | null;
      await mutate();
      if (description.trim() && !body?.session?.description) {
        setMessage({ tone: 'bad', text: t('descriptionNotSaved') });
        return;
      }
      // "גם לשעונים": straight on to who gets it (mockup watch-send-v3).
      if (publish && toWatch) { setMessage(null); setStep('watch'); return; }
      setMessage({ tone: 'ok', text: publish ? t('published') : t('saved') });
      if (publish) router.push('/feed');
    } catch {
      setMessage({ tone: 'bad', text: t('failed') });
    } finally {
      setBusy(false);
    }
  };

  const close = () => router.push('/dashboard/coach-tools');

  // Deleting the date's session (Ofer, 2026-10-18: one went out for the wrong day). The row,
  // and its copies on the watches; the push that already went cannot be called back.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = async () => {
    if (!existing || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/day-session?date=${date}`, { method: 'DELETE', headers: await apiHeaders() });
      if (!res.ok && res.status !== 404) { setMessage({ tone: 'bad', text: t('deleteFailed') }); return; }
      await mutate();
      setMessage({ tone: 'ok', text: t('deleted') });
    } catch {
      setMessage({ tone: 'bad', text: t('deleteFailed') });
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  // Start a send (or a re-send) and show where it stands.
  const sendToWatches = async (ids: string[]) => {
    if (!ids.length || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/day-session/watch', { method: 'POST', headers: await apiHeaders(true), body: JSON.stringify({ date, athleteIds: ids }) });
      if (!res.ok) { setMessage({ tone: 'bad', text: t('failed') }); return; }
      track.wake();
      await track.mutate();
      setStep('track');
    } catch {
      setMessage({ tone: 'bad', text: t('failed') });
    } finally {
      setSending(false);
    }
  };

  // Opened from the coach's "how it went" push: /dashboard/day-session?date=…&track=1.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const d = q.get('date');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      if (d === today) setChip('today');
      else if (d === addDaysToDateStr(today, 1)) setChip('tomorrow');
      else { setOtherDate(d); setChip('other'); }
      if (q.get('track') === '1') setStep('track');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The session line both watch screens open with.
  const sessionLine = (
    <div className={cn(CARD, 'flex items-center gap-3 px-3.5 py-3')}>
      <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-brand-600/10 text-[22px]">🏃</span>
      <span className="min-w-0 flex-1">
        <b className="block text-base text-ink-900">{whenText(date)} · {dayNames[new Date(`${date}T12:00:00`).getDay()]}{time && <> · <bdi dir="ltr">{time}</bdi></>}</b>
        <small className="block truncate text-13 text-ink-500">{numberRuns(shownTitle).map((r, i) => (r.ltr ? <bdi key={i} dir="ltr">{r.text}</bdi> : <span key={i}>{r.text}</span>))}</small>
      </span>
    </div>
  );
  const packPaces = [0, 1, 2].map((i) => { const p = packPace(steps, i); return p ? paceRangeText(p) : null; });

  // "נשלח לשעונים ✓ 10/12 ‹" — or "לשלוח לשעונים ‹" for a published session never sent.
  const watchRow = existing?.publishedAt ? (
    <button type="button" onClick={() => setStep(trackCounts?.total ? 'track' : 'watch')} className={cn(CARD, 'flex min-h-[64px] w-full items-center gap-3 px-4 text-start')}>
      <span aria-hidden className="text-[22px]">⌚</span>
      <span className="min-w-0 flex-1">
        <b className="block text-[15px] text-ink-900">{trackCounts?.total ? t('watchSentRow') : t('watchSendRow')}</b>
        <small className="block text-13 text-ink-400">{trackCounts?.total ? (track.onTheWay ? t('watchOnTheWay') : t('watchSentAt', { time: track.data?.sentAt ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(track.data.sentAt)) : '' })) : t('watchSendSub')}</small>
      </span>
      {trackCounts?.total ? (
        <span className={cn('rounded-lg px-2 py-1 text-13 font-bold', trackCounts.failed ? 'bg-accent-red/10 text-accent-red' : 'bg-accent-600/10 text-accent-900')}>
          {trackCounts.failed ? '!' : '✓'} <bdi dir="ltr">{trackCounts.ok}/{trackCounts.total}</bdi>
        </span>
      ) : null}
      <span aria-hidden className="text-xl text-ink-300">‹</span>
    </button>
  ) : null;

  if (step === 'watch') {
    return (
      <FlowOverlay label={t('toWatches')}>
        <FlowScreen title={t('toWatches')} leading={<BarButton onClick={() => setStep(existing ? 2 : 1)}>‹ {t('back')}</BarButton>} className="gap-0 p-0 pt-3">
          {roster ? (
            <WatchChoose roster={roster} paces={packPaces} session={sessionLine} busy={sending} onSend={sendToWatches} />
          ) : <p className="p-6 text-center text-sm text-ink-400">…</p>}
        </FlowScreen>
      </FlowOverlay>
    );
  }

  if (step === 'track') {
    return (
      <FlowOverlay label={t('trackTitle')}>
        <FlowScreen
          title={track.onTheWay ? t('trackSending') : t('trackTitle')}
          leading={<BarButton onClick={() => setStep(2)}>‹ {t('back')}</BarButton>}
          trailing={<BarButton onClick={() => router.push('/feed')}>{t('toFeed')}</BarButton>}
          className="gap-0 p-0 pt-3"
        >
          {track.data ? (
            <>
              {message && <p role="status" className="mx-4 mb-3 rounded-[14px] bg-accent-red/10 px-3 py-2.5 text-sm font-bold text-accent-red">{message.text}</p>}
              <WatchTrack data={track.data} busy={sending} onResend={sendToWatches} />
              <div className="shrink-0 px-4 pb-7 pt-1">
                <button type="button" onClick={() => setStep('watch')} className="min-h-[44px] w-full text-[15px] font-bold text-brand-600">{t('watchSendMore')}</button>
              </div>
            </>
          ) : <p className="p-6 text-center text-sm text-ink-400">…</p>}
        </FlowScreen>
      </FlowOverlay>
    );
  }

  if (forbidden) {
    return (
      <FlowOverlay label={t('formTitle')}>
        <FlowScreen title={t('formTitle')} leading={<BarButton onClick={close}>{t('cancel')}</BarButton>}>
          <p className={cn(CARD, 'p-4 text-sm font-bold text-ink-700')}>{t('noAccess')}</p>
        </FlowScreen>
      </FlowOverlay>
    );
  }

  const banner = (
    <>
      {notSetUp && <p className="rounded-[14px] bg-[#FDF0E2] px-3 py-2.5 text-sm font-bold text-[#8A4308]" role="alert">{t('notSetUp')}</p>}
      {existing && <p className="rounded-[14px] bg-brand-600/10 px-3 py-2.5 text-sm font-bold text-brand-600">{t('editing', { date: dateLabel(date) })}</p>}
      {message && (
        <p role="status" className={cn('rounded-[14px] px-3 py-2.5 text-sm font-bold', message.tone === 'ok' ? 'bg-accent-600/10 text-accent-900' : 'bg-accent-red/10 text-accent-red')}>{message.text}</p>
      )}
    </>
  );

  if (step === 1) {
    return (
      <FlowOverlay label={t('formTitle')}>
        <FlowScreen
          title={t('formTitle')}
          leading={<BarButton onClick={close}>{t('cancel')}</BarButton>}
          footer={<PrimaryButton onClick={() => setStep(2)} disabled={!ready}>{t('toNutrition')}</PrimaryButton>}
        >
          {banner}
          {watchRow}
          <SectionLabel>{t('when')}</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {(['today', 'tomorrow', 'dayAfter', 'other'] as Chip[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChip(c)}
                aria-pressed={chip === c}
                className={cn('min-h-[44px] rounded-xl border px-3 text-sm font-extrabold', chip === c ? 'border-brand-600 bg-brand-600 text-white' : 'border-[#E6E6EC] bg-white text-ink-500')}
              >
                {c === 'today' ? `${t('today')} · ${dayNames[new Date(`${today}T12:00:00`).getDay()]}`
                  : c === 'tomorrow' ? `${t('tomorrow')} · ${dayNames[new Date(`${addDaysToDateStr(today, 1)}T12:00:00`).getDay()]}`
                    : t(c === 'other' ? 'otherDate' : 'dayAfter')}
              </button>
            ))}
          </div>
          {chip === 'other' && (
            <input
              type="date"
              value={otherDate}
              min={today}
              onChange={(e) => e.target.value && setOtherDate(e.target.value)}
              aria-label={t('otherDate')}
              className={cn(CARD, 'min-h-[48px] px-4 text-base font-bold')}
            />
          )}
          <div className={cn(CARD, 'overflow-hidden')}>
            <label className="flex min-h-[48px] items-center justify-between gap-3 border-b border-[#EFEFF4] px-4">
              <span className="text-13 font-bold text-ink-400">{t('time')}</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} dir="ltr" className="min-h-[44px] bg-transparent text-end text-base font-bold text-ink-900 outline-none" />
            </label>
            <label className="flex min-h-[48px] items-center justify-between gap-3 px-4">
              <span className="shrink-0 text-13 font-bold text-ink-400">{t('place')}</span>
              <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('placePlaceholder')} maxLength={120} className="min-h-[44px] min-w-0 flex-1 bg-transparent text-end text-base font-bold text-ink-900 outline-none placeholder:font-normal placeholder:text-ink-300" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={`${t('modeText')} / ${t('modeManual')}`}>
            {(['text', 'manual'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => pickMode(m)}
                className={cn('min-h-[44px] rounded-xl border text-sm font-extrabold', mode === m ? 'border-brand-600 bg-brand-600 text-white' : 'border-[#E6E6EC] bg-white text-ink-500')}
              >
                {m === 'text' ? t('modeText') : t('modeManual')}
              </button>
            ))}
          </div>

          {mode === 'text' && !edited && (
            <>
              <SectionLabel>{t('workout')}</SectionLabel>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                dir="rtl"
                rows={4}
                aria-label={t('workout')}
                placeholder={t('workoutPlaceholder')}
                className={cn(CARD, 'min-h-[120px] resize-none rounded-[14px] border-2 border-brand-600 px-4 py-3 text-[17px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-400')}
              />
              <p className="px-1 text-13 leading-normal text-ink-400">{t('workoutHint')}</p>
            </>
          )}
          {(steps.length > 0 || mode === 'manual') && (
            <div className={cn(CARD, 'space-y-2.5 p-3.5')}>
              <SectionLabel>{edited ? (mode === 'manual' ? t('manualHeader') : t('editedHeader')) : t('understood')}</SectionLabel>
              {steps.length > 0 ? (
                <>
                  <WorkoutLines steps={steps} />
                  <ProfileStrip steps={steps} />
                  {totals && (
                    <p className="text-13 text-ink-400">{t.rich('totals', { ...RICH, km: kmText(totals.distanceM), min: Math.round(totals.durationSec / 60) })}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink-500">{t('manualEmpty')}</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={() => openEditor()} className="min-h-[44px] rounded-xl bg-[#EEF0FF] px-4 text-[15px] font-extrabold text-brand-600">
                  {steps.length ? t('edit') : t('addSteps')}
                </button>
                {edited && mode === 'text' && (
                  <button type="button" onClick={() => setEdited(null)} className="min-h-[44px] text-sm font-bold text-ink-400">
                    {t('backToSentence')}
                  </button>
                )}
              </div>
              {edited && mode === 'text' && text && (
                <p className="text-13 text-ink-400"><bdi>{t('fromSentence', { text })}</bdi></p>
              )}
            </div>
          )}
          {mode === 'text' && !edited && parse.unknown.length > 0 && (
            <ul className="space-y-1 px-1 text-13 text-[#8A4308]">
              {parse.unknown.map((u) => <li key={u}>• {t('unknownWords', { text: u })}</li>)}
            </ul>
          )}

          {steps.length > 0 && (
            <div className={cn(CARD, 'overflow-hidden')}>
              {/* Shown with its numbers isolated (an input would flip `5 × 1` to `1 × 5`); a tap
                  turns it into the field. */}
              {titleEditing ? (
                <label className="flex min-h-[48px] items-center justify-between gap-3 px-4">
                  <span className="shrink-0 text-13 font-bold text-ink-400">{t('titleLabel')}</span>
                  <input
                    autoFocus
                    value={shownTitle}
                    onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
                    onBlur={() => setTitleEditing(false)}
                    maxLength={MAX_TITLE}
                    aria-label={t('titleLabel')}
                    className="min-h-[44px] min-w-0 flex-1 bg-transparent text-end text-base font-bold text-ink-900 outline-none"
                  />
                </label>
              ) : (
                <button type="button" onClick={() => setTitleEditing(true)} aria-label={t('titleLabel')} className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-start">
                  <span className="shrink-0 text-13 font-bold text-ink-400">{t('titleLabel')}</span>
                  <span className="min-w-0 flex-1 truncate text-end text-base font-bold text-ink-900">
                    {numberRuns(shownTitle).map((r, i) => (r.ltr ? <bdi key={i} dir="ltr">{r.text}</bdi> : <span key={i}>{r.text}</span>))}
                    <span className="ms-2 text-brand-600" aria-hidden>✎</span>
                  </span>
                </button>
              )}
              {titleTouched && (
                <button type="button" onClick={() => { setTitleTouched(false); setTitle(''); }} className="min-h-[44px] w-full border-t border-[#EFEFF4] px-4 text-start text-sm font-bold text-brand-600">
                  {t('titleAuto')} · {numberRuns(autoTitle).map((r, i) => (r.ltr ? <bdi key={i} dir="ltr">{r.text}</bdi> : <span key={i}>{r.text}</span>))}
                </button>
              )}
            </div>
          )}

          <SectionLabel>{t('description')}</SectionLabel>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            dir="auto"
            rows={3}
            maxLength={MAX_DESCRIPTION}
            aria-label={t('description')}
            placeholder={t('descriptionPlaceholder')}
            className={cn(CARD, 'min-h-[88px] resize-none rounded-[14px] px-4 py-3 text-[16px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-300')}
          />

          {existing && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className={cn(CARD, 'min-h-[52px] w-full text-[15px] font-extrabold text-accent-red disabled:opacity-60')}
            >
              {t('delete')}
            </button>
          )}
          <ConfirmSheet
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={t('deleteTitle', { day: dateLabel(date) })}
            description={existing?.notifiedAt ? t('deleteBodySent') : t('deleteBody')}
            confirmLabel={t('deleteConfirm')}
            cancelLabel={t('cancel')}
            onConfirm={() => { void remove(); }}
          />
        </FlowScreen>
        {editing && (
          <WorkoutEditorPanel
            workout={editing}
            dayName={`${t('formTitle')} · ${dateLabel(date)}`}
            onChange={(w) => doneEditing(w.steps, w.name)}
            onClose={() => setEditing(null)}
          />
        )}
      </FlowOverlay>
    );
  }

  return (
    <FlowOverlay label={t('formTitle')}>
      <FlowScreen
        title={t('formTitle')}
        leading={<BarButton onClick={() => setStep(1)}>‹ {t('back')}</BarButton>}
        footer={(
          <>
            <PrimaryButton onClick={() => save(inFeed)} disabled={!ready} busy={busy}>
              {inFeed ? `${t('publish')} · ${whenText(date)}` : t('saveHidden')}
            </PrimaryButton>
            {existing?.publishedAt && (
              <PrimaryButton secondary onClick={() => { setInFeed(false); void save(false); }} disabled={busy}>{t('unpublish')}</PrimaryButton>
            )}
          </>
        )}
      >
        {banner}
        <SectionLabel>{t('nutrition')}</SectionLabel>
        <div className={cn(CARD, 'overflow-hidden')}>
          {food.map((line, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-[#EFEFF4] px-3 py-1.5 last:border-0">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#E4F6F0] text-base">{FOOD_ICON[line.when]}</span>
              <select
                value={line.when}
                onChange={(e) => setFood((f) => f.map((l, j) => (j === i ? { ...l, when: e.target.value as NutritionWhen } : l)))}
                aria-label={t('when')}
                className="h-11 shrink-0 appearance-none rounded-lg bg-[#E4F6F0] px-2 text-13 font-extrabold text-[#0B7258] outline-none"
              >
                {NUTRITION_WHENS.map((w) => <option key={w} value={w}>{t(w)}</option>)}
              </select>
              <input
                value={line.text}
                onChange={(e) => setFood((f) => f.map((l, j) => (j === i ? { ...l, text: e.target.value } : l)))}
                placeholder={t('foodPlaceholder')}
                maxLength={200}
                className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-300"
              />
              <button type="button" onClick={() => setFood((f) => f.filter((_, j) => j !== i))} aria-label={t('removeLine')} className="grid h-11 w-11 shrink-0 place-items-center text-ink-300">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setFood((f) => [...f, { when: f[f.length - 1]?.when ?? 'before', text: '' }])}
            className="flex min-h-[48px] w-full items-center gap-2 px-4 text-sm font-extrabold text-brand-600"
          >
            <Plus className="h-4 w-4" />{t('addLine')}
          </button>
        </div>

        <SectionLabel>{t('publishHeader')}</SectionLabel>
        <div className={cn(CARD, 'overflow-hidden')}>
          <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-[#EFEFF4] px-4 py-2">
            <span className="min-w-0">
              <b className="block text-[15px] text-ink-900">{t('quality')}</b>
              <small className="block text-13 text-ink-400">{quality ? t('qualityOn') : t('qualityOff')}</small>
            </span>
            <Switch checked={quality} onChange={setQuality} activeColor="bg-[#1FA55B]" ariaLabel={t('quality')} />
          </div>
          <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-[#EFEFF4] px-4 py-2">
            <span className="min-w-0">
              <b className="block text-[15px] text-ink-900">{t('showInFeed')}</b>
              <small className="block text-13 text-ink-400">{t('showInFeedSub')}</small>
            </span>
            <Switch checked={inFeed} onChange={setInFeed} activeColor="bg-[#1FA55B]" ariaLabel={t('showInFeed')} />
          </div>
          <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-[#EFEFF4] px-4 py-2">
            <span className="min-w-0">
              <b className="block text-[15px] text-ink-900">{t('notifyAll')}</b>
              <small className="block text-13 text-ink-400">
                {alreadySent ? t('notifyAlreadySent') : DAY_SESSION_FOR_ALL ? t('notifyEveryone') : t('notifyOnlyYou')}
              </small>
            </span>
            <Switch checked={notify && !alreadySent} onChange={setNotify} disabled={alreadySent} activeColor="bg-[#1FA55B]" ariaLabel={t('notifyAll')} />
          </div>
          {notify && !alreadySent && (
            // What the lock screen will say — the default follows the session; either line can
            // be rewritten, and ↺ goes back to the default.
            <div className="space-y-2 border-b border-[#EFEFF4] px-4 py-3">
              <div className="rounded-[18px] bg-[#F2F2F7] px-3.5 py-2.5" aria-label={t('pushPreview')}>
                <div className="flex items-center gap-2 text-xs font-bold text-ink-400"><span aria-hidden>🏃</span>MADREGOT<span className="ms-auto font-normal">{t('now')}</span></div>
                <p dir="auto" className="mt-1 text-[15px] font-bold leading-snug text-ink-900">{pushTitle ?? pushDefault.title}</p>
                <p dir="auto" className="text-[15px] leading-snug text-ink-700">{pushBody ?? pushDefault.body}</p>
              </div>
              <label className="block">
                <span className="text-13 font-bold text-ink-400">{t('pushTitleLabel')}</span>
                <input dir="auto" value={pushTitle ?? pushDefault.title} maxLength={MAX_PUSH_TITLE} onChange={(e) => setPushTitle(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-xl bg-page px-3 text-[15px] font-bold text-ink-900 outline-none" />
              </label>
              <label className="block">
                <span className="text-13 font-bold text-ink-400">{t('pushBodyLabel')}</span>
                <textarea dir="auto" rows={2} value={pushBody ?? pushDefault.body} maxLength={MAX_PUSH_BODY} onChange={(e) => setPushBody(e.target.value)} className="mt-1 w-full resize-none rounded-xl bg-page px-3 py-2 text-[15px] text-ink-900 outline-none" />
              </label>
              {(pushTitle !== null || pushBody !== null) && (
                <button type="button" onClick={() => { setPushTitle(null); setPushBody(null); }} className="min-h-[44px] text-sm font-bold text-brand-600">{t('pushReset')}</button>
              )}
            </div>
          )}
          <div className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2">
            <span className="min-w-0">
              <b className="block text-[15px] text-ink-900">{t('toWatches')}</b>
              <small className="block text-13 text-ink-400">{t('toWatchesNext')}</small>
            </span>
            <Switch checked={toWatch && inFeed} onChange={setToWatch} disabled={!inFeed} activeColor="bg-[#1FA55B]" ariaLabel={t('toWatches')} />
          </div>
        </div>
        {watchRow}
      </FlowScreen>
    </FlowOverlay>
  );
}
