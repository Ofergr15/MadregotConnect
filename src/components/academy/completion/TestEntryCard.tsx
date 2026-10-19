'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { TestState } from '@/lib/academy/test-state';
import { hasGoal, type Goal } from '@/lib/academy/goal';
import { measuredText } from '@/lib/academy/test-entry';
import { useViewAsReadOnly } from '@/lib/view-as-person';
import { Chevron } from '@/components/trainee/ui';
import { PrimaryButton } from '../book/ui';
import { sendJson, shortDay } from './shared';
import { TestFields, draftBody, draftHasTest, emptyDraft, type TestDraft } from './TestFields';
import { WatchTestSheet } from './WatchTestSheet';
import { recordedKey, type TestCandidate } from '@/lib/academy/test-finder';
import { GoalSheet, goalSummary } from './GoalSheet';

// ── המתאמן ממלא בעצמו (mockup academy-existing-trainees, phone 4) ───────────────────────
//
// On the trainee's home, in place of the "צריך טסט" line that left them nothing to do: "חסר לנו
// הטסט האחרון שלך", found in the watch or typed, the threshold they will get, and one button that
// sends it to their coach. POST /api/academy/tests stores a trainee's entry as pending whatever
// the body says, so until the coach approves it counts toward nothing and this card says
// "ממתין לאישור". The state is read live (GET /api/academy/tests/entry), so approval removes it.

interface EntryResponse {
  isMember: boolean;
  show: 'missing' | 'pending' | 'none';
  test?: TestState;
  coach?: { name: string } | null;
  goal?: Goal;
  goalsStored?: boolean;
}

const BOX = 'rounded-[22px] bg-white shadow-[0_1px_2px_rgba(20,22,40,.04),0_8px_22px_rgba(20,22,40,.06)]';

/** The card's anchor: the "לבקש מכולם" push opens `?test=entry`, and the home scrolls here. */
export const TEST_ENTRY_ID = 'test-entry';

