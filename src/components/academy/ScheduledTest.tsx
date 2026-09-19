'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, BellRing, Check, CheckCircle2, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  futureSlots,
  inviteState,
  protocolInstructions,
  protocolLabel,
  reminderPromise,
  slotDayLabel,
  slotLabel,
  type TestInvitation,
} from '@/lib/academy/testInvite';

/**
 * The test the trainee has been asked to run, on the trainee's own screen.
 *
 * Funnel step 6 is where candidates are lost, and not to a decision. A 30-minute all-out
 * effort is the kind of thing a person genuinely means to do on Thursday and then does not.
 * Until now the athlete's side of the feature was an entry form with no date on it — it asked
 * somebody to report a test nobody had told them to run.
 *
 * ── THE TONE IS THE FEATURE ──────────────────────────────────────────────────────────────
 *
 * The overdue state is the one that decides whether this works. The person reading it meant to
 * run the test and did not, and they already know that. A screen that tells them off converts
 * a forgetful trainee into an embarrassed one, and an embarrassed trainee stops opening the
 * app — which is the exact failure the double reminder exists to prevent. So overdue offers
 * two ways forward and assigns no blame: report it if you ran it, or pick a new time. There is
 * no red, no count of days missed, and no word for "late".
 *
 * ── NO CANCEL ────────────────────────────────────────────────────────────────────────────
 *
 * `בקש זמן אחר` and nothing else. The route enforces it too. A trainee-facing cancel would let
 * one tap turn somebody who is trying into a silent row, and the academy would learn nothing
 * from it — where "none of these times work" reaches the coach and keeps the person in view.
 */

// ── EVERY SURFACE HERE IS `bg-card`, NOT `bg-page` ─────────────────────────────────────────
//
// `bg-page` is the app's inset-tile fill, which works only INSIDE a card. This block sits
// directly on the page, so `bg-page` surfaces composite to exactly the page colour and vanish:
// the first screenshots of this screen showed the slot picker as four floating text labels and
// every explanatory block as unboxed prose, with the chips and the "change the time?" button
// reading as captions rather than as things to tap. Nothing measured it — the boxes were all
// the right size, they just had no edges.
const CHIP = 'min-h-[44px] rounded-pill px-3.5 text-xs font-bold';
const PRIMARY = 'min-h-[48px] w-full rounded-card bg-brand-600 text-sm font-bold text-white disabled:opacity-50';

