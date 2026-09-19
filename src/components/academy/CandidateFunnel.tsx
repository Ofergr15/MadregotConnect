'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ClipboardList, Plus, RotateCcw, Undo2, UserPlus } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EmptyState, LoadingBlock, SegmentedControl, Sheet } from '@/components/ui';
import {
  buildFunnel,
  candidateTimeline,
  type CandidateEvent,
  type CandidateRow,
  type FunnelBoard,
  type FunnelCandidate,
  type StageOwner,
  type TimelineStep,
} from '@/lib/academy/funnel';
import type { Characterization } from '@/lib/academy/characterization';
import { CharacterizationSheet } from './CharacterizationForm';
import { initialsOf } from './types';

// ── The candidates board ─────────────────────────────────────────────────────
//
// One question, answered at a glance: WHO IS STUCK, AND WITH WHOM. Today that
// answer lives in one person's memory and in WhatsApp history, which is why the
// two places candidates are actually lost — the characterization call nobody
// scheduled, and the 30-minute test nobody ran — are invisible until somebody
// happens to remember a name.
//
// Three things about the shape of this screen, all of them load-bearing:
//
//  * **A section per stage, and the empty ones stay.** An empty `ממתין לטסט` is
//    information — it is the shape of the funnel — and sections that appear and
//    vanish as people move cannot be read at a glance twice. The mockup's
//    horizontal kanban became vertical sections for the same reason every other
//    board in this app did: on a 375 px phone a column you have to scroll
//    sideways to reach is a column nobody reads.
//
//  * **One red thing.** `stuck` is the only alarm colour, and it is per-stage:
//    four days of silence is negligence while waiting for a phone call and
//    perfectly normal while waiting for somebody to find a morning for a test.
//    A board where everybody old is red stops being read by week three.
//
//  * **The owner is on the section header, not the card.** Four people are
//    responsible for different steps, and the useful reading is "these six are
//    mine" — not six cards each restating a name. `trainee` says `אצל המתאמן`,
//    because a board that files "he has not run the test yet" under the coach's
//    tasks tells the coach to chase himself.
//
// All the arithmetic is in `lib/academy/funnel.ts`, tested, and this file does
// none of it: the board is `buildFunnel(rows, now)` and the card is
// `candidateTimeline(row)`. `now` is taken in the browser on purpose — the number
// on every card is "days waiting", which is relative to the reader's own today,
// and a server-side count would show an Israeli coach yesterday's number at 00:30.

interface FunnelResponse {
  candidates: (CandidateRow & { email?: string | null; phone?: string | null })[];
  events: CandidateEvent[];
  tableMissing?: boolean;
}

/**
 * `busy` is one key, because only one request at a time is in flight and the spinner belongs on
 * the control that was tapped. Stages fill that slot by their own key, so leaving and coming
 * back need keys no stage can ever be: the leading underscores are what guarantee that, since
 * every real stage key is a bare word from `STAGES`.
 */
const ARCHIVE = '__archive';
const RESTORE = '__restore';

/** Who to chase. A role, because staffing changes without the funnel changing. */
const OWNER_LABEL: Record<StageOwner, string> = {
  manager: 'יוסי',
  coach: 'אופר',
  trainee: 'אצל המתאמן',
};

/** `2026-09-14` / ISO → `14.09`. */
function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

/**
 * How long they have been waiting, in the words a person would use.
 *
 * `0` is `היום` and not `0 ימים`: a candidate somebody spoke to this morning is
 * the one row on the board that needs no action, and a zero next to a unit reads
 * as a measurement that failed.
 */
function waitLabel(days: number): string {
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  return `${days} ימים בשלב`;
}

