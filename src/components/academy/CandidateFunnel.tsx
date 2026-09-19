'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, Plus, Undo2, UserPlus } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EmptyState, LoadingBlock, Sheet } from '@/components/ui';
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
  return (
    <div>
      <div className="flex items-baseline justify-between px-1 pb-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[15px] font-bold text-ink-900">
            <bdi dir="ltr">{board.live}</bdi> מועמדים
          </span>
          {/* The second number is the whole point of the screen, so it is the
              only coloured thing in the header — and it disappears entirely when
              it is zero rather than rendering a grey `0 תקועים`, which reads as
              a broken counter on the one day the board is clean. */}
          {board.stuck > 0 && (
            <span className="text-[15px] font-bold text-accent-red">
              <bdi dir="ltr">{board.stuck}</bdi> תקועים
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
      ) : (
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
  busy,
}: {
  candidate: (CandidateRow & { email?: string | null; phone?: string | null }) | null;
  events: CandidateEvent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStep?: (stage: string) => void;
  onUnstep?: (stage: string) => void;
  busy?: string | null;
}) {
  const steps = useMemo(
    () => (candidate ? candidateTimeline(candidate, events) : []),
    [candidate, events],
  );
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
      </div>
    </Sheet>
  );
}

// ── The mounted panel ────────────────────────────────────────────────────────

export function CandidateFunnel() {
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  async function record(action: 'step' | 'unstep', stage: string) {
    if (!openId || busy) return;
    setBusy(stage);
    try {
      const res = await fetch('/api/academy/candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({ id: openId, action, stage }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(null);
    }
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
      <FunnelBoardView board={board} onOpen={setOpenId} />
      <CandidateSheet
        candidate={open}
        events={data?.events ?? []}
        open={openId !== null}
        onOpenChange={o => { if (!o) setOpenId(null); }}
        onStep={stage => void record('step', stage)}
        onUnstep={stage => void record('unstep', stage)}
        busy={busy}
      />
    </>
  );
}