export function TestEntryCard({ athleteId, onSent, onTyping, raise = false }: {
  athleteId: string;
  onSent?: () => void;
  /**
   * The typed fields opened or closed. The v2 home hides its sticky "לפתוח את האימון" while they
   * are open, so "לשלוח" is the one primary on screen (the mockup's only foot button).
   */
  onTyping?: (open: boolean) => void;
  /** Scroll the card into view once it is drawn (the request push's `?test=entry`). */
  raise?: boolean;
}) {
  const t = useTranslations('completion.self');
  const tg = useTranslations('completion.goal');
  const readOnly = useViewAsReadOnly();
  const { data, mutate } = useApi<EntryResponse>(`/api/academy/tests/entry?athleteId=${encodeURIComponent(athleteId)}`);
  const [mode, setMode] = useState<'closed' | 'type'>('closed');
  const [draft, setDraft] = useState<TestDraft>(emptyDraft);
  const [watchOpen, setWatchOpen] = useState(false);
  // Looked up as soon as the card shows (migration plan, gap 3): a trainee who just connected a
  // watch sees "we found a run that looks like your test" instead of having to think of
  // searching. Same key as WatchTestSheet's read, so opening the sheet is instant.
  const { data: found } = useApi<{ candidates?: Array<{ date: string; protocol: string; paceSec: number; name: string }>; recorded?: string[] }>(
    athleteId ? `/api/academy/tests/watch?athleteId=${encodeURIComponent(athleteId)}` : null,
  );
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const shown = !!data?.isMember && data.show !== 'none';
  const typing = shown && data?.show === 'missing' && mode === 'type';
  useEffect(() => { onTyping?.(typing); }, [typing, onTyping]);
  const raised = useRef(false);
  useEffect(() => {
    if (!raise || !shown || raised.current) return;
    raised.current = true;
    boxRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [raise, shown]);

  if (!shown || !data) return null;
  const coach = data.coach?.name.split(' ')[0] ?? null;
  const m = (c: React.ReactNode) => <bdi dir="ltr">{c}</bdi>;
  const bdi = (c: React.ReactNode) => <bdi>{c}</bdi>;

  if (data.show === 'pending' && data.test?.kind === 'pending') {
    return (
      <div ref={boxRef} id={TEST_ENTRY_ID} className={cn(BOX, 'flex min-h-[56px] items-center gap-[11px] px-3.5 py-2.5')} role="status">
        <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">⏳</span>
        <span className="min-w-0 flex-1">
          <b className="block text-[14.5px] font-extrabold text-ink-900">{t.rich('pendingTitle', { date: shortDay(data.test.date), m })}</b>
          <small className="mt-px block text-[12.5px] leading-snug text-ink-400">
            {coach ? t.rich('pendingSub', { name: coach, bdi }) : t('pendingSubCoach')}
          </small>
        </span>
      </div>
    );
  }

  const old = data.test?.kind === 'ok' && data.test.old;
  const send = async () => {
    const body = draftBody(draft, athleteId);
    if (!body) return;
    setBusy(true); setError(null);
    try {
      // The one test only: the older watch runs are the staff form's (WatchTestSheet allowOlder),
      // or each would be one more card waiting in the coach's "מחכה לך".
      await sendJson('POST', '/api/academy/tests', body);
      setMode('closed');
      setDraft(emptyDraft());
      await mutate();
      onSent?.();
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 409 ? t('exists') : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const saveGoal = async (goal: Goal) => {
    setGoalBusy(true); setGoalError(null);
    try {
      await sendJson('PUT', '/api/academy/goal', { athleteId, ...goal });
      setGoalOpen(false);
      await mutate();
    } catch (e) {
      setGoalError((e as { status?: number }).status === 503 ? t('goalNotSetUp') : t('error'));
    } finally {
      setGoalBusy(false);
    }
  };

  const goal = data.goal;
  const goalText = goal ? goalSummary(goal, (g) => tg(`types.${g}`)) : null;
  const best = found?.candidates?.find((c) => !(found.recorded ?? []).includes(recordedKey(c as Pick<TestCandidate, 'date' | 'protocol'>))) ?? null;

  return (
    <div ref={boxRef} id={TEST_ENTRY_ID} className="scroll-mt-3 space-y-2.5">
      <section className={cn(BOX, 'border-2 border-brand-600 px-4 py-[15px]')}>
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-[26px] leading-none">🎯</span>
          <span className="min-w-0 flex-1">
            <h2 className="text-[19px] font-black leading-tight text-ink-900">{old ? t('titleOld') : data.test?.kind === 'none' ? t('titleNone') : t('title')}</h2>
            <p className="mt-1 text-[14.5px] leading-snug text-ink-500">
              {old ? t('subOld') : data.test?.kind === 'otherProtocol' ? t.rich('subOther', { m }) : data.test?.kind === 'none' ? t.rich('subNone', { m }) : t.rich('sub', { m })}
            </p>
          </span>
        </div>
        {best && data.show === 'missing' && (
          <p className="mt-2.5 rounded-xl bg-brand-600/[0.06] px-3 py-2 text-[13.5px] font-bold leading-snug text-brand-600">
            {t.rich('foundRun', { date: () => <bdi dir="ltr">{`${Number(best.date.slice(8, 10))}.${Number(best.date.slice(5, 7))}`}</bdi>, pace: () => <bdi dir="ltr">{`${Math.floor(best.paceSec / 60)}:${String(Math.round(best.paceSec % 60)).padStart(2, '0')}`}</bdi> })}
          </p>
        )}
        <div className="mt-3 flex gap-2.5">
          <button type="button" onClick={() => setWatchOpen(true)} disabled={readOnly}
            className="flex h-[52px] flex-1 items-center justify-center gap-1.5 rounded-[15px] bg-brand-600 text-[16px] font-extrabold text-white disabled:opacity-50">
            <span aria-hidden>⌚</span> {best && data.show === 'missing' ? t('checkRun') : t('find')}
          </button>
          <button type="button" onClick={() => setMode(mode === 'type' ? 'closed' : 'type')} aria-expanded={mode === 'type'} disabled={readOnly}
            className={cn(BOX, 'flex h-[52px] flex-1 items-center justify-center text-[16px] font-extrabold text-brand-600 disabled:opacity-50')}>
            {t('type')}
          </button>
        </div>
      </section>

      {mode === 'type' && (
        <>
          <TestFields draft={draft} onChange={setDraft} self sendTo={coach} />
          <button type="button" onClick={() => setGoalOpen(true)} disabled={readOnly || data.goalsStored === false}
            className={cn(BOX, 'flex min-h-[64px] w-full items-center gap-3 px-4 py-2.5 text-start disabled:opacity-60')}>
            <span aria-hidden className="text-[22px]">🏁</span>
            <span className="min-w-0 flex-1">
              <b className="block text-[16px] font-extrabold text-ink-900">{t('goalTitle')}</b>
              <small className="mt-0.5 block truncate text-[13.5px] text-ink-400">{goal && hasGoal(goal) && goalText ? <bdi>{goalText}</bdi> : t('goalSub')}</small>
            </span>
            <span className="shrink-0 text-[15px] font-extrabold text-brand-600">
              {goal && hasGoal(goal) ? t('goalEdit') : t('goalAdd')} <Chevron className="h-[11px] w-[7px]" />
            </span>
          </button>
          {!draft.date && draft.measured && <p className="-mt-1 px-1 text-[13px] font-bold text-[#A8510A]">{t('dateFirst')}</p>}
          <PrimaryButton className="w-full" onClick={() => void send()} busy={busy} disabled={readOnly || !draftHasTest(draft)}>
            <span>{coach ? t.rich('send', { name: coach, bdi }) : t('sendCoach')}</span>
          </PrimaryButton>
        </>
      )}
      {error && <p className="px-1 text-[14px] font-bold text-accent-red-ink" role="alert">{error}</p>}

      <WatchTestSheet
        athleteId={athleteId}
        open={watchOpen}
        onOpenChange={setWatchOpen}
        onPick={(c) => {
          setDraft({ protocol: c.protocol, date: c.date, measured: measuredText(c), avgHr: c.avgHr ? String(c.avgHr) : '', activityId: c.activityId, older: [] });
          setMode('type');
        }}
        onType={() => { setMode('type'); focusMeasured(); }}
      />
      {goal && (
        <GoalSheet open={goalOpen} onOpenChange={setGoalOpen} goal={goal} busy={goalBusy} error={goalError} athleteId={athleteId} onDone={(g) => void saveGoal(g)} />
      )}
    </div>
  );
}

/** After the watch sheet closes on "להקליד": the measured field, once the fields are drawn. */
export function focusMeasured() {
  setTimeout(() => document.getElementById('test-measured')?.focus(), 350);
}