/** A labelled block of explanatory text, the shape used across the academy's athlete screens. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-card bg-card px-3.5 py-3 text-xs leading-relaxed text-ink-700" dir="auto">
      {children}
    </p>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 mt-4 px-1 text-[11px] font-semibold text-ink-500" dir="auto">
      {children}
    </p>
  );
}

export function ScheduledTest({
  invitation,
  now,
  watchConnected,
  onConfirm,
  onAskOther,
  busy,
}: {
  invitation: TestInvitation;
  /** Passed in rather than read from the clock, so the preview and the audit are deterministic. */
  now: string;
  /** Whether a watch is linked. Changes what the trainee has to do, not just what it says. */
  watchConnected?: boolean;
  onConfirm: (slot: string) => void;
  /** No `note` argument yet: the sheet for typing one is its own slice. */
  onAskOther: () => void;
  busy?: boolean;
}) {
  const state = inviteState(invitation, now);
  const open = useMemo(() => futureSlots(invitation.proposedSlots, now), [invitation.proposedSlots, now]);
  // The slot the coach is actually asking for is the first that has not gone by — not
  // `proposedSlots[0]`, which may be yesterday by the time anybody opens the app.
  const asking = open[0] ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = picked ?? asking;

  // Nothing to show. The parent renders the improvement graph and the entry form; an
  // invitation that is finished or withdrawn is not a thing to tell the athlete about.
  if (state === 'done' || state === 'cancelled') return null;

  const confirmedLabel = invitation.confirmedSlot ? slotLabel(invitation.confirmedSlot) : null;

  return (
    <div className="space-y-2" dir="rtl">
      {/* What was asked for, and how to run it. Always first and always the same, in every
          state: the instructions matter most to the person about to do it for the first time,
          and burying them under a status changes which of the two the eye lands on. */}
      <div className="rounded-card bg-card px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex shrink-0 items-center gap-1 rounded-pill bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">
            <Timer className="h-3 w-3" />
            טסט
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink-900" dir="auto">{protocolLabel(invitation.protocol)}</p>
            <p className="truncate text-xs text-ink-500" dir="auto">נקודת הפתיחה שלך באקדמיה</p>
          </div>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-ink-700" dir="auto">
          <span className="font-bold">איך מבצעים: </span>
          {protocolInstructions(invitation.protocol)}
        </p>
      </div>

      {/* Whether there is anything to fill in afterwards. Said before the test rather than
          after, because "do I need to write this down" is a question the trainee has while
          deciding whether they have time to do it at all.

          The green box is `text-accent-900` on `bg-accent-600/15`, the pairing tailwind.config
          documents for a label sitting on a wash of its own colour. The obvious
          `text-accent-700` on `bg-accent-700/10` measured 3.76:1 at 12px — a colour on a tint of
          itself caps the ratio at what it scores against near-white, which is the bug that token
          exists for.

          Hidden in `other_requested` and `expired`, the two states with no test coming: there,
          "the workout will come in by itself" answers a question nobody is asking yet, and it
          reads as reassurance about an appointment that does not exist. */}
      {state !== 'other_requested' && state !== 'expired' && (watchConnected ? (
        <p className="flex items-start gap-2 rounded-card bg-accent-600/15 px-3.5 py-2.5 text-xs leading-relaxed text-accent-900" dir="auto">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>השעון שלך מחובר — האימון ייכנס לבד ואין מה למלא ידנית.</span>
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-card bg-card px-3.5 py-2.5 text-xs leading-relaxed text-ink-500" dir="auto">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>אין שעון מחובר, אז אחרי הטסט תצטרך להזין את המרחק והזמן כאן בעצמך.</span>
        </p>
      ))}

      {state === 'awaiting_answer' && asking && chosen && (
        <>
          {/* No separate "here is the time" hero above the chips. The selected chip and the
              confirm button below it already name the chosen slot, and a third copy of the same
              fact is what made the first version of this screen read as three competing answers
              to "when".

              A flat label rather than `לא מסתדר ב${day}?`, too: that phrasing has to name a day,
              so it either names `chosen` — rewriting itself under the trainee as they try the
              alternatives — or names the coach's ask while sitting above a row where that day is
              the highlighted chip. `בקש זמן אחר` already carries "none of these work". */}
          <Label>הזמנים שהוצעו</Label>
          <div className="flex flex-wrap gap-1.5">
            {/* EVERY offered slot, including the one already shown above — not `slice(1)`. With
                the first one left out of the row there is no way back to it after tapping an
                alternative, so a trainee who taps Friday to see it is stuck confirming Friday.
                A picker whose selection cannot be undone is how somebody ends up agreeing to a
                time they cannot make, which is the one outcome this screen exists to avoid. */}
            {open.map(slot => (
              <button
                key={slot}
                type="button"
                onClick={() => setPicked(slot)}
                disabled={busy}
                aria-pressed={slot === chosen}
                className={cn(
                  CHIP,
                  slot === chosen ? 'bg-brand-600 text-white' : 'bg-card text-ink-700',
                )}
              >
                <bdi dir="ltr">{slotLabel(slot)}</bdi>
              </button>
            ))}
          </div>

          <div className="pt-1.5">
            <button type="button" onClick={() => onConfirm(chosen)} disabled={busy} className={PRIMARY}>
              {busy ? 'שומר…' : `אישרתי — ${slotDayLabel(chosen)}`}
            </button>
          </div>

          {/* NOT a chip in the row above. As a pill it wrapped onto a second line and looked
              exactly like a fourth slot — one white rounded thing among several, except that
              tapping it messages the coach instead of picking a time. Two controls with the same
              appearance and different consequences is the confusion; the underlined link is the
              same treatment `צריך לשנות את הזמן?` gets in the confirmed state, so "none of these"
              looks like the secondary route on both screens. */}
          <button
            type="button"
            onClick={onAskOther}
            disabled={busy}
            className="mt-1 min-h-[44px] w-full text-xs font-medium text-ink-500 underline decoration-ink-300 underline-offset-4 disabled:opacity-50"
          >
            אף אחד מהזמנים לא מסתדר?
          </button>
        </>
      )}

      {(state === 'confirmed' || state === 'today') && confirmedLabel && (
        <>
          <Label>{state === 'today' ? 'הטסט שלך היום' : 'מאושר'}</Label>
          <p className="flex items-center gap-2 rounded-card bg-accent-600/15 px-3.5 py-3 text-sm font-bold text-accent-900" dir="auto">
            <Check className="h-4 w-4 shrink-0" />
            <bdi dir="ltr">{confirmedLabel}</bdi>
          </p>
          {state === 'today' ? (
            <Note>
              {/* No countdown and no "good luck". The useful thing to say on the morning is the
                  one instruction that decides whether the test is worth anything. */}
              זכור: הקצב שאתה פותח בו קובע אם הטסט שווה משהו. אם תפתח מהר מדי תצטרך להאט, והמספר
              שיצא יהיה נמוך מהיכולת האמיתית שלך.
            </Note>
          ) : (
            <p className="flex items-start gap-2 rounded-card bg-card px-3.5 py-2.5 text-xs leading-relaxed text-ink-500" dir="auto">
              <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {/* Promised out loud. A reminder nobody was warned about reads as the app
                  nagging; a reminder that was promised reads as the app doing its job. */}
              <span>{reminderPromise()}</span>
            </p>
          )}
          {/* Only while the test is still ahead, NOT on the day itself. On `today` this was the
              one visible control on the screen, which put an escape hatch exactly where the whole
              feature is trying to get a run done — and made it the likeliest tap of the morning.
              Nothing is lost by removing it: if the day really falls apart, tomorrow's `overdue`
              screen offers a new time without the trainee having to declare anything today.

              Small, low and alone, like every other undo in the academy: findable when the week
              changes, not tappable by accident on the way past. UNDERLINED, because without it a
              centred line of grey text among a column of grey section labels is indistinguishable
              from one — the first screenshot read it as a heading. */}
          {state === 'confirmed' && (
            <button
              type="button"
              onClick={onAskOther}
              disabled={busy}
              className="mt-1 min-h-[44px] w-full text-xs font-medium text-ink-500 underline decoration-ink-300 underline-offset-4 disabled:opacity-50"
            >
              צריך לשנות את הזמן?
            </button>
          )}
        </>
      )}

      {state === 'overdue' && (
        <>
          <Label>הזמן שנקבע עבר</Label>
          {/* Deliberately not red, with no day count and no word for "late". The person reading
              this already knows they did not run it. Two ways forward and no blame — see the
              header: an embarrassed trainee stops opening the app, which is the failure the
              whole reminder exists to prevent. */}
          <Note>
            {/* No leading `ו`. The first draft read `יום ו׳ · 07:00 — ולא נרשם טסט`, which is a
                conjunction with nothing before it: broken Hebrew, and invisible to every check
                in the gate. */}
            {confirmedLabel
              ? <>הטסט נקבע ל<bdi dir="ltr">{confirmedLabel}</bdi> ולא נרשם. </>
              : <>הטסט לא נרשם. </>}
            אם ביצעת אותו, אפשר להזין את המרחק והזמן למטה. אם לא יצא, בקש זמן חדש ונקבע מחדש —
            אין בעיה.
          </Note>
          <div className="pt-1.5">
            <button type="button" onClick={onAskOther} disabled={busy} className={PRIMARY}>
              {busy ? 'שולח…' : 'בקש זמן חדש'}
            </button>
          </div>
        </>
      )}

      {state === 'other_requested' && (
        <>
          <Label>ביקשת זמן אחר</Label>
          <Note>
            הבקשה שלך נשלחה למאמן והוא יציע זמנים חדשים. עד אז אין מה לעשות — הטסט לא נחשב
            כמשהו שפספסת.
            {invitation.requestedNote && (
              <>
                {' '}
                <span className="text-ink-500">מה שכתבת: “{invitation.requestedNote}”</span>
              </>
            )}
          </Note>
        </>
      )}

      {state === 'expired' && (
        <>
          <Label>הזמנים שהוצעו עברו</Label>
          {/* Nobody refused anything. Saying so is what keeps the next tap possible. */}
          <Note>הזמנים שהוצעו לך כבר עברו. בקש זמנים חדשים ונקבע את הטסט מחדש.</Note>
          <div className="pt-1.5">
            <button type="button" onClick={onAskOther} disabled={busy} className={PRIMARY}>
              {busy ? 'שולח…' : 'בקש זמנים חדשים'}
            </button>
          </div>
        </>
      )}

      <Label>מה קורה אחרי</Label>
      <Note>
        אופר מנתח את הטסט, קובע לך ספים וקצבים, משבץ אותך לדבוקה וכותב את התוכנית הראשונה.
        תקבל סיכום כתוב.
      </Note>
    </div>
  );
}
