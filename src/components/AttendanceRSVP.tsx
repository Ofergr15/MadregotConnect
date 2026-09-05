'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle, Users } from 'lucide-react';
import { cn, getPlanWeekStart } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';

const GROUP_PRESETS = ['דבוקה 1', 'דבוקה 2', 'דבוקה 3'];

export interface AttendanceStatus { answered: boolean; attending: boolean | null }

// Pre-workout RSVP for a specific workout — TODAY's, or (the evening before) the
// NEXT team-workout day. The dashboard picks the target (weekStart + day); when
// omitted we default to today, so existing call sites keep working. Athlete
// answers: coming? + which דבוקה.
export function AttendanceRSVP({ workoutLabel, weekStart: weekStartProp, day: dayProp, dayBefore, workoutHour, hideIfAnswered, variant = 'card', onStatusChange }: { workoutLabel?: string; weekStart?: string; day?: number; dayBefore?: boolean; workoutHour?: number; hideIfAnswered?: boolean; variant?: 'card' | 'inline'; onStatusChange?: (status: AttendanceStatus) => void }) {
  const t = useTranslations('attendance');
  const [athleteId, setAthleteId] = useState('');
  const weekStart = weekStartProp ?? getPlanWeekStart(new Date());
  const day = dayProp ?? new Date().getDay();

  const [attending, setAttending] = useState<boolean | null>(null);
  const [group, setGroup] = useState('');
  const [customGroup, setCustomGroup] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // On the workout day the card only nudges athletes who never answered; once
  // they have an RSVP on record it self-hides (the day-before flow already asked).
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);

  const refetch = useCallback((id: string) => {
    return apiHeaders()
      .then(h => fetch(`/api/attendance?weekStart=${weekStart}&day=${day}&athleteId=${id}`, { headers: h }))
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.rsvp) {
          setAlreadyAnswered(true);
          setAttending(data.rsvp.attending);
          const label = data.rsvp.groupLabel || '';
          setGroup(label);
          // A saved label that isn't one of the presets came from the free-text box.
          if (label && !GROUP_PRESETS.includes(label)) setCustomGroup(label);
        }
      })
      .catch(() => {});
  }, [weekStart, day]);

  useEffect(() => {
    const id = localStorage.getItem('athlete_id') || '';
    setAthleteId(id);
    if (!id) { setLoaded(true); return; }
    refetch(id).finally(() => setLoaded(true));
  }, [refetch]);

  // A background push action (the OS notification's ✅/❌ buttons) can answer
  // this exact RSVP while this card is already mounted and showing the old
  // state — the service worker has no way to update this component directly,
  // so it posts a message instead; refetch whenever one arrives for this
  // week+day rather than going stale until a manual reload.
  useEffect(() => {
    if (!athleteId || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.source === 'madregot-sw' && msg.type === 'rsvp' && msg.ok && msg.weekStart === weekStart && String(msg.day) === String(day)) {
        refetch(athleteId);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [athleteId, weekStart, day, refetch]);

  // Surface the answered/attending state to the parent (e.g. the dashboard's
  // "next workout" hero card uses this to decide its CTA) without exposing or
  // duplicating any of the fetch/submit logic above.
  useEffect(() => {
    if (!loaded) return;
    onStatusChange?.({ answered: alreadyAnswered || attending !== null, attending });
  }, [loaded, alreadyAnswered, attending, onStatusChange]);

  // Guards the rollback below against a rapid double-tap: two submits in
  // flight at once, the first rejects after the second already succeeded —
  // without this, the first call's `catch` would still fire and roll back to
  // whatever `attending` was BEFORE either tap, undoing the second tap's
  // already-persisted answer. Only the most recent call is allowed to roll back.
  const submitSeqRef = useRef(0);

  const submit = async (isAttending: boolean) => {
    if (!athleteId) return;
    // Optimistic: flip the button immediately, save in the background. If the
    // save fails, roll back to the previous choice so the UI never lies.
    const prev = attending;
    const mySeq = ++submitSeqRef.current;
    setAttending(isAttending);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({
          athleteId, weekStart, day,
          attending: isAttending,
          groupLabel: isAttending ? (group || null) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || t('saveFailed'));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      if (submitSeqRef.current === mySeq) setAttending(prev); // only roll back if no newer submit has since started
      setError(err instanceof Error ? err.message : t('saveFailed'));
    }
  };

  if (!loaded || !athleteId) return null;
  // Workout-day mode: nothing to nudge if they've already RSVP'd.
  if (hideIfAnswered && alreadyAnswered && !saved) return null;

  // ── `inline` — the designer's frames put the RSVP INSIDE the "next workout"
  // card as two bare pills: no wrapper, no title, no glow, because the parent
  // card already supplies all three. Everything above this line is shared with
  // the dark `card` variant, so the two surfaces can't drift apart on the
  // optimistic rollback, the service-worker refetch or the answered/unanswered
  // rules. The group picker isn't in the frame — the designer only drew the
  // pre-tap state — but it stays, restyled, because it's the only place the
  // דבוקה is captured.
  if (variant === 'inline') {
    // `מגיע` stays filled while UNANSWERED too: it's the primary action in the
    // frame. What distinguishes "we're asking" from "you answered yes" is the
    // confirmation line below, not the fill — without it the two states would
    // be pixel-identical and nobody would ever tap.
    const pill = 'flex-1 min-h-[44px] rounded-pill text-sm flex items-center justify-center transition';
    const idle = 'bg-card text-ink-700 border border-ink-300 font-light';
    return (
      <div className="space-y-2">
        <div className="flex gap-2.5">
          <button
            onClick={() => submit(true)}
            className={cn(pill, attending === false ? idle : 'bg-brand-600 text-white font-bold')}
            dir="rtl"
          >
            {t('coming')}
          </button>
          <button
            onClick={() => submit(false)}
            // Filled-with-white-text, mirroring `מגיע` above: the previous
            // `bg-ink-500 text-ink-700` put near-black text on a mid-grey fill
            // at 2.31:1, the worst contrast in the app, and darkening ink-500
            // for the ramp would only have made it worse.
            className={cn(pill, attending === false ? 'bg-ink-700 text-white font-bold' : idle)}
            dir="rtl"
          >
            {t('notComing')}
          </button>
        </div>
        {attending === true && (
          <p className="flex items-center gap-1.5 text-2xs font-bold text-brand-600" dir="rtl">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {dayBefore ? t('confirmedTomorrow') : t('confirmed')}
          </p>
        )}
        {error && <p className="text-2xs text-accent-red" dir="rtl">{error}</p>}
        {attending === true && (
          <div className="pt-1">
            <p className="mb-1.5 text-2xs font-light text-ink-400" dir="rtl">{t('whichGroup')}</p>
            <div className="flex flex-wrap gap-2">
              {GROUP_PRESETS.map(g => (
                <button
                  key={g}
                  onClick={() => { setGroup(g); setCustomGroup(''); submitGroup(g, ''); }}
                  className={cn('min-h-[32px] rounded-pill px-3 text-2xs transition',
                    group === g ? 'bg-brand-600 text-white font-bold' : 'bg-card text-ink-700 border border-ink-300 font-light')}
                  dir="rtl"
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-600/25 p-4"
      style={{ background: 'linear-gradient(150deg, rgba(67,56,255,.22), rgba(30,41,59,.6) 72%)' }}
    >
      {/* soft brand glow — marks this as the focused "today" hero */}
      <div className="pointer-events-none absolute -top-8 start-[-20px] w-40 h-40 rounded-full blur-2xl"
        style={{ background: 'radial-gradient(circle, rgba(67,56,255,.4), transparent 70%)' }} aria-hidden="true" />
      <div className="relative flex items-center gap-2 mb-1">
        <Users className="h-4 w-4 text-brand-600" />
        <h3 className="text-sm font-bold text-ink-700" dir="rtl">{dayBefore ? t('titleTomorrow') : t('title')}</h3>
      </div>
      {workoutLabel && <p className="relative text-[15px] font-semibold text-ink-700 mb-3" dir="rtl">{workoutLabel}</p>}

      <div className="relative flex gap-2">
        <button
          onClick={() => submit(true)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition',
            attending === true ? 'bg-brand-600 text-white' : 'bg-page/50 text-ink-500 hover:bg-ink-300/40')}
          dir="rtl"
        >
          <CheckCircle2 className="h-4 w-4" /> {t('coming')}
        </button>
        <button
          onClick={() => submit(false)}
          className={cn('flex-1 min-h-[44px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition',
            attending === false ? 'bg-ink-300 text-ink-700' : 'bg-page/50 text-ink-500 hover:bg-ink-300/40')}
          dir="rtl"
        >
          <XCircle className="h-4 w-4" /> {t('notComing')}
        </button>
      </div>
      {error && <p className="relative text-xs text-accent-red mt-2" dir="rtl">{error}</p>}

      {attending === true && (
        <div className="relative mt-3 space-y-3">
          {/* Persistent green confirmation with the concrete workout info — the
              old feedback was a tiny CheckCircle2 in the header that faded after
              2s (via `saved`); that only confirmed "the save worked", not "what
              you're now committed to". This stays up as long as attending===true. */}
          <div className="rounded-xl border border-accent-600/40 bg-accent-600/10 p-3 flex items-center gap-2.5" dir="rtl">
            <CheckCircle2 className="h-5 w-5 text-accent-600 shrink-0" />
            <div>
              <p className="text-sm font-bold text-accent-600">{dayBefore ? t('confirmedTomorrow') : t('confirmed')}</p>
              {(workoutLabel || workoutHour != null) && (
                <p className="text-xs text-accent-600/80 mt-0.5">
                  {[workoutLabel, workoutHour != null ? `${String(workoutHour).padStart(2, '0')}:00` : null].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>

          <p className="text-xs font-semibold text-ink-400 mb-2" dir="rtl">{t('whichGroup')}</p>
          <div className="flex flex-wrap gap-2">
            {GROUP_PRESETS.map(g => (
              <button
                key={g}
                onClick={() => { setGroup(g); setCustomGroup(''); submitGroup(g, ''); }}
                className={cn('px-3 py-2 rounded-full text-xs font-bold transition',
                  group === g ? 'bg-brand-600 text-white' : 'bg-page/50 text-ink-500 hover:bg-ink-300/40')}
                dir="rtl"
              >
                {g}
              </button>
            ))}
          </div>
          {/* Free-text "other group" — for anyone not in a preset דבוקה. Saves on
              blur / Enter; typing here clears any preset selection. */}
          <input
            value={customGroup}
            onChange={e => { setCustomGroup(e.target.value); if (e.target.value) setGroup(''); }}
            onBlur={() => { if (customGroup.trim()) submitGroup('', customGroup); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder={t('otherGroup')}
            dir="rtl"
            className={cn('mt-2 w-full bg-page/50 border rounded-lg px-3 py-2 text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600',
              customGroup.trim() ? 'border-brand-600' : 'border-page')}
          />
        </div>
      )}
    </div>
  );

  // Persist a group choice without flipping attendance (already true). The chip
  // highlights instantly (setGroup); this saves in the background.
  async function submitGroup(preset: string, custom: string) {
    if (!athleteId) return;
    setError(null);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({
          athleteId, weekStart, day, attending: true,
          groupLabel: custom.trim() || preset || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || t('saveFailed'));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    }
  }
}
