'use client';

import { useState } from 'react';
import { MessageCircle, Send, ShieldCheck } from 'lucide-react';
import { cn, israelToday } from '@/lib/utils';
import type { AcademyFeedbackAttachment } from '@/lib/academy/thread';
import type { SegmentVerdict } from '@/lib/academy/segments';
import { BidiText } from '@/components/BidiText';
import { FeedbackCard } from './FeedbackCard';

// ── The three-way thread, as everyone in it reads it ────────────────────────
//
// Presentational on purpose: it takes messages and an onSend, and knows nothing
// about Stream. Two reasons, and the second is the one that matters.
//   · The transport is a Stream channel (see lib/academy/thread.ts), and a
//     component welded to Stream's hooks cannot be mounted in the audit harness —
//     which is where every RTL and tap-target defect in this app has been caught.
//   · Three seats read this screen and each one needs to see the same transcript.
//     One renderer, three viewers, no chance of the manager's copy drifting.
//
// Two departures from the club's WhatsApp group, which is what this replaces:
//   · DAY SEPARATORS. WhatsApp's failure here is not that messages are missing, it
//     is that a decision from March is unfindable in a scroll with no landmarks. A
//     thread that spans a season needs dates or it is the same problem in a new
//     colour.
//   · THE MANAGER IS LABELLED. A three-way thread where you cannot tell the coach
//     from the academy manager is worse than a two-way one: the same sentence
//     carries different weight depending on which of them said it.

/** Which seat wrote it. Not a role name — the seat is what changes the bubble. */
export type ThreadSeat = 'trainee' | 'coach' | 'manager';

export interface ThreadMessage {
  id: string;
  authorName: string;
  seat: ThreadSeat;
  /** Empty is legal: a message can be nothing but a feedback card. */
  text: string;
  at: string;
  /** The weekly review, posted into the thread rather than living on another screen. */
  feedback?: AcademyFeedbackAttachment | null;
}

/**
 * The manager's name gets a shield and its own ink; the coach gets the brand colour
 * the rest of the app already uses for staff. The trainee's own name is never
 * printed on their own messages — they know who they are.
 */
const SEAT_INK: Record<ThreadSeat, string> = {
  trainee: 'text-ink-500',
  coach: 'text-brand-600',
  manager: 'text-accent-900',
};

