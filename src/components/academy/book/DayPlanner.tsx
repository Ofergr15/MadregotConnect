'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { academyTestUrl } from '@/lib/academy/deep-links';
import {
  bookTotals, effortPace, fromLibrarySteps, guessKind, mainStepIndex, profileBar, toLibrarySteps,
  type BookStep,
} from '@/lib/academy/book-steps';
import type { LibraryEntry } from '@/lib/academy/library';
import type { SeniorWorkout } from '@/lib/academy/senior-pick';
import { BarButton, CARD, FlowOverlay, FlowScreen, N, PrimaryButton, ProfileBar, RICH, SectionLabel, clockText, kmText } from './ui';
import { BookPicker } from './BookPicker';
import { AdjustScreen } from './AdjustScreen';
import { QuickTextScreen } from './QuickTextScreen';
import { SendScreen } from './SendScreen';
import type { DayPlanData, Draft, SendResult } from './types';

// ── "מה ירוץ בשלישי?" — one trainee, one day (mockup phones 1 → 3) ───────────────────────
//
// The whole flow, as one full-screen overlay: choose (the senior groups' session first,
// large), or take one from the book, or type it; adjust on one screen; send. The common
// path is two taps — "לקחת את זה", then the send screen's "סיום" — and everything else is
// there when it is needed and out of the way when it is not.
//
// Every number is the TRAINEE's: the senior session arrives relative to its lane's
// reference threshold and is drawn at this trainee's own (see senior-pick.ts). A trainee
// with no test gets no invented pace: the screen says so, names the fix, and the send is
// blocked — TrainingPeaks' rule, and this app's since library.ts.

type Screen = 'choose' | 'book' | 'adjust' | 'quick' | 'send';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function draftFromSenior(w: SeniorWorkout): Draft {
  return {
    source: 'senior',
    name: w.name,
    notes: w.notes,
    entryId: null,
    kind: guessKind(w.model ?? [], w.clubName),
    original: w.model,
    model: w.model,
    steps: w.steps,
  };
}

export function draftFromEntry(entry: LibraryEntry): Draft {
  const model = fromLibrarySteps(entry.steps);
  return {
    source: 'book', name: entry.name, notes: entry.notes, entryId: entry.id, kind: entry.kind,
    original: model, model, steps: entry.steps,
  };
}

/** The steps a draft will send: the model when there is one, the stored shape otherwise. */
export function draftSteps(draft: Draft) {
  return draft.model ? toLibrarySteps(draft.model) : draft.steps;
}

/** "החזרות ב־4:05" — the one pace that says what the session is. */
export function mainPace(model: BookStep[] | null, thresholdSec: number | null): { sec: number; reps: boolean } | null {
  if (!model || !thresholdSec) return null;
  const i = mainStepIndex(model);
  const step = model[i];
  if (!step || (step.kind !== 'reps' && step.kind !== 'run') || !step.effort) return null;
  return { sec: effortPace(step.effort, thresholdSec), reps: step.kind === 'reps' };
}

