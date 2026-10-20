'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { MessageCircle, Send, ShieldCheck } from 'lucide-react';
import { cn, israelToday } from '@/lib/utils';
import type { AcademyFeedbackAttachment } from '@/lib/academy/thread';
import type { SegmentVerdict } from '@/lib/academy/segments';
import { BidiText } from '@/components/BidiText';
import { FeedbackCard } from './FeedbackCard';
import { SEAT_ORDER, SEAT_STYLE, seatInitials } from '@/lib/academy/seat-style';

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
  /**
   * Who wrote it. With several coaches in one seat (a shared trainee, migration
   * 135), the seat no longer says whose message is the viewer's own — the id does.
   */
  authorId?: string | null;
  authorName: string;
  seat: ThreadSeat;
  /** Empty is legal: a message can be nothing but a feedback card. */
  text: string;
  at: string;
  /** The weekly review, posted into the thread rather than living on another screen. */
  feedback?: AcademyFeedbackAttachment | null;
  /** The workout the message is about (YYYY-MM-DD), when it was sent from one. */
  workoutDate?: string | null;
}

/**
 * The manager's name gets a shield and its own ink; the coach gets the brand colour
 * the rest of the app already uses for staff. The trainee's own name is never
 * printed on their own messages — they know who they are.
 */
/**
 * How many messages are drawn at once; older ones wait behind "הודעות קודמות".
 *
 * The transcript used to render the whole season, so a thread a trainee had used
 * since the spring was a page that only grew — every bubble since March mounted,
 * and the newest one (the only one anybody opened the thread for) at the bottom
 * of it. Thirty is a few weeks of a normal thread.
 */
export const THREAD_PAGE = 30;


/** Is this message the viewer's own? By author when both ids are known, else by seat. */
export function isMine(m: Pick<ThreadMessage, 'authorId' | 'seat'>, viewerSeat: ThreadSeat, viewerId?: string | null): boolean {
  if (viewerId && m.authorId) return m.authorId === viewerId;
  return m.seat === viewerSeat;
}