export function ThreadTranscript({
  messages,
  viewerSeat,
  segments,
  onSend,
  sending = false,
  error = null,
  className,
}: {
  messages: ThreadMessage[];
  /** Which seat is looking. Their own messages are the ones that sit on the end. */
  viewerSeat: ThreadSeat;
  segments?: SegmentVerdict[];
  onSend?: (text: string) => void | Promise<void>;
  sending?: boolean;
  error?: string | null;
  className?: string;
}) {
  const [draft, setDraft] = useState('');

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !onSend) return;
    // Cleared optimistically: a composer that holds the text until the server
    // answers reads as a failed send on a slow connection, and the trainee retypes.
    setDraft('');
    await onSend(text);
  };

  return (
    <div className={cn('flex flex-col', className)} dir="rtl">
      {messages.length === 0 ? (
        <div className="flex items-center gap-1.5 py-6 text-xs text-ink-400">
          <MessageCircle className="h-3.5 w-3.5" />
          {/* Named for what it is, not "no messages": an empty thread with a coach and
              a manager in it is a thread waiting for somebody to start, and saying so
              is the nudge. */}
          עוד לא נכתב כאן כלום. אפשר לפתוח.
        </div>
      ) : (
        <div className="space-y-2.5 py-1">
          {messages.map((m, i) => (
            <div key={m.id}>
              {needsDaySeparator(messages, i) && <DaySeparator at={m.at} />}
              <Bubble message={m} mine={m.seat === viewerSeat} segments={segments} />
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-[11px] text-accent-red-ink">{error}</p>}

      {onSend && (
        <div className="mt-2 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
            rows={1}
            placeholder="כתוב הודעה…"
            aria-label="הודעה חדשה"
            dir="auto"
            /* 16px, not the 14px the older FeedbackThread composer uses: iOS Safari
               zooms the whole page when a field under 16px takes focus, and a chat
               composer is the single most-focused field on any screen. */
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-page bg-page/60 px-3 py-2.5 text-base text-ink-700 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
          />
          <button
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            aria-label="שלח"
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all',
              draft.trim() && !sending ? 'bg-brand-600 text-white active:scale-90' : 'bg-page text-ink-400',
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function Bubble({
  message,
  mine,
  segments,
}: {
  message: ThreadMessage;
  mine: boolean;
  segments?: SegmentVerdict[];
}) {
  const { seat, authorName, text, at, feedback } = message;

  // The weekly review is NOT squeezed into a bubble. It is the one message that is a
  // document rather than a remark, and the identical card renders under the run
  // itself — so a trainee comparing the two sees one review, not two versions of it.
  if (feedback) {
    return (
      <div className="space-y-1">
        <div className={cn('flex items-center gap-1 px-1 text-[11px] font-semibold', SEAT_INK[seat])}>
          {seat === 'manager' && <ShieldCheck className="h-3 w-3" />}
          <span dir="auto">{authorName}</span>
          <span className="font-normal text-ink-400">· {fmtTime(at)}</span>
        </div>
        <FeedbackCard
          feedback={feedback.feedback}
          workoutName={feedback.workout_name ?? undefined}
          segments={segments}
          // Not "המשוב שלך מיוסי": three seats read this thread, the author is already
          // named on the line above, and the day separator already dated it.
          heading="המשוב השבועי"
          showSentAt={false}
        />
      </div>
    );
  }

  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[82%] rounded-2xl px-3 py-2',
          mine ? 'bg-brand-600 text-white' : 'bg-page/60 text-ink-700',
        )}
      >
        {/* Never on your own messages — you know who you are. Always on everyone
            else's, including the manager's, with the shield that says which seat. */}
        {!mine && (
          <div className={cn('mb-0.5 flex items-center gap-1 text-[11px] font-bold', SEAT_INK[seat])}>
            {seat === 'manager' && <ShieldCheck className="h-3 w-3" />}
            <span dir="auto">{authorName}</span>
          </div>
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" dir="auto">
          {/* Somebody typed this, so the numbers in it cannot be wrapped by hand:
              a coach writing "8×1000" was being read as "1000×8". */}
          <BidiText text={text} />
        </p>
        {/* 11px, not 10: the audit's floor. A timestamp is glanced at, not read, but
            10px is below what this app is willing to print anywhere. */}
        <div className={cn('mt-0.5 text-[11px]', mine ? 'text-white/70' : 'text-ink-400')}>
          {fmtTime(at)}
        </div>
      </div>
    </div>
  );
}

function DaySeparator({ at }: { at: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="h-px flex-1 bg-page" />
      <span className="text-[11px] font-semibold text-ink-400">{fmtDay(at)}</span>
      <div className="h-px flex-1 bg-page" />
    </div>
  );
}

/** A separator before the first message of each calendar day, including the first. */
function needsDaySeparator(messages: ThreadMessage[], i: number): boolean {
  if (i === 0) return true;
  return dayKey(messages[i].at) !== dayKey(messages[i - 1].at);
}

/**
 * Every date and clock on this screen is Israel wall-clock, never the device's.
 *
 * Two separate reasons, and both bit:
 *  · The club is entirely in Israel while every server this runs on has a UTC
 *    clock — the rule `israelToday` in lib/utils.ts already states for the whole
 *    app.
 *  · This component is server-rendered, so an unpinned `toLocaleTimeString` prints
 *    20:16 on the server and 22:16 in the browser, and React throws out the whole
 *    tree as a hydration mismatch. The audit caught exactly that, and it would have
 *    shipped: it is invisible in a screenshot because the client value is the one
 *    left standing.
 */
const TZ = 'Asia/Jerusalem';

function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : israelToday(d);
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const key = israelToday(d);
  const today = israelToday();
  if (key === today) return 'היום';
  if (key === israelToday(new Date(Date.now() - 86400000))) return 'אתמול';
  const days = Math.round((Date.parse(today) - Date.parse(key)) / 86400000);
  // Past a week the weekday stops being a landmark and the date starts being one.
  if (days > 0 && days < 7) return d.toLocaleDateString('he-IL', { weekday: 'long', timeZone: TZ });
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', timeZone: TZ });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // A clock time is two numbers around a colon and must not be reordered by the
  // surrounding Hebrew — the same bidi trap the deviation line hit in the queue.
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