export function DayPlanner({ athleteId, date, onClose, onDone }: {
  athleteId: string;
  date: string;
  onClose: () => void;
  /** After a successful send, so the caller can refetch the week. */
  onDone?: () => void;
}) {
  const t = useTranslations('workoutBook');
  const { data, error } = useApi<DayPlanData>(
    `/api/academy/day-plan?athleteId=${encodeURIComponent(athleteId)}&date=${date}`,
    { keepPreviousData: true },
  );
  const [screen, setScreen] = useState<Screen>('choose');
  const [back, setBack] = useState<Screen>('choose');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [primary, setPrimary] = useState<SendResult | null>(null);

  const go = (next: Screen) => { setBack(screen); setScreen(next); };

  const send = async (d: Draft) => {
    if (!data) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch('/api/academy/day-plan', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({
          date,
          recipients: [athleteId],
          workout: { name: d.name, notes: d.notes, steps: draftSteps(d) },
          entryId: d.entryId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      const result = (body?.results as SendResult[] | undefined)?.find(r => r.athleteId === athleteId) ?? null;
      if (!res.ok || !result || result.status === 'skipped' || result.status === 'failed') {
        setSendError(result?.reason === 'push-failed' ? t('error.push') : t('error.send'));
        // A failed push still saved the plan; the send screen says which.
        if (result?.status === 'failed' && result.reason === 'push-failed') {
          setPrimary(result);
          setDraft(d);
          go('send');
        }
        return;
      }
      setPrimary(result);
      setDraft(d);
      onDone?.();
      go('send');
    } catch {
      setSendError(t('error.send'));
    } finally {
      setSending(false);
    }
  };

  const label = t('flowLabel');
  if (!data) {
    return (
      <FlowOverlay label={label}>
        <FlowScreen title={t('loading')} leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />{t('back.week')}</BarButton>}>
          <p className="py-10 text-center text-sm text-ink-400">{error ? t('error.load') : t('loading')}</p>
        </FlowScreen>
      </FlowOverlay>
    );
  }

  const T = data.trainee.thresholdSec;
  const day = t(`day.${WEEKDAY_KEYS[data.dayOfWeek]}`);
  const [, mm, dd] = date.split('-');
  const dayTitle = `${day} ${Number(dd)}.${Number(mm)}`;

  return (
    <FlowOverlay label={label}>
      {screen === 'choose' && (
        <ChooseScreen
          data={data}
          day={day}
          dayTitle={dayTitle}
          sending={sending}
          sendError={sendError}
          onClose={onClose}
          onTake={w => void send(draftFromSenior(w))}
          onAdjust={w => { setDraft(draftFromSenior(w)); go('adjust'); }}
          onBook={() => go('book')}
          onQuick={() => go('quick')}
        />
      )}
      {screen === 'book' && (
        <BookPicker
          thresholdSec={T}
          onBack={() => setScreen('choose')}
          onPick={entry => { setDraft(draftFromEntry(entry)); go('adjust'); }}
        />
      )}
      {screen === 'quick' && (
        <QuickTextScreen
          traineeName={data.trainee.name}
          thresholdSec={T}
          onCancel={() => setScreen('choose')}
          onContinue={d => { setDraft(d); go('adjust'); }}
        />
      )}
      {screen === 'adjust' && draft && (
        <AdjustScreen
          draft={draft}
          thresholdSec={T}
          traineeName={data.trainee.name}
          dayLabel={day}
          sending={sending}
          sendError={sendError}
          onCancel={() => { setSendError(null); setScreen(back === 'adjust' ? 'choose' : back); }}
          onChange={setDraft}
          onSend={d => void send(d)}
        />
      )}
      {screen === 'send' && draft && primary && (
        <SendScreen
          data={data}
          draft={draft}
          day={day}
          primary={primary}
          onBack={() => setScreen('adjust')}
          onClose={() => { onDone?.(); onClose(); }}
        />
      )}
    </FlowOverlay>
  );
}

function ChooseScreen({
  data, day, dayTitle, sending, sendError, onClose, onTake, onAdjust, onBook, onQuick,
}: {
  data: DayPlanData;
  day: string;
  dayTitle: string;
  sending: boolean;
  sendError: string | null;
  onClose: () => void;
  onTake: (w: SeniorWorkout) => void;
  onAdjust: (w: SeniorWorkout) => void;
  onBook: () => void;
  onQuick: () => void;
}) {
  const t = useTranslations('workoutBook');
  const T = data.trainee.thresholdSec;
  const today = data.senior.today;
  const name = data.trainee.name;
  const first = name.split(' ')[0] || name;
  const totals = useMemo(() => (today?.model ? bookTotals(today.model, T) : null), [today, T]);
  const bar = useMemo(() => (today?.model ? profileBar(today.model, T) : []), [today, T]);
  const pace = mainPace(today?.model ?? null, T);
  const existing = data.existing[0];

  return (
    <FlowScreen
      title={dayTitle}
      leading={<BarButton onClick={onClose}><ChevronRight className="h-5 w-5" />{t('back.week')}</BarButton>}
    >
      <div>
        <p className="text-13 font-bold text-ink-400">
          <bdi>{name}</bdi>
          {data.trainee.bandNumber !== null && <> · {t('band', { n: data.trainee.bandNumber })}</>}
        </p>
        <h2 className="text-28 font-black leading-tight text-ink-900">{t('whatRuns', { day })}</h2>
        {existing && <p className="mt-1 text-13 text-ink-400">{t.rich('alreadyHas', { ...RICH, name: existing.name })}</p>}
      </div>

      {!T && (
        <div className="rounded-[14px] bg-[#FDF0E2] px-3 py-2.5 text-sm font-bold leading-snug text-[#8A4308]">
          {t('noTest', { name })}{' '}
          <Link href={academyTestUrl({ recipientIsStaff: true })} className="underline">{t('setTest')}</Link>
        </div>
      )}

      {today ? (
        <>
          <div className={cn(CARD, 'border-2 border-brand-600 px-[18px] pb-[18px] pt-5')}>
            {/* No lane picker here: the lane only picks which squad's version of the session
                to start from, and once its paces are restated against that squad's reference
                the three versions are the same session at this trainee's pace. The route still
                takes `?lane=` for a coach who wants another squad's version. */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF0FF] px-[11px] py-[5px] text-13 font-extrabold text-brand-600">
              ★ {t('seniorRan', { day })}
            </span>
            <button type="button" onClick={() => onAdjust(today)} className="mt-3 block w-full text-start">
              <span className="block text-[32px] font-black leading-tight text-ink-900"><bdi>{today.name}</bdi></span>
              {totals && (
                <span className="mt-1 block text-[16px] text-ink-500">
                  {t.rich('volume', { ...RICH, km: kmText(totals.distanceM), min: Math.round(totals.durationSec / 60) })}
                </span>
              )}
            </button>
            {bar.length > 0 && <ProfileBar segments={bar} className="mt-4" />}
            {pace && (
              <p className="mt-3.5 text-[15.5px] leading-normal text-ink-500">
                {t.rich(pace.reps ? 'paceLineReps' : 'paceLineRun', { ...RICH, pace: clockText(pace.sec), name: first })}
              </p>
            )}
          </div>
          {sendError && <p className="text-center text-sm font-bold text-accent-red-ink">{sendError}</p>}
          <PrimaryButton onClick={() => onTake(today)} disabled={!T || !today.model && !today.steps.length} busy={sending}>
            {t('take')}
          </PrimaryButton>
        </>
      ) : (
        <div className={cn(CARD, 'px-[18px] py-5 text-center')}>
          <p className="text-[17px] font-extrabold text-ink-900">{data.hasClubWeek ? t('seniorRests', { day }) : t('noClubWeek')}</p>
          <p className="mt-1 text-sm text-ink-400">{t('seniorRestsHint')}</p>
        </div>
      )}

      <div className="flex gap-2.5">
        <PrimaryButton secondary onClick={onBook} className="h-[50px] flex-1 text-[15.5px]">📖 {t('fromBook')}</PrimaryButton>
        <PrimaryButton secondary onClick={onQuick} className="h-[50px] flex-1 text-[15.5px]">✎ {t('writeQuick')}</PrimaryButton>
      </div>

      {data.senior.others.length > 0 && (
        <>
          <SectionLabel>{t('moreFromSenior')}</SectionLabel>
          <div className={CARD}>
            {data.senior.others.map(w => <OtherRow key={w.dayOfWeek} w={w} thresholdSec={T} onPick={() => onAdjust(w)} />)}
          </div>
        </>
      )}
    </FlowScreen>
  );
}

function OtherRow({ w, thresholdSec, onPick }: { w: SeniorWorkout; thresholdSec: number | null; onPick: () => void }) {
  const t = useTranslations('workoutBook');
  const totals = w.model ? bookTotals(w.model, thresholdSec) : null;
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex min-h-[64px] w-full items-center gap-3 border-b border-[#EFEFF4] px-[18px] py-3.5 text-start last:border-0"
    >
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[17px] font-extrabold text-ink-900"><bdi>{w.name}</bdi></b>
        <small className="mt-0.5 block text-[13.5px] text-ink-400">
          {t(`day.${WEEKDAY_KEYS[w.dayOfWeek]}`)}
          {totals ? <> · {t.rich('kmOnly', { ...RICH, km: kmText(totals.distanceM) })}</> : null}
        </small>
      </span>
      {w.model && <ProfileBar segments={profileBar(w.model, thresholdSec)} size="sm" />}
    </button>
  );
}