// ── One card ─────────────────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  onOpen,
}: {
  candidate: FunnelCandidate;
  onOpen: (id: string) => void;
}) {
  // Source and goal are half of what tells the coach who this person is, and the
  // wait is the other half. All three on one line, because the card's whole job
  // is to be skimmed.
  const facts = [candidate.source === 'form' ? 'טופס' : 'אינסטגרם', candidate.goal].filter(Boolean);

  return (
    <button
      type="button"
      onClick={() => onOpen(candidate.id)}
      className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-right active:bg-page/60"
    >
      <span className={cn(
        'shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-2xs font-bold',
        candidate.stuck ? 'bg-accent-red/10 text-accent-red' : 'bg-page text-ink-500',
      )}>
        {initialsOf(candidate.name)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium text-ink-900 truncate" dir="auto">{candidate.name}</span>
        <span className="block text-xs text-ink-400 truncate" dir="auto">
          {facts.join(' · ')}
          {facts.length > 0 && ' · '}
          {/* NOT wrapped in `<bdi dir="ltr">`. It was, and it rendered `6 ימים בשלב`
              as `ימים בשלב 6` — forcing LTR on a phrase that BEGINS with a number
              lays the number out at the left end, which in an RTL line is last.
              A bdi belongs around a bare number or a date, never around Hebrew. */}
          {waitLabel(candidate.daysWaiting)}
        </span>
      </span>
      {candidate.stuck && (
        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-accent-red/10 px-2 py-0.5 text-2xs font-bold text-accent-red">
          <AlertTriangle className="h-3 w-3" />
          תקוע
        </span>
      )}
      <ChevronLeft className="shrink-0 h-4 w-4 text-ink-400" />
    </button>
  );
}

// ── The board ────────────────────────────────────────────────────────────────

export function FunnelBoardView({
  board,
  onOpen,
  onAdd,
}: {
  board: FunnelBoard;
  onOpen: (id: string) => void;
  onAdd?: () => void;
}) {
  // Collapsed by default, and nothing about it is coloured. The people who left are the one
  // group on this screen that needs no action, so they are reachable and quiet — but they must
  // be REACHABLE, because archiving is reversible and a count with no rows behind it is a
  // dead end: somebody who said no in March and came back in September would have to be typed
  // in again, losing the four steps they already did.
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div>
      <div className="flex items-baseline justify-between px-1 pb-3">
        <div className="flex items-baseline gap-3">
          {/* A Hebrew count agrees with its number, and every one of these three counters
              spends most of its life at 1 — a board with a single candidate would have read
              `1 מועמדים`, `1 תקועים`, `1 יצאו`, which is the kind of mistake that makes a
              screen look machine-written. One is spelled out and the verb goes singular; from
              two up the digit is what somebody is actually reading off the board. Same
              judgement as `waitLabel`, where 0 and 1 are words rather than numbers. */}
          <span className="text-[15px] font-bold text-ink-900">
            {board.live === 1
              ? 'מועמד אחד'
              : <><bdi dir="ltr">{board.live}</bdi> מועמדים</>}
          </span>
          {/* The second number is the whole point of the screen, so it is the
              only coloured thing in the header — and it disappears entirely when
              it is zero rather than rendering a grey `0 תקועים`, which reads as
              a broken counter on the one day the board is clean. */}
          {board.stuck > 0 && (
            <span className="text-[15px] font-bold text-accent-red">
              {board.stuck === 1
                ? 'אחד תקוע'
                : <><bdi dir="ltr">{board.stuck}</bdi> תקועים</>}
            </span>
          )}
        </div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs font-medium text-brand-600"
          >
            <Plus className="h-4 w-4" />
            מועמד חדש
          </button>
        )}
      </div>

      {board.live === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="אין מועמדים בתהליך"
          description="כל מי שפונה מאינסטגרם או ממלא טופס הרשמה יופיע כאן עד שהוא מתחיל להתאמן."
        />
      ) : null}

      {board.live > 0 && (
        <div className="space-y-5">
          {board.columns.map(column => (
            <div key={column.spec.key}>
              <p className="px-4 mb-1.5 text-2xs font-bold uppercase tracking-wider text-ink-400">
                {column.spec.waiting}
                <span className="font-normal normal-case"> · {OWNER_LABEL[column.spec.owner]}</span>
              </p>
              {column.candidates.length === 0 ? (
                // An empty stage stays on the screen, and says so in words. A
                // dash here would read as a value that failed to load.
                <div className="rounded-card bg-card px-4 py-3 text-xs text-ink-400">אין אף אחד</div>
              ) : (
                <div className="overflow-hidden rounded-card bg-card divide-y divide-page">
                  {column.candidates.map(candidate => (
                    <CandidateCard key={candidate.id} candidate={candidate} onOpen={onOpen} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {board.archived > 0 && (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            aria-expanded={showArchived}
            // 48 and not 44. At exactly 44 the audit probed the vertical reach as 41.5 —
            // the top 1.5px of the row does not answer a tap, which on a target sized to
            // the floor puts it under the floor. A full-width disclosure row is an iOS
            // list row, and 48 is what that is elsewhere in the app.
            className="flex w-full items-center gap-1.5 min-h-[48px] px-4 text-2xs font-bold uppercase tracking-wider text-ink-400"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !showArchived && 'ltr:-rotate-90 rtl:rotate-90')} />
            {board.archived === 1
              ? 'אחד יצא מהתהליך'
              : <><bdi dir="ltr">{board.archived}</bdi> יצאו מהתהליך</>}
          </button>
          {showArchived && (
            <div className="overflow-hidden rounded-card bg-card divide-y divide-page">
              {board.archivedCandidates.map(candidate => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onOpen(candidate.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-right active:bg-page/60"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink-500 truncate" dir="auto">{candidate.name}</span>
                    {/* The reason, not the date: "why is he not on the board" is the
                        question this row exists to answer, and a date answers it only
                        for whoever already remembers the conversation. */}
                    {candidate.archivedReason && (
                      <span className="block text-xs text-ink-400 truncate" dir="auto">{candidate.archivedReason}</span>
                    )}
                  </span>
                  <ChevronLeft className="shrink-0 h-4 w-4 text-ink-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── One candidate's card ─────────────────────────────────────────────────────

/**
 * All nine steps, done or not, in order.
 *
 * Every stage is listed whether or not it happened, because the card's promise is
 * that no step disappears — which is also what lets it become the trainee's own
 * history once they join, with no "starting over". A card listing only completed
 * steps would answer "what happened" and not "what is left", and the second
 * question is the one somebody opens this for.
 */
export function CandidateTimelineView({
  steps,
  onStep,
  onUnstep,
  busy,
}: {
  steps: TimelineStep[];
  onStep?: (stage: string) => void;
  onUnstep?: (stage: string) => void;
  busy?: string | null;
}) {
  // Undo is offered on the LAST completed step and nowhere else.
  //
  // The correction a person actually makes is "I just ticked that by mistake". An
  // undo on every green step invites un-ticking step one while steps two to five
  // stand, and that produces exactly the history nobody performed that the board
  // is built to refuse — the funnel reads the first MISSING step as the current
  // one, so the candidate would jump back five sections while their later steps
  // sit above the gap. Fixing a genuinely wrong middle step means un-ticking down
  // to it, which is slower on purpose.
  const lastDone = steps.reduce((found, step, index) => (step.at ? index : found), -1);

  return (
    <ol className="space-y-0">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const state = step.at ? 'done' : step.current ? 'current' : 'todo';
        return (
          <li key={step.spec.key} className="flex gap-3">
            {/* The rail. The line is on the bullet's column and stops at the last
                step, so the timeline reads as finite — a rail running past the
                final step suggests something below it. */}
            <div className="shrink-0 flex flex-col items-center pt-1">
              <span className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center',
                state === 'done' && 'bg-accent-700 text-white',
                state === 'current' && 'border-2 border-brand-600 bg-card',
                state === 'todo' && 'border border-ink-400/40 bg-card',
              )}>
                {state === 'done' && <Check className="h-3 w-3" strokeWidth={3} />}
                {state === 'current' && <span className="w-1.5 h-1.5 rounded-full bg-brand-600" />}
              </span>
              {!last && <span className={cn('w-px flex-1 min-h-[18px]', step.at ? 'bg-accent-700/40' : 'bg-ink-400/20')} />}
            </div>

            <div className={cn('flex-1 min-w-0 pb-3', last && 'pb-0')}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-[15px] leading-snug',
                    state === 'todo' ? 'text-ink-400' : 'font-medium text-ink-900',
                  )} dir="auto">
                    {step.spec.done}
                  </p>
                  {step.at ? (
                    <p className="text-xs text-ink-400" dir="auto">
                      <bdi dir="ltr">{shortDate(step.at)}</bdi>
                      {step.recordedBy && ` · ${step.recordedBy}`}
                    </p>
                  ) : step.current ? (
                    <p className="text-xs text-brand-600">
                      מחכה ל{OWNER_LABEL[step.spec.owner] === 'אצל המתאמן' ? 'מתאמן' : OWNER_LABEL[step.spec.owner]}
                    </p>
                  ) : null}
                  {/* The one free-text field in the funnel: the sentence a human
                      wants to read three weeks later. Never truncated — a note
                      cut off mid-word is worse than no note. */}
                  {step.note && (
                    <p className="mt-1 rounded-lg bg-page px-2.5 py-1.5 text-xs leading-relaxed text-ink-700" dir="auto">
                      {step.note}
                    </p>
                  )}
                </div>

                {step.at
                  ? onUnstep && index === lastDone && (
                      <button
                        type="button"
                        aria-label={`בטל את ${step.spec.done}`}
                        onClick={() => onUnstep(step.spec.key)}
                        disabled={busy === step.spec.key}
                        className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 disabled:opacity-40"
                      >
                        <Undo2 className="h-4 w-4" />
                      </button>
                    )
                  : step.current && onStep && (
                      // Only the OPEN step can be ticked. Ticking step seven
                      // while four is missing produces a history nobody
                      // performed, and the funnel reads the first missing step
                      // as the current one — so the board would not move.
                      <button
                        type="button"
                        onClick={() => onStep(step.spec.key)}
                        disabled={busy === step.spec.key}
                        // `h-11 self-start` and not `min-h-[44px]`: a min-height on a
                        // `rounded-full` element inside a flex row stretched to the
                        // whole row's height and rendered as a 90 px green circle.
                        className="shrink-0 self-start h-11 rounded-full bg-accent-700 px-4 text-xs font-bold text-white disabled:opacity-50"
                      >
                        בוצע
                      </button>
                    )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function CandidateSheet({
  candidate,
  events,
  open,
  onOpenChange,
  onStep,
  onUnstep,
  onArchive,
  onRestore,
  onCharacterize,
  characterizationState = 'empty',
  busy,
}: {
  candidate: (CandidateRow & { email?: string | null; phone?: string | null }) | null;
  events: CandidateEvent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStep?: (stage: string) => void;
  onUnstep?: (stage: string) => void;
  onArchive?: (reason: string) => void;
  onRestore?: () => void;
  /** Opens the characterization form (funnel step 3), which is the one step with answers. */
  onCharacterize?: () => void;
  /**
   * Whether those answers exist yet, because an empty form and a filled one are the difference
   * between "have the call" and "look at what he said".
   *
   * `error` is its own state and not a silently empty form: the save is a PUT of the whole
   * form, so a blank form opened over answers nobody could read would erase them on the first
   * keystroke. When the read failed, the row says so and does not open.
   */
  characterizationState?: 'loading' | 'empty' | 'filled' | 'error';
  busy?: string | null;
}) {
  const steps = useMemo(
    () => (candidate ? candidateTimeline(candidate, events) : []),
    [candidate, events],
  );

  // The reason lives in the same sheet rather than in a ConfirmSheet on top of it. Two stacked
  // drawers is the wrong shape for this anyway: a `ConfirmSheet` has one verb and no field, and
  // the field is the point — "he said no in September" is the answer to why somebody is not on
  // the board, and a confirm dialog can only collect the fact that he is gone.
  const [leaving, setLeaving] = useState(false);
  const [reason, setReason] = useState('');

  // A fresh card must not inherit the previous one's half-typed reason, and reopening the same
  // card should start closed — `candidate.id` covers both, since the sheet stays mounted.
  const candidateId = candidate?.id ?? null;
  useEffect(() => { setLeaving(false); setReason(''); }, [candidateId]);

  if (!candidate) return null;

  // Contact details are here and only here. They are not on the board and not in
  // `CandidateRow`: a list of strangers' phone numbers is exactly the screenshot
  // nobody should be able to take, and reaching one person costs a tap.
  const contact = [candidate.phone, candidate.email].filter(Boolean);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={candidate.name}>
      <div className="px-4 pb-6">
        <p className="text-xs text-ink-400" dir="auto">
          {candidate.source === 'form' ? 'טופס הרשמה' : 'אינסטגרם'}
          {candidate.goal && ` · ${candidate.goal}`}
        </p>
        {contact.length > 0 && (
          <p className="mt-1 text-xs text-ink-500" dir="auto">
            <bdi dir="ltr">{contact.join(' · ')}</bdi>
          </p>
        )}

        {candidate.archivedAt && (
          // Archived is not deleted, and the reason is the answer to "why is he
          // not on the board" — so it is the first thing the card says.
          <div className="mt-3 rounded-card bg-page px-3 py-2.5 text-xs text-ink-700" dir="auto">
            יצא מהתהליך <bdi dir="ltr">{shortDate(candidate.archivedAt)}</bdi>
            {candidate.archivedReason && ` · ${candidate.archivedReason}`}
          </div>
        )}

        <div className="mt-4">
          <CandidateTimelineView
            steps={steps}
            onStep={candidate.archivedAt ? undefined : onStep}
            onUnstep={candidate.archivedAt ? undefined : onUnstep}
            busy={busy}
          />
        </div>

        {/* The characterization form. One step out of the nine has ANSWERS behind it — what he
            wants, which mornings he has, what hurts — and they are the input to the first
            training plan, so they need a door that is not a tick mark. Below the timeline
            rather than beside the step for the same reason everything else is: the timeline is
            a history, and a form is not a history entry. */}
        {onCharacterize && !candidate.archivedAt && (
          <button
            type="button"
            onClick={onCharacterize}
            disabled={characterizationState === 'loading' || characterizationState === 'error'}
            className="mt-5 flex w-full items-center justify-between gap-2 min-h-[48px] rounded-card bg-page px-3.5 text-sm font-bold text-ink-900 disabled:opacity-60"
          >
            <span className="flex items-center gap-2" dir="auto">
              <ClipboardList className="h-4 w-4 text-ink-500" />
              טופס אפיון
            </span>
            <span
              className={cn(
                'text-xs font-medium',
                characterizationState === 'error' ? 'text-accent-red-ink' : 'text-ink-400',
              )}
              dir="auto"
            >
              {characterizationState === 'loading' ? 'טוען…'
                : characterizationState === 'error' ? 'לא נטען'
                : characterizationState === 'filled' ? 'מולא' : 'ריק'}
            </span>
          </button>
        )}

        {/* Leaving, and coming back. Below the timeline and never beside a step: this is the
            one control on the card that takes somebody off the board, and a red row within a
            thumb's width of the green בוצע button is a mis-tap that hides a live candidate. */}
        {candidate.archivedAt
          ? onRestore && (
              <button
                type="button"
                onClick={onRestore}
                disabled={busy === RESTORE}
                className="mt-5 flex w-full items-center justify-center gap-1.5 min-h-[44px] rounded-card bg-page text-sm font-bold text-ink-700 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                החזרה לתהליך
              </button>
            )
          : onArchive && (
              <div className="mt-5">
                {leaving ? (
                  <div className="rounded-card bg-page p-3">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-ink-500">למה יצא?</span>
                      <input
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="לא חייב — אבל בעוד חצי שנה זו התשובה"
                        className="w-full min-h-[44px] rounded-card bg-card px-3 text-[16px] text-ink-900 placeholder:text-ink-400"
                        dir="auto"
                      />
                    </label>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => onArchive(reason.trim())}
                        disabled={busy === ARCHIVE}
                        className="flex-1 min-h-[44px] rounded-card bg-accent-red text-sm font-bold text-white disabled:opacity-50"
                      >
                        {busy === ARCHIVE ? 'שומר…' : 'הוצאה מהתהליך'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setLeaving(false); setReason(''); }}
                        className="min-h-[44px] rounded-card bg-card px-4 text-sm font-medium text-ink-500"
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLeaving(true)}
                    className="min-h-[44px] w-full text-xs font-medium text-accent-red-ink"
                  >
                    יצא מהתהליך
                  </button>
                )}
              </div>
            )}
      </div>
    </Sheet>
  );
}

// ── Opening a row by hand ────────────────────────────────────────────────────

/**
 * A new candidate, which in practice means an Instagram DM somebody wants to stop holding in
 * their head.
 *
 * Only the name is required. On day one there is often nothing else — no email, no phone, just
 * a handle and a sentence — and a form that demands contact details before it will remember a
 * person is a form that loses the person. The email arrives with the registration form and the
 * phone with the intro call, which is exactly what the funnel's first two steps are.
 */
export function AddCandidateSheet({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves `true` when the row was created; the sheet closes and clears only then. */
  onCreate: (input: { name: string; source: string; goal: string; phone: string; email: string; formFilled: boolean }) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<'instagram' | 'form'>('instagram');
  const [goal, setGoal] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    // `formFilled` is DERIVED from the source and is not a checkbox of its own. "Arrived
    // through the registration form" and "the form is filled in" are one fact, and two
    // controls that have to agree will eventually disagree — at which point a form applicant
    // sits in the `ממתין לטופס הרשמה` column that nobody needs to act on.
    const ok = await onCreate({
      name: trimmed,
      source,
      goal: goal.trim(),
      phone: phone.trim(),
      email: email.trim(),
      formFilled: source === 'form',
    });
    setSaving(false);
    if (!ok) {
      setError('לא הצלחנו לשמור את המועמד');
      return;
    }
    setName(''); setGoal(''); setPhone(''); setEmail(''); setSource('instagram');
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="מועמד חדש">
      <div className="space-y-3 px-4 pb-6">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-ink-500">שם</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="גם שם מאינסטגרם מספיק"
            className={ADD_INPUT}
            dir="auto"
          />
        </label>

        <div>
          <span className="mb-1 block text-[11px] font-semibold text-ink-500">מאיפה הגיע</span>
          <SegmentedControl
            value={source}
            onChange={setSource}
            options={[
              { value: 'instagram', label: 'אינסטגרם' },
              { value: 'form', label: 'טופס הרשמה' },
            ]}
            className="bg-page"
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
            {source === 'form'
              ? 'הטופס נרשם כשלב שבוצע, והוא יופיע כממתין לשיחת היכרות.'
              : 'יופיע כממתין לטופס הרשמה — השלב הראשון בתהליך.'}
          </p>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-ink-500">מטרה</span>
          <input
            value={goal}
            onChange={e => setGoal(e.target.value)}
            placeholder="חצי מרתון, 10 ק״מ…"
            className={ADD_INPUT}
            dir="auto"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-500">טלפון</span>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              type="tel"
              inputMode="tel"
              className={ADD_INPUT}
              dir="ltr"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-500">אימייל</span>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              className={ADD_INPUT}
              dir="ltr"
            />
          </label>
        </div>

        {error && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-accent-red-ink">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={!name.trim() || saving}
          className={cn(
            'min-h-[44px] w-full rounded-card text-sm font-bold',
            name.trim() && !saving ? 'bg-brand-600 text-white' : 'bg-page text-ink-400',
          )}
        >
          {saving ? 'שומר…' : 'הוספה'}
        </button>
      </div>
    </Sheet>
  );
}

// 16px, or iOS Safari zooms the whole page the moment a field takes focus.
const ADD_INPUT =
  'w-full min-h-[44px] rounded-card bg-page px-3 text-[16px] text-ink-900 placeholder:text-ink-400';

// ── The mounted panel ────────────────────────────────────────────────────────

export function CandidateFunnel() {
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The characterization form, and the answers behind it. `undefined` means "not fetched yet"
  // and `null` means "fetched, and nobody has characterised him" — different facts, and the
  // form must not open on an empty shell while the real answers are still in flight.
  const [characterizing, setCharacterizing] = useState(false);
  const [characterization, setCharacterization] = useState<Characterization | null | undefined>(undefined);
  const [charError, setCharError] = useState(false);

  // The reader's own today, read once per load rather than per render: a `now`
  // that changes on every render would make every memo below a lie, and nobody
  // is watching this screen at the instant midnight crosses.
  const [now] = useState(() => new Date().toISOString());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/academy/candidates', { headers: await apiHeaders() });
      if (!res.ok) {
        setError('לא הצלחנו לטעון את המועמדים');
        return;
      }
      setData(await res.json());
      setError(null);
    } catch {
      setError('לא הצלחנו לטעון את המועמדים');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const board = useMemo(
    () => (data ? buildFunnel({ candidates: data.candidates, events: data.events, now }) : null),
    [data, now],
  );

  const open = data?.candidates.find(c => c.id === openId) ?? null;

  // The answers travel with the card, not with the form: the card's row says whether the form
  // is filled, so it has to know before anybody taps it.
  useEffect(() => {
    if (!openId) { setCharacterization(undefined); setCharError(false); return; }
    let live = true;
    setCharacterization(undefined);
    setCharError(false);
    void (async () => {
      try {
        const res = await fetch(`/api/academy/characterization?candidateId=${encodeURIComponent(openId)}`, {
          headers: await apiHeaders(),
        });
        if (!res.ok) { if (live) setCharError(true); return; }
        const body = await res.json();
        if (live) setCharacterization(body?.characterization ?? null);
      } catch {
        // A failed read must NOT open an empty form. The save is a PUT of the whole form — that
        // is what lets an answer be taken back — so a blank form opened over answers nobody
        // could read would erase them on the first keystroke. The row says it did not load.
        if (live) setCharError(true);
      }
    })();
    return () => { live = false; };
  }, [openId]);

  /** Every write on the card goes through here: one request in flight, then re-read. */
  async function patch(payload: Record<string, unknown>, busyKey: string) {
    if (!openId || busy) return false;
    setBusy(busyKey);
    try {
      const res = await fetch('/api/academy/candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({ id: openId, ...payload }),
      });
      if (res.ok) await load();
      return res.ok;
    } finally {
      setBusy(null);
    }
  }

  async function create(input: {
    name: string; source: string; goal: string; phone: string; email: string; formFilled: boolean;
  }) {
    const res = await fetch('/api/academy/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
      body: JSON.stringify(input),
    });
    if (!res.ok) return false;
    await load();
    return true;
  }

  if (loading) return <LoadingBlock />;

  // Migration 110 is pasted in by hand, so the route reports the tables' absence
  // rather than erroring — and this says which step is outstanding instead of
  // showing a board that looks permanently empty.
  if (data?.tableMissing) {
    return (
      <EmptyState
        icon={UserPlus}
        title="לוח המועמדים לא הופעל"
        description="הטבלאות של המשפך עוד לא נוצרו במסד הנתונים."
      />
    );
  }

  if (error || !board) {
    return <EmptyState icon={AlertTriangle} title="שגיאה" description={error || 'לא הצלחנו לטעון את המועמדים'} />;
  }

  return (
    <>
      <FunnelBoardView board={board} onOpen={setOpenId} onAdd={() => setAdding(true)} />
      <CandidateSheet
        candidate={open}
        events={data?.events ?? []}
        open={openId !== null}
        onOpenChange={o => { if (!o) setOpenId(null); }}
        onStep={stage => void patch({ action: 'step', stage }, stage)}
        onUnstep={stage => void patch({ action: 'unstep', stage }, stage)}
        onArchive={reason => void (async () => {
          // The card closes only on success. Leaving it open on a failed request is what keeps
          // the typed reason on the screen instead of silently discarding it.
          if (await patch({ action: 'archive', reason }, ARCHIVE)) setOpenId(null);
        })()}
        onRestore={() => void patch({ action: 'restore' }, RESTORE)}
        onCharacterize={() => setCharacterizing(true)}
        characterizationState={
          charError ? 'error'
            : characterization === undefined ? 'loading'
            : characterization === null ? 'empty'
            : 'filled'
        }
        busy={busy}
      />
      {open && characterization !== undefined && (
        <CharacterizationSheet
          open={characterizing}
          onOpenChange={setCharacterizing}
          candidateName={open.name}
          candidateId={open.id}
          value={characterization}
          onSave={async next => {
            const res = await fetch('/api/academy/characterization', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
              body: JSON.stringify({ ...next, candidateId: open.id }),
            });
            if (!res.ok) return false;
            // The saved row and not the sent one, so the card's `מולא` and the form's fields
            // agree with what the table actually holds — a date the column refused is null
            // here, and the coach sees that rather than a value that only exists on screen.
            const body = await res.json().catch(() => null);
            if (body?.characterization) setCharacterization(body.characterization);
            return true;
          }}
          // The SAME request the card's `בוצע` button makes, so one code path moves the funnel.
          onComplete={() => void patch({ action: 'step', stage: 'characterization' }, 'characterization')}
          completed={(data?.events ?? []).some(e => e.candidateId === open.id && e.stage === 'characterization')}
          busy={busy === 'characterization'}
          today={now}
        />
      )}
      <AddCandidateSheet open={adding} onOpenChange={setAdding} onCreate={create} />
    </>
  );
}
