'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { academyThreadUrl } from '@/lib/academy/deep-links';
import type { WorkoutResponse } from '@/lib/academy/workout-extras';
import type { ThreadMessage } from '@/components/academy/ThreadTranscript';
import { FeedbackCard } from '@/components/academy/FeedbackCard';
import { BarButton, FlowOverlay, FlowScreen, PrimaryButton } from '@/components/academy/book/ui';
import { CARD, Chevron, RICH, SHADOW, StructureText } from './ui';

// ── 6: how it felt, and what the coach says (mockup trainee-experience-v2, phone 6) ─────
//
// Five faces and effort 1–10 in two rows (every button ≥44 px), prefilled from what the
// watch saved, so one tap saves — and "דילוג" is always there. Pain notifies the coach
// (POST /api/workout-feedback already does: notifyStaff on pain). Under it, the
// conversation about THIS workout: the coach's review of the run first, then the last two
// messages tagged with its date, and a line to write one more.

/** The five faces, feel 0–4 (חלש מאוד … חזק מאוד); the week board's 🙂 mark draws the same ones. */
export const FACES = ['😫', '😕', '😐', '🙂', '🤩'];

interface ThreadPayload {
  viewerId: string | null;
  messages: ThreadMessage[];
}

export function FeelAndTalk({ athleteId, date, dayLabel, workoutName, coachName, data, onClose, onSaved }: {
  athleteId: string;
  date: string;
  /** "שלישי". */
  dayLabel: string;
  workoutName: string;
  coachName: string | null;
  data: WorkoutResponse;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useTranslations('trainee.feel');
  const own = data.feedback ?? null;
  const watch = data.feelPrefill ?? null;
  const [feel, setFeel] = useState<number | null>(own?.feel ?? watch?.feel ?? null);
  const [effort, setEffort] = useState<number | null>(own?.difficulty ?? watch?.effort ?? null);
  const [pain, setPain] = useState<boolean>(own?.pain ?? false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const fromWatch = !own && !!watch && (feel === watch.feel || effort === watch.effort);

  const threadKey = `/api/academy/threads/messages?athleteId=${encodeURIComponent(athleteId)}&workoutDate=${date}`;
  const { data: thread, mutate } = useApi<ThreadPayload>(threadKey);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const save = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch('/api/workout-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({ athleteId, activityId: data.activity?.garminId ?? null, difficulty: effort, feel, pain }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onSaved?.();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await fetch('/api/academy/threads/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({ athleteId, text, workoutDate: date }),
      });
      if (res.ok) {
        setDraft('');
        void mutate();
      }
    } finally {
      setSending(false);
    }
  };

  const messages = thread?.messages ?? [];
  const coachFirst = coachName?.split(' ')[0] ?? null;

  return (
    <FlowOverlay label={t('title')}>
      <FlowScreen
        title={t('title')}
        leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />{t('back')}</BarButton>}
        trailing={<BarButton onClick={onClose}>{t('skip')}</BarButton>}
        className="gap-2.5"
        footer={
          <>
            {failed && <p className="text-center text-[13px] font-bold text-[#8A4308]">{t('saveFailed')}</p>}
            <PrimaryButton onClick={save} busy={busy} disabled={feel == null && effort == null && !pain}>{t('save')}</PrimaryButton>
          </>
        }
      >
        <section className={cn(CARD, 'px-4 py-3.5')}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-extrabold text-ink-900">{t('feel')}</h2>
            {fromWatch && <span className="text-[12.5px] font-bold text-ink-400">{t('fromWatch')}</span>}
          </div>
          <div className="mt-[9px] flex gap-1.5" role="radiogroup" aria-label={t('feel')}>
            {FACES.map((face, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={feel === i}
                onClick={() => setFeel(i)}
                className={cn('min-h-[56px] flex-1 rounded-[14px] pb-1.5 pt-[7px] text-center text-[24px]', feel === i ? 'bg-[#EEF0FF] outline outline-2 outline-brand-600' : 'bg-[#F5F5F8]')}
              >
                <span aria-hidden>{face}</span>
                <small className="mt-px block text-[10.5px] font-bold text-ink-400">{t(`faces.${i}` as never)}</small>
              </button>
            ))}
          </div>

          <div className="mt-[13px] flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-extrabold text-ink-900">{t('effort')}</h2>
            <span className="text-[12.5px] font-bold text-ink-400">{t.rich('effortScale', RICH)}</span>
          </div>
          <div className="mt-[7px] grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={t('effort')}>
            {Array.from({ length: 10 }, (_, k) => k + 1).map(n => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={effort === n}
                onClick={() => setEffort(n)}
                className={cn('h-11 rounded-[10px] text-[13.5px] font-extrabold', effort === n ? 'bg-ink-900 text-white' : 'bg-[#F2F2F6] text-ink-500')}
              >
                <bdi dir="ltr">{n}</bdi>
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink-900">{t('pain')}</h2>
              <p className="text-[12.5px] font-semibold text-ink-400">
                {coachFirst ? t.rich('painSub', { ...RICH, name: coachFirst }) : t('painSubGeneric')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={pain}
              aria-label={t('pain')}
              onClick={() => setPain(p => !p)}
              className="relative -m-1.5 grid h-11 w-[63px] shrink-0 place-items-center"
            >
              <span className={cn('relative block h-[31px] w-[51px] rounded-full transition-colors', pain ? 'bg-[#E8890C]' : 'bg-[#D7D8E0]')}>
                <i className={cn('absolute top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.2)] transition-all', pain ? 'left-0.5' : 'right-0.5')} />
              </span>
            </button>
          </div>
        </section>

        <div className="flex items-baseline justify-between gap-2 px-1">
          <span className="text-[12.5px] font-bold text-ink-400">{t('talk')}</span>
          <Link href={academyThreadUrl({ recipientIsStaff: false, traineeId: athleteId })} className="relative z-10 -my-3 flex min-h-[44px] items-center gap-1 text-[13px] font-extrabold text-brand-600">
            {t('allTalk')} <Chevron />
          </Link>
        </div>

        <div className="flex flex-col gap-[7px]">
          <span className="self-center rounded-full bg-[#EBEBF0] px-2.5 py-1 text-[11.5px] text-ink-400">
            {t.rich('ref', { ...RICH, name: workoutName, day: dayLabel, bdi: () => <StructureText text={workoutName} /> })}
          </span>
          {messages.map(m => {
            if (m.feedback) {
              return (
                <div key={m.id} className="max-w-[92%] self-start">
                  <FeedbackCard
                    feedback={m.feedback.feedback}
                    heading={coachFirst ? t.markup('review', { name: coachFirst, bdi: (c) => c }) : t('reviewHeading')}
                    showSentAt={false}
                    className={cn('bg-[#F2FAF5]', SHADOW)}
                  />
                </div>
              );
            }
            const mine = !!thread?.viewerId && m.authorId === thread.viewerId;
            return (
              <div
                key={m.id}
                className={cn(
                  'max-w-[84%] rounded-[17px] px-3 py-2 text-[14px] leading-[1.45]',
                  mine ? 'self-end bg-brand-600 text-white' : cn('self-start bg-white text-ink-900', SHADOW),
                )}
              >
                {!mine && <span className="mb-px block text-[11px] font-black text-[#0E7A3C]"><bdi>{m.authorName.split(' ')[0]}</bdi></span>}
                <span dir="auto">{m.text}</span>
              </div>
            );
          })}
        </div>

        <form
          onSubmit={e => { e.preventDefault(); void send(); }}
          className={cn('flex h-[52px] items-center gap-2 rounded-full bg-white pe-1 ps-4', SHADOW)}
        >
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={coachFirst ? t.markup('compose', { name: coachFirst, bdi: (c) => c }) : t('composeGeneric')}
            aria-label={t('send')}
            // RTL while empty, so the Hebrew placeholder keeps "ל־Sahar" in order; what is
            // typed then decides for itself.
            dir={draft ? 'auto' : 'rtl'}
            className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-400"
          />
          <button type="submit" disabled={sending || !draft.trim()} aria-label={t('send')} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white disabled:opacity-50">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><path d="M21 4L3 11.5l7 2.5 2.5 7z" fill="#fff" transform="translate(24 0) scale(-1 1)" /></svg>
          </button>
        </form>
      </FlowScreen>
    </FlowOverlay>
  );
}
