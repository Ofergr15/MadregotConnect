'use client';

import { useEffect, useMemo, useState } from 'react';
import { MessageSquareQuote } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { protocolLabel, reminderPromise } from '@/lib/academy/testInvite';
import { COMMON_HOURS, buildOffer, dayOptions, offerSummary } from '@/lib/academy/offerSlots';
// The hour row and the day grid live in `OfferTimesPicker`, shared with the test round: every
// number in them was measured, and a second copy would drift into a 42px tap target.
import { Chip, Field, OfferTimesPicker, toggleDay } from './OfferTimesPicker';

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

        <OfferTimesPicker
          time={time}
          onTimeChange={setTime}
          days={days}
          onToggleDay={day => setDays(prev => toggleDay(prev, day))}
          options={options}
        />

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
