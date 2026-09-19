'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock, MessageSquareQuote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import { protocolLabel, reminderPromise } from '@/lib/academy/testInvite';
import {
  COMMON_HOURS,
  MAX_OFFERED_SLOTS,
  buildOffer,
  dayOptions,
  offerSummary,
} from '@/lib/academy/offerSlots';

/**
 * Offering somebody a test.
 *
 * The write the whole invitation slice was missing. The trainee's card, the note sheet, the
 * reminders and the coach's board were all built around a row that only a hand-run `POST` could
 * create — a feature with a reader and no author. This is the author.
 *
 * ── ONE HOUR, SEVERAL DAYS ───────────────────────────────────────────────────────────────
 *
 * Not three date-time pickers. A coach has an hour they test at — before work, or after it — and
 * the flexibility is in the DAY: "Tuesday or Thursday at seven, whichever suits you". Three
 * independent pickers would model a choice nobody makes and give three chances to fat-finger a
 * month on a phone. One hour, up to three days, and the cross-product is the offer.
 *
 * ── AND THE TRAINEE'S OWN WORDS ARE ON THE SCREEN WHILE PICKING ───────────────────────────
 *
 * When this opens on somebody who asked for another time, their note is shown here, not just on
 * the board behind the sheet. "Works shifts until the 20th, mornings only" is the single fact the
 * new times should be chosen from, and a coach who has to close the sheet to re-read it will
 * instead offer three more evenings from the same guess — which is the loop that loses the
 * candidate, and the loop `requested_note` was added to break.
 */

export interface InviteTarget {
  athleteId: string;
  name: string;
  /**
   * Set when this athlete already has an open invitation. Then it is a re-offer — `PATCH
   * { action: 'offer' }` — because migration 112 allows one open row per athlete and closing the
   * old one to create a new one would throw away the note explaining why the first times failed.
   */
  invitationId?: string | null;
  protocol?: string;
  /** What they wrote when they asked for another time. */
  note?: string | null;
}

const PROTOCOLS = ['30min', '2000m'];

/**
 * Sunday first, because an Israeli week starts on Sunday and the whole app's week pager already
 * does (`sundayOf`). `ש` for Saturday rather than the letter-pair `שב`: one character per column
 * is what keeps seven columns fitting at 375px.
 */
const WEEKDAY_INITIALS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

