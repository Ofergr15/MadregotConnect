'use client';

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui';

/**
 * "None of these times work" — and, if the trainee will say it, why.
 *
 * `ScheduledTest` has had an `onAskOther` with no note since it was built, which made the
 * request a bare fact: the coach learned that three offered times failed and nothing about what
 * would succeed. They then offer three more times from the same guess. That loop is one of the
 * ways funnel step 6 actually loses people, and it is the loop this sheet exists to break —
 * `academy_test_invitations.requested_note` is read straight onto the coach's board, so one
 * sentence here ("I work shifts until the 20th, mornings only") is the difference between a
 * second guess and a time that works.
 *
 * ── THE NOTE IS OPTIONAL, AND THE SEND BUTTON IS NEVER DISABLED ───────────────────────────
 *
 * The temptation is to require it: the note is the whole value of the sheet, so make them type.
 * That gets the trade exactly backwards. "None of these work" is itself an answer worth having —
 * it keeps a live candidate in view and starts the coach's move — and a required field would
 * make the honest tap harder than the dishonest alternative, which is closing the app and
 * letting the invitation lapse into a silence nobody can act on. A request with no note still
 * reaches the coach; a request never sent reaches nobody.
 *
 * ── AND IT ASKS A QUESTION, NOT FOR A NOTE ───────────────────────────────────────────────
 *
 * The placeholder asks what DOES work, because that is what the coach's next action needs.
 * Labelled `הערה` on an empty box, people write an apology — "sorry, I could not make it" —
 * which is kind and useless. Asked "when would work?", the same person writes a constraint.
 */
export function AskOtherTimeSheet({
  open,
  onOpenChange,
  onSend,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trimmed note, or `''`. The caller sends it; this sheet never touches the network. */
  onSend: (note: string) => void;
  busy?: boolean;
}) {
  const [note, setNote] = useState('');

  // Cleared on open rather than on close, so a request that fails to send can be reopened with
  // the sentence still in the box — retyping it is exactly when somebody gives up instead.
  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="בקשת זמן אחר">
      <div className="space-y-3 px-4 pb-4" dir="rtl">
        {/* Two facts and nothing else: what happens next, and that the box is optional. The
            first draft also explained that writing something makes the next times more
            accurate — which is what the label below already asks for, so it spent a line of a
            sheet on repeating the question underneath it. */}
        <p className="text-xs leading-relaxed text-ink-700">
          המאמן יראה את הבקשה ויציע זמנים חדשים. אפשר לשלוח גם בלי לכתוב כלום.
        </p>
        {/* The question as a real `<label>`, not as placeholder text. Two reasons and both were
            measured: a placeholder-only field has no accessible name, and a placeholder vanishes
            the moment somebody starts typing — taking the only statement of what to write with
            it, exactly when they are mid-sentence and wondering. So the question stays put and
            the placeholder is reduced to the example. */}
        <label htmlFor="ask-other-note" className="block px-1 text-[11px] font-semibold text-ink-500">
          מתי כן מסתדר לך?
        </label>
        <textarea
          id="ask-other-note"
          value={note}
          onChange={e => setNote(e.target.value)}
          // Same 500 the route clips at, so nobody writes a paragraph and watches it get cut.
          maxLength={500}
          rows={3}
          disabled={busy}
          dir="auto"
          placeholder="למשל: עובד במשמרות עד ה-20, אפשר רק בבוקר"
          // `text-base` and not `text-sm`, which is the house default for form text: iOS Safari
          // zooms the whole page in when a field under 16px takes focus, and it does not zoom
          // back out. On a sheet that means the keyboard comes up over a page that has grown
          // past the viewport and the send button is off-screen behind it.
          // `resize-none`: the default grabber drew a control in the corner of the box that does
          // nothing on a touch screen, inside a sheet that already drags.
          className="w-full resize-none rounded-card bg-page px-3 py-2.5 text-base text-ink-900 placeholder:text-ink-400 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => onSend(note.trim())}
          disabled={busy}
          className="min-h-[48px] w-full rounded-card bg-brand-600 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? 'שולח…' : 'שלח בקשה'}
        </button>
      </div>
    </Sheet>
  );
}
