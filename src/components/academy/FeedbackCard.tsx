'use client';

import { Quote } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ACTION_LABELS,
  EFFORT_LABELS,
  EXECUTION_LABELS,
  lapLabel,
  type ActionTag,
  type ExecutionTag,
  type LapComment,
} from '@/lib/academy/feedback';
import type { SegmentVerdict } from '@/lib/academy/segments';

// ── The feedback, as the trainee reads it ───────────────────────────────────
//
// The other half of the weekly loop. The mentor picks from a closed vocabulary;
// this is where that pays off, because a fixed set of tags can be RENDERED — as
// chips, in an order, with the decision at the end — instead of arriving as a
// paragraph in WhatsApp that scrolls away by Tuesday.
//
// Three deliberate differences from the text version the mentor composes:
//
//  · NO RED. The mentor's queue uses red for an absence, because that is a thing
//    someone must act on. Nothing on the trainee's own card is red: "איטי
//    מהמתוכנן" is a fact about one session, and a card that greets them in red
//    every week teaches them not to open it. Praise is green, everything else is
//    ink on a quiet wash.
//  · THE DECISION IS THE ANCHOR, not the footer. In the WhatsApp text the action
//    lands last because that is how a sentence ends; here it gets its own block at
//    the bottom with a label, because "מה ממשיכים מכאן" is the one line the
//    trainee should still know on Thursday.
//  · The lap comments are quoted, not listed. They are the part no tool these
//    trainees use today can produce — a person looked at rep 4 — so they should
//    read as somebody talking, not as a data field.

/** Tags that are praise. Everything else is a note, and nothing is an accusation. */
const PRAISE: ReadonlySet<ExecutionTag> = new Set<ExecutionTag>(['on_plan', 'strong_finish']);

/**
 * The action, and how loud it is.
 *
 * `needs_talk` and `health_check` are the two that ask something of the trainee
 * rather than describing the plan, so they carry the brand colour and the others
 * stay quiet. Still no red: "צריך שיחה" is an invitation, and a trainee who reads
 * it as a summons is less likely to come.
 */
const ACTION_TONE: Record<ActionTag, string> = {
  keep: 'bg-accent-600/10 text-accent-900',
  push_next: 'bg-accent-600/10 text-accent-900',
  ease_next: 'bg-page text-ink-700',
  needs_talk: 'bg-brand-600/10 text-brand-600',
  health_check: 'bg-brand-600/10 text-brand-600',
};

export interface TraineeFeedback {
  execution: ExecutionTag[];
  effort: string | null;
  action: ActionTag | null;
  lapComments: LapComment[];
  note: string;
  sentAt: string | null;
  /** Who wrote it. The club is 1:1, so this is a person the trainee knows by name. */
  mentorName?: string | null;
}

export function FeedbackCard({
  feedback,
  workoutName,
  segments,
  className,
}: {
  feedback: TraineeFeedback;
  workoutName?: string;
  /** Lets a lap comment be titled by the planned step ("חזרה 4") instead of its index. */
  segments?: SegmentVerdict[];
  className?: string;
}) {
  const { execution, effort, action, note, sentAt, mentorName } = feedback;
  const laps = feedback.lapComments.filter(c => c.text.trim());
  // Only what was actually filled in. A card with three empty labelled sections
  // says the mentor skipped it, which is not what an unset optional field means.
  const hasBody = execution.length > 0 || effort || laps.length > 0 || note.trim();

  return (
    <div className={cn('rounded-card bg-card p-4 space-y-3.5', className)} dir="rtl">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-ink-900">
          המשוב שלך{mentorName ? ` מ${mentorName}` : ''}
        </h3>
        {sentAt && (
          <span className="shrink-0 text-[11px] text-ink-400">{fmtSentAt(sentAt)}</span>
        )}
      </div>
      {workoutName && (
        <p className="-mt-2 text-xs text-ink-400" dir="auto">{workoutName}</p>
      )}

      {!hasBody && !action ? (
        <p className="text-xs text-ink-400">המלווה עוד לא כתב על האימון הזה.</p>
      ) : (
        <>
          {execution.length > 0 && (
            <div>
              <Label>מה קרה באימון</Label>
              <div className="flex flex-wrap gap-1.5">
                {execution.map(t => (
                  <span
                    key={t}
                    className={cn(
                      'rounded-pill px-2.5 py-1 text-xs font-semibold',
                      PRAISE.has(t) ? 'bg-accent-600/10 text-accent-900' : 'bg-page text-ink-700',
                    )}
                  >
                    {EXECUTION_LABELS[t]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {effort && effort in EFFORT_LABELS && (
            <div>
              <Label>תחושה</Label>
              <span className="rounded-pill bg-page px-2.5 py-1 text-xs font-semibold text-ink-700">
                {EFFORT_LABELS[effort as keyof typeof EFFORT_LABELS]}
              </span>
            </div>
          )}

          {laps.length > 0 && (
            <div>
              <Label>על חזרות מסוימות</Label>
              <div className="space-y-1.5">
                {laps.map(c => (
                  <div key={c.index} className="rounded-lg bg-page px-2.5 py-2">
                    <div className="text-[11px] font-semibold text-ink-500">
                      {lapLabel(c.index, segments)}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-700" dir="auto">
                      {c.text.trim()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {note.trim() && (
            /* The free-text line, marked as somebody's words. It is the one part of
               the card the vocabulary could not have produced, so it should not look
               like another field. */
            <div className="flex gap-2 rounded-lg bg-page px-2.5 py-2">
              <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
              <p className="text-xs leading-relaxed text-ink-700" dir="auto">{note.trim()}</p>
            </div>
          )}

          {action && (
            <div className="pt-0.5">
              <Label>מה ממשיכים מכאן</Label>
              <div className={cn('rounded-lg px-3 py-2.5 text-sm font-bold', ACTION_TONE[action])}>
                {ACTION_LABELS[action]}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-semibold text-ink-400">{children}</div>;
}

/**
 * When it was written, in the only terms that matter to someone deciding whether
 * they have already read it: today, yesterday, or a date.
 */
function fmtSentAt(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(then)) / 86400000);
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  return then.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}