export function InviteToTestSheet({
  open,
  onOpenChange,
  target,
  onSend,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: InviteTarget | null;
  /**
   * Send it. The caller writes and reloads; this sheet never touches the network — the same split
   * `AskOtherTimeSheet` uses, and the reason the preview can render it without a session and
   * without a single tap being able to post an invitation to a real person.
   */
  onSend: (offer: { protocol: string; slots: string[] }) => void;
  busy?: boolean;
  /** Already-Hebrew failure text from the caller, shown above the button that caused it. */
  error?: string | null;
}) {
  const reOffer = !!target?.invitationId;

  const [protocol, setProtocol] = useState('30min');
  const [time, setTime] = useState(COMMON_HOURS[1]);
  const [days, setDays] = useState<string[]>([]);

  // The clock is read once per opening and held, so the day chips cannot be built from one
  // instant and the offer sent against another — at 23:59 that is an offer for yesterday.
  const [now, setNow] = useState('');

  useEffect(() => {
    if (!open) return;
    setDays([]);
    setNow(new Date().toISOString());
    setProtocol(target?.protocol || '30min');
  }, [open, target?.protocol]);

  const options = useMemo(() => (now ? dayOptions(now) : []), [now]);
  const slots = useMemo(() => (now ? buildOffer(days, time, now) : []), [days, time, now]);

  const toggle = (day: string) => {
    setDays(prev => (prev.includes(day)
      ? prev.filter(d => d !== day)
      // Oldest out rather than refusing the tap: a coach replacing their third choice should not
      // have to work out which chip to unpick first.
      : [...prev, day].slice(-MAX_OFFERED_SLOTS)));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={reOffer ? 'הצעת זמנים חדשים' : 'הזמנה לטסט'}>
      <div className="space-y-3 px-4 pb-4" dir="rtl">
        <p className="text-xs text-ink-700">
          <bdi dir="ltr" className="font-bold">{target?.name ?? ''}</bdi>
          {' — '}
          {reOffer ? 'הזמנים שהוצעו לא התאימו.' : protocolLabel(protocol)}
        </p>

        {/* Their own words, here and not only on the board behind the sheet. See the header. */}
        {target?.note && (
          <p className="flex items-start gap-1.5 rounded-card bg-page px-2.5 py-2 text-[11px] leading-relaxed text-ink-700" dir="auto">
            <MessageSquareQuote className="mt-0.5 h-3 w-3 shrink-0 text-ink-400" />
            <span>{target.note}</span>
          </p>
        )}

        {/* Only when creating. A re-offer keeps the protocol it was sent with: changing it is
            changing the measurement, and the route's `offer` deliberately cannot. */}
        {!reOffer && (
          <Field label="איזה טסט">
            <div className="flex gap-1.5">
              {PROTOCOLS.map(p => (
                <Chip key={p} selected={protocol === p} onClick={() => setProtocol(p)}>
                  {protocolLabel(p)}
                </Chip>
              ))}
            </div>
          </Field>
        )}

        <Field label="באיזו שעה">
          <div className="flex flex-wrap items-center gap-1.5">
            {COMMON_HOURS.map(h => (
              <Chip key={h} selected={time === h} onClick={() => setTime(h)}>
                <bdi dir="ltr">{h}</bdi>
              </Chip>
            ))}
            {/* A real `<input type="time">`, because the chips are a shortcut and not the list of
                possible hours.
                `dir="ltr"`: in the RTL row it rendered `07:00` as `00:07`, which does not read as
                a field at all — it reads as a fifth hour option at some impossible time. Same
                bidi rule as every other bare number on these screens.
                Outlined rather than filled, and with a clock, because the filled pills next to it
                are CHOICES: a field that looks exactly like them is a choice nobody can make.
                `text-base`: under 16px iOS Safari zooms the page on focus and does not zoom back
                out, which inside a sheet puts the send button off-screen behind the keyboard. */}
            <span className="flex min-h-[44px] items-center gap-1.5 rounded-pill border border-ink-300 px-3">
              <Clock className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <input
                type="time"
                dir="ltr"
                value={time}
                onChange={e => setTime(e.target.value)}
                aria-label="שעה אחרת"
                // Full height of its own pill: the tap area is the INPUT, not the border around
                // it, and a 26px line of text inside a 44px box is a 26px target.
                className="min-h-[44px] bg-transparent text-base tabular-nums text-ink-900"
              />
            </span>
          </div>
        </Field>

        {/* A calendar grid and not a row of chips, which is what the first version was.
            Fourteen chips reading `יום א׳ 20.09` need the date — each weekday appears twice in a
            fortnight — and at chip size that date came out at 10px, the design's density floor,
            fourteen times over. A grid puts the weekday in a header that is written ONCE, which
            leaves the cell holding nothing but the number, at a readable size and 48px square. */}
        <Field label={`באילו ימים · עד ${MAX_OFFERED_SLOTS}`}>
          {/* `gap-0.5` and a negative margin, both measured rather than chosen: seven columns
              inside the sheet's own padding came out 42px wide, and the audit probes tap targets
              rather than reading the box, so 42 is 42. A 2px gap and 4px clawed back from the
              padding is what puts every cell over Apple's 44px floor at 375px. */}
          <div className="-mx-1 grid grid-cols-7 gap-0.5" role="group">
            {WEEKDAY_INITIALS.map((letter, i) => (
              <div key={i} className="pb-0.5 text-center text-[11px] font-semibold text-ink-400">
                {letter}
              </div>
            ))}
            {/* Empty cells before the first offerable day, so every column really is one weekday
                down the whole grid. Without them "Tuesday" would mean a different column in the
                second row and the header would be a lie. */}
            {options.length > 0 && Array.from({ length: options[0].weekday }, (_, i) => (
              <div key={`pad-${i}`} aria-hidden />
            ))}
            {options.map(d => {
              const selected = days.includes(d.day);
              return (
                <button
                  key={d.day}
                  type="button"
                  onClick={() => toggle(d.day)}
                  aria-pressed={selected}
                  // The accessible name is the whole date, because `20` alone is not a day.
                  aria-label={`${d.label} ${d.date}`}
                  className={cn(
                    'min-h-[48px] rounded-card text-sm font-bold tabular-nums',
                    selected ? 'bg-brand-600 text-white' : 'bg-page text-ink-700',
                  )}
                >
                  <bdi dir="ltr">{d.dayOfMonth}</bdi>
                </button>
              );
            })}
          </div>
        </Field>

        {/* What will actually be written, read back in the trainee's words. The confirm line is
            worth its own row here and not just a button label, because every chip above is a
            weekday and this is the only place the offer appears as appointments. */}
        <p className="rounded-card bg-page px-2.5 py-2 text-[11px] leading-relaxed text-ink-700" dir="auto">
          {slots.length === 0
            ? 'בחר יום אחד לפחות.'
            : `${protocolLabel(protocol)} · ${offerSummary(slots)}`}
        </p>
        <p className="px-1 text-[11px] leading-relaxed text-ink-400">{reminderPromise()}</p>

        {error && <p className="px-1 text-[11px] text-accent-red-ink">{error}</p>}

        {/* Disabled only while there is genuinely nothing to send — no day picked — which the
            line above says in words rather than leaving the button dead for no stated reason. */}
        <button
          type="button"
          onClick={() => onSend({ protocol, slots })}
          disabled={busy || slots.length === 0 || !target}
          className="min-h-[48px] w-full rounded-card bg-brand-600 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? 'שולח…' : reOffer ? 'שלח זמנים חדשים' : 'שלח הזמנה'}
        </button>
      </div>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 px-1 text-[11px] font-semibold text-ink-500">{label}</p>
      {children}
    </div>
  );
}

function Chip({
  selected, onClick, children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'min-h-[44px] rounded-pill px-3 text-xs font-semibold',
        selected ? 'bg-brand-600 text-white' : 'bg-page text-ink-700',
      )}
    >
      {children}
    </button>
  );
}