export function ThreadTranscript({
  messages,
  viewerSeat,
  viewerId = null,
  segments,
  onSend,
  sending = false,
  error = null,
  className,
  layout = 'inline',
  readOnly,
  seenAt = null,
  quickReplies,
}: {
  messages: ThreadMessage[];
  /** When the trainee last read the thread: "נקרא ✓✓" under the viewer's newest message. */
  seenAt?: string | null;
  /** Chips above the composer that fill it with a ready line (the chat mockup's quick row). */
  quickReplies?: string[];
  /** Which seat is looking. Their own messages are the ones that sit on the end. */
  viewerSeat: ThreadSeat;
  /**
   * The viewer's own id. When given, "mine" is the messages THEY wrote — so one
   * coach of a shared trainee sees the other coach's messages as someone else's,
   * named, rather than as their own. Without it, the seat decides (as before).
   */
  viewerId?: string | null;
  segments?: SegmentVerdict[];
  onSend?: (text: string) => void | Promise<void>;
  sending?: boolean;
  error?: string | null;
  className?: string;
  /**
   * `sheet` — the trainee's conversation sheet: the transcript scrolls inside its
   * own box with the newest message in view, and the composer stays pinned below
   * it however long the thread is. `inline` is the staff tab's flowing layout.
   * The parent must give a `sheet` a bounded height (flex-1 min-h-0).
   */
  layout?: 'inline' | 'sheet';
  /**
   * Draw the composer greyed with this label instead of a working one — an admin
   * viewing the app as somebody (lib/view-as-person.ts). Tapping it says why.
   */
  readOnly?: { label: string; onTap: () => void };
}) {
  const [draft, setDraft] = useState('');
  const [shown, setShown] = useState(THREAD_PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** scrollHeight before "הודעות קודמות" grew the list, so the reader stays where they were. */
  const anchorRef = useRef<number | null>(null);
  const hidden = Math.max(0, messages.length - shown);
  const visible = hidden ? messages.slice(hidden) : messages;
  const isSheet = layout === 'sheet';

  // Newest in view: on open and whenever a message arrives — except right after
  // older ones were revealed, when the reader is looking at the top on purpose.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !isSheet) return;
    if (anchorRef.current != null) {
      el.scrollTop = el.scrollHeight - anchorRef.current;
      anchorRef.current = null;
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [visible.length, messages.length, isSheet]);

  const showOlder = () => {
    if (scrollRef.current) anchorRef.current = scrollRef.current.scrollHeight - scrollRef.current.scrollTop;
    setShown((n) => n + THREAD_PAGE);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !onSend) return;
    // Cleared optimistically: a composer that holds the text until the server
    // answers reads as a failed send on a slow connection, and the trainee retypes.
    setDraft('');
    await onSend(text);
  };

  return (
    <div className={cn('flex flex-col', isSheet && 'min-h-0', className)} dir="rtl">
      <div ref={scrollRef} className={cn(isSheet && 'min-h-0 flex-1 overflow-y-auto overscroll-contain')}>
      {hidden > 0 && (
        <button
          type="button"
          onClick={showOlder}
          className="mx-auto flex min-h-[44px] items-center px-4 text-xs font-bold text-brand-600"
        >
          הודעות קודמות
        </button>
      )}
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
          <SeatLegend />
          {visible.map((m, i) => {
            const mine = isMine(m, viewerSeat, viewerId);
            const last = i === visible.length - 1;
            return (
              <div key={m.id}>
                {needsDaySeparator(visible, i) && <DaySeparator at={m.at} />}
                <Bubble message={m} mine={mine} segments={segments} />
                {mine && last && viewerSeat !== 'trainee' && (
                  <p className="mt-0.5 px-10 text-[11px] text-ink-400">
                    {seenAt && Date.parse(seenAt) >= Date.parse(m.at) ? <><b className="text-brand-600">✓✓</b> נקרא</> : <>✓ נשלח</>}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      </div>

      {error && <p className="mt-1 text-[11px] text-accent-red-ink">{error}</p>}

      {readOnly && (
        <button
          type="button"
          onClick={readOnly.onTap}
          data-testid="thread-composer-readonly"
          className={cn('mt-2 flex w-full items-center gap-2', isSheet && 'shrink-0 border-t border-page pt-2')}
        >
          <span className="flex min-h-[44px] flex-1 items-center rounded-xl border border-page bg-page/60 px-3 text-base text-ink-400">
            {readOnly.label}
          </span>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-page text-ink-300">
            <Send className="h-4 w-4" />
          </span>
        </button>
      )}

      {onSend && !readOnly && quickReplies?.length ? (
        <div className={cn('mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]', isSheet && 'shrink-0')}>
          {quickReplies.map((q) => (
            <button key={q} type="button" onClick={() => setDraft((d) => (d.trim() ? `${d.trim()} ${q}` : q))}
              className="min-h-[34px] shrink-0 rounded-full border border-brand-600/25 px-3 text-[12.5px] font-bold text-brand-600">{q}</button>
          ))}
        </div>
      ) : null}

      {onSend && !readOnly && (
        <div className={cn('mt-2 flex items-end gap-2', isSheet && 'shrink-0 border-t border-page pt-2')}>
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
        <div className="flex items-center gap-1.5 px-1 text-[12px] font-extrabold" style={{ color: SEAT_STYLE[seat].ink }}>
          <SeatAvatar seat={seat} name={authorName} size={24} />
          {seat === 'manager' && <ShieldCheck className="h-3 w-3" />}
          <span dir="auto">{authorName}</span> · {SEAT_STYLE[seat].word}
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

  // Every seat has its colour (lib/academy/seat-style.ts): the avatar's ring, the name and
  // its role word, the bubble's tint and its edge. Mine sit on the far side, without a name.
  const style = SEAT_STYLE[seat];
  return (
    <div className={cn('flex items-end gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
      {mine ? <span className="w-[30px] shrink-0" /> : <SeatAvatar seat={seat} name={authorName} />}
      {/* Mine: the solid blue bubble of any chat app (mockup academy-chat). Others keep
          their seat's tint and name, because three seats share this thread. */}
      <div
        className={cn('max-w-[78%] rounded-[20px] px-3 py-2', mine ? 'rounded-es-md bg-brand-600 text-white' : 'rounded-ee-md border-s-[3px] text-ink-700')}
        style={mine ? undefined : { background: style.bg, borderInlineStartColor: style.ink }}
      >
        {!mine && (
          <div className="mb-0.5 flex items-center gap-1 text-[12px] font-extrabold" style={{ color: style.ink }}>
            {seat === 'manager' && <ShieldCheck className="h-3 w-3" />}
            <span dir="auto">{authorName}</span>
            <span>· {style.word}</span>
          </div>
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" dir="auto">
          {/* Somebody typed this, so the numbers in it cannot be wrapped by hand:
              a coach writing "8×1000" was being read as "1000×8". */}
          <BidiText text={text} />
        </p>
        {/* 11px, not 10: the audit's floor. */}
        <div className={cn('mt-0.5 text-[11px]', mine ? 'text-white/75' : 'text-ink-400')}>
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

/** The seat's ring around initials: green coach, purple trainee, amber manager. */
export function SeatAvatar({ seat, name, size = 30 }: { seat: ThreadSeat; name: string; size?: number }) {
  const { ink } = SEAT_STYLE[seat];
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-white font-black"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), color: ink, boxShadow: `0 0 0 2.5px ${ink}` }}
    >
      {seatInitials(name)}
    </span>
  );
}

/** Which colour is who — once, at the top of the thread. */
function SeatLegend() {
  return (
    <div className="flex justify-center gap-3.5 pb-1 text-[12px] font-extrabold">
      {SEAT_ORDER.map((seat) => (
        <span key={seat} className="flex items-center gap-1" style={{ color: SEAT_STYLE[seat].ink }}>
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: SEAT_STYLE[seat].ink }} />
          {SEAT_STYLE[seat].word}
        </span>
      ))}
    </div>
  );
}
