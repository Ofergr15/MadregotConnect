'use client';

import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MAX_OFFERED_SLOTS, COMMON_HOURS, type DayOption } from '@/lib/academy/offerSlots';

/**
 * One hour, several days — the shape of every test offer this app makes.
 *
 * Lifted out of `InviteToTestSheet` when the test round needed the same picker. Not to save lines:
 * every number in this file was measured rather than chosen (seven columns over Apple's 44px floor
 * at 375px, the negative margin that pays for it, the 16px input that stops iOS zooming inside a
 * sheet), and the bidi rules were learned one wrong render at a time. A second copy would start
 * identical and drift, and the drift would show up as a 42px tap target on the screen nobody
 * re-audited.
 *
 * ── WHY NOT THREE DATE-TIME PICKERS ──────────────────────────────────────────────────────
 *
 * A coach has an hour they test at — before work, or after it — and the flexibility is in the DAY:
 * "Tuesday or Thursday at seven, whichever suits you". Three independent pickers would model a
 * choice nobody makes and give three chances to fat-finger a month on a phone.
 *
 * For a ROUND the same shape says something stronger: everybody gets the same times, which is what
 * makes it a round rather than eighteen appointments.
 */

/**
 * Sunday first, because an Israeli week starts on Sunday and the whole app's week pager already
 * does (`sundayOf`). `ש` for Saturday rather than the letter-pair `שב`: one character per column
 * is what keeps seven columns fitting at 375px.
 */
const WEEKDAY_INITIALS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 px-1 text-[11px] font-semibold text-ink-500">{label}</p>
      {children}
    </div>
  );
}

export function Chip({
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

export function OfferTimesPicker({
  time,
  onTimeChange,
  days,
  onToggleDay,
  options,
  maxDays = MAX_OFFERED_SLOTS,
}: {
  time: string;
  onTimeChange: (time: string) => void;
  /** The chosen `YYYY-MM-DD` days. Held by the caller, which is what sends them. */
  days: readonly string[];
  onToggleDay: (day: string) => void;
  /** From `dayOptions(now)`, so the clock is read once per opening by the caller and held. */
  options: readonly DayOption[];
  maxDays?: number;
}) {
  return (
    <>
      <Field label="באיזו שעה">
        <div className="flex flex-wrap items-center gap-1.5">
          {COMMON_HOURS.map(h => (
            <Chip key={h} selected={time === h} onClick={() => onTimeChange(h)}>
              <bdi dir="ltr">{h}</bdi>
            </Chip>
          ))}
          {/* A real `<input type="time">`, because the chips are a shortcut and not the list of
              possible hours.
              `dir="ltr"`: in the RTL row it rendered `07:00` as `00:07`, which does not read as a
              field at all — it reads as a fifth hour option at some impossible time. Same bidi
              rule as every other bare number on these screens.
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
              onChange={e => onTimeChange(e.target.value)}
              aria-label="שעה אחרת"
              // Full height of its own pill: the tap area is the INPUT, not the border around it,
              // and a 26px line of text inside a 44px box is a 26px target.
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
      <Field label={`באילו ימים · עד ${maxDays}`}>
        {/* `gap-0.5` and a negative margin, both measured rather than chosen: seven columns inside
            the sheet's own padding came out 42px wide, and the audit probes tap targets rather
            than reading the box, so 42 is 42. A 2px gap and 4px clawed back from the padding is
            what puts every cell over Apple's 44px floor at 375px. */}
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
                onClick={() => onToggleDay(d.day)}
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
    </>
  );
}

/**
 * The oldest choice drops out rather than the tap being refused.
 *
 * A coach replacing their third choice should not have to work out which chip to unpick first.
 * Shared so the round and the single invitation cannot disagree about what the cap means.
 */
export function toggleDay(days: readonly string[], day: string, max = MAX_OFFERED_SLOTS): string[] {
  return days.includes(day) ? days.filter(d => d !== day) : [...days, day].slice(-max);
}
