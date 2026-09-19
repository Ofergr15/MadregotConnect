'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { apiHeaders } from '@/lib/api';
import { protocolLabel, reminderPromise } from '@/lib/academy/testInvite';
import { COMMON_HOURS, buildOffer, dayOptions, offerSummary } from '@/lib/academy/offerSlots';
import {
  buildRound,
  roundSummary,
  type RoundCandidate,
  type RoundOutcome,
} from '@/lib/academy/testRound';
import { Chip, Field, OfferTimesPicker, toggleDay } from './OfferTimesPicker';

/**
 * `שבץ סבב` — one tap, one set of times, everybody whose numbers have gone stale.
 *
 * The registry already prints the sentence this acts on: "4 trainees have not tested in over four
 * months, and their plans are running on old data." Until now the only way to act on it was the
 * invitation sheet, once per person, and a sentence that costs four sheets to answer is a sentence
 * that gets read and left.
 *
 * ── THE LIST IS SHOWN BEFORE IT IS SENT, BY NAME ─────────────────────────────────────────
 *
 * A bulk action whose preview is a number is a bulk action nobody can check. Every person in the
 * round is named, with why they are in it, and the count in the confirm line is that list's length
 * rather than a separately computed figure. The rule itself is in `lib/academy/testRound.ts`, so
 * what the screen promises and what the route writes come from one place.
 *
 * ── WHO IS ALREADY INVITED COMES FROM THE BOARD ──────────────────────────────────────────
 *
 * Read once on opening, from the board route the coach's own screen uses. Somebody with an open
 * invitation is not re-offered: it would overwrite a time they may already have confirmed, and both
 * reminders move with that time.
 *
 * If that read fails the sheet still works. The round's write refuses a duplicate per athlete and
 * reports it, so the worst case is a smaller round than the preview promised — and the sheet says
 * so rather than pretending it checked.
 */

const PROTOCOLS = ['30min', '2000m'];

export function TestRoundSheet({
  open,
  onOpenChange,
  candidates,
  protocol: initialProtocol = '30min',
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The registry's own rows. Staleness arrives decided; nothing here recomputes it. */
  candidates: readonly RoundCandidate[];
  protocol?: string;
  /** Called after a round is written, so the screen behind can re-read itself. */
  onDone?: () => void;
}) {
  const [protocol, setProtocol] = useState(initialProtocol);
  const [time, setTime] = useState(COMMON_HOURS[1]);
  const [days, setDays] = useState<string[]>([]);
  // The clock is read once per opening and held: day chips built from one instant and an offer
  // sent against another is, at 23:59, an offer for yesterday.
  const [now, setNow] = useState('');

  const [openInvitations, setOpenInvitations] = useState<Set<string>>(new Set());
  /** True when we could not find out who is already invited. See the header. */
  const [uncheckedInvitations, setUnchecked] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RoundOutcome | null>(null);

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch('/api/academy/test-invitation/board', { headers: await apiHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data?.rows)) { setUnchecked(true); return; }
      setUnchecked(false);
      setOpenInvitations(new Set(
        data.rows
          .map((r: { invite?: { athleteId?: string } }) => String(r?.invite?.athleteId || ''))
          .filter((id: string) => id !== ''),
      ));
    } catch {
      setUnchecked(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setDays([]);
    setNow(new Date().toISOString());
    setProtocol(initialProtocol);
    setError(null);
    setOutcome(null);
    setOpenInvitations(new Set());
    void loadBoard();
  }, [open, initialProtocol, loadBoard]);

  const options = useMemo(() => (now ? dayOptions(now) : []), [now]);
  const slots = useMemo(() => (now ? buildOffer(days, time, now) : []), [days, time, now]);
  const round = useMemo(() => buildRound(candidates, openInvitations), [candidates, openInvitations]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/academy/test-round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({
          athleteIds: round.members.map(m => m.athleteId),
          protocol,
          slots,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 503
          ? 'טבלת ההזמנות עוד לא הוקמה במסד הנתונים.'
          : 'שליחת הסבב נכשלה. אפשר לנסות שוב — מי שכבר קיבל הזמנה לא יקבל שנייה.');
        return;
      }
      setOutcome(data as RoundOutcome);
      onDone?.();
    } catch {
      setError('שליחת הסבב נכשלה. אפשר לנסות שוב — מי שכבר קיבל הזמנה לא יקבל שנייה.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="שיבוץ סבב טסטים">
      <div className="space-y-3 px-4 pb-4" dir="rtl">
        {outcome ? (
          <RoundResult outcome={outcome} round={round} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            {/* WHO, first and by name. A preview that is only a number cannot be checked. */}
            <Field label={`מי בסבב · ${round.members.length}`}>
              {round.members.length === 0 ? (
                <p className="rounded-card bg-page px-2.5 py-2 text-[11px] leading-relaxed text-ink-500">
                  {roundSummary(round, slots.length)}
                </p>
              ) : (
                <ul className="space-y-1">
                  {round.members.map(m => (
                    <li
                      key={m.athleteId}
                      className="flex items-center justify-between gap-2 rounded-card bg-page px-2.5 py-2"
                    >
                      <bdi dir="ltr" className="truncate text-xs font-semibold text-ink-900">{m.name}</bdi>
                      <span className="shrink-0 text-[11px] text-ink-400">
                        {m.reason === 'never_tested'
                          ? 'אין טסט'
                          : <>לפני <bdi dir="ltr">{monthsOf(m.ageDays)}</bdi> חודשים</>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Field>

            {/* Who is NOT in it, as a count with the reason. Named would be a second list as long
                as the first, and the answer "because they have a current test" is the same for all
                of them — but a coach who expected eighteen and sees four has to be able to see
                where the other fourteen went, or the round looks broken. */}
            {round.skipped.length > 0 && (
              <p className="px-1 text-[11px] leading-relaxed text-ink-400">
                {skippedLine(round.skipped.filter(s => s.reason === 'tested_recently').length,
                  round.skipped.filter(s => s.reason === 'already_invited').length)}
              </p>
            )}

            {uncheckedInvitations && (
              <p className="px-1 text-[11px] leading-relaxed text-band-2-ink">
                לא הצלחנו לבדוק מי כבר קיבל הזמנה. מי שיש לו הזמנה פתוחה יישאר איתה — היא לא תידרס.
              </p>
            )}

            <Field label="איזה טסט">
              <div className="flex gap-1.5">
                {PROTOCOLS.map(p => (
                  <Chip key={p} selected={protocol === p} onClick={() => setProtocol(p)}>
                    {protocolLabel(p)}
                  </Chip>
                ))}
              </div>
            </Field>

            {/* The same times for everybody, which is what makes this a round. */}
            <OfferTimesPicker
              time={time}
              onTimeChange={setTime}
              days={days}
              onToggleDay={day => setDays(prev => toggleDay(prev, day))}
              options={options}
            />

            <p className="rounded-card bg-page px-2.5 py-2 text-[11px] leading-relaxed text-ink-700" dir="auto">
              {slots.length === 0
                ? 'בחר יום אחד לפחות.'
                : `${protocolLabel(protocol)} · ${offerSummary(slots)}`}
            </p>
            <p className="px-1 text-[11px] leading-relaxed text-ink-400">{reminderPromise()}</p>

            {error && <p className="px-1 text-[11px] text-accent-red-ink">{error}</p>}

            {/* The count is in the button, because the count is the thing being confirmed: this
                tap reaches N people and no other button on these screens does. */}
            <button
              type="button"
              onClick={() => { void send(); }}
              disabled={busy || slots.length === 0 || round.members.length === 0}
              className="min-h-[48px] w-full rounded-card bg-brand-600 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy
                ? 'שולח…'
                : round.members.length === 1
                  ? 'שלח הזמנה אחת'
                  : <>שלח <bdi dir="ltr">{round.members.length}</bdi> הזמנות</>}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** `187` → `6`. Months, because nobody says "187 days since your last test". */
function monthsOf(ageDays: number | null): number {
  return Math.max(1, Math.round((ageDays ?? 0) / 30));
}

function skippedLine(current: number, invited: number): string {
  const parts: string[] = [];
  if (current > 0) parts.push(current === 1 ? 'מתאמן אחד עם טסט עדכני' : `${current} עם טסט עדכני`);
  if (invited > 0) parts.push(invited === 1 ? 'אחד עם הזמנה פתוחה' : `${invited} עם הזמנה פתוחה`);
  return `לא בסבב: ${parts.join(' · ')}.`;
}

/**
 * What happened, after the fact — and it is not always "sent".
 *
 * A round is N independent writes, so the honest report names the ones that did not land. The
 * commonest reason is benign (somebody was invited between opening this sheet and sending it) and
 * the recovery is to run the round again, which is safe: whoever succeeded now has an open
 * invitation and is skipped.
 */
function RoundResult({
  outcome, round, onClose,
}: {
  outcome: RoundOutcome;
  round: ReturnType<typeof buildRound>;
  onClose: () => void;
}) {
  const clashed = outcome.failed.filter(f => f.reason === 'already_invited');
  const broke = outcome.failed.filter(f => f.reason !== 'already_invited');
  const nameOf = (athleteId: string) =>
    round.members.find(m => m.athleteId === athleteId)?.name ?? athleteId;

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-card bg-accent-900/10 px-3 py-2.5 text-xs text-accent-900">
        <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="font-bold">
          {outcome.invited.length === 1
            ? 'נשלחה הזמנה אחת.'
            : <>נשלחו <bdi dir="ltr">{outcome.invited.length}</bdi> הזמנות.</>}
        </span>
      </p>

      {clashed.length > 0 && (
        <p className="px-1 text-[11px] leading-relaxed text-ink-500">
          {clashed.length === 1 ? 'למתאמן אחד' : <>ל<bdi dir="ltr">{clashed.length}</bdi> מתאמנים</>}
          {' '}כבר הייתה הזמנה פתוחה, והיא נשארה כפי שהיא:{' '}
          {clashed.map((f, i) => (
            <span key={f.athleteId}>
              {i > 0 && ', '}
              <bdi dir="ltr" className="whitespace-nowrap">{nameOf(f.athleteId)}</bdi>
            </span>
          ))}
        </p>
      )}

      {broke.length > 0 && (
        <p className="px-1 text-[11px] leading-relaxed text-accent-red-ink">
          {broke.length === 1 ? 'הזמנה אחת נכשלה' : <><bdi dir="ltr">{broke.length}</bdi> הזמנות נכשלו</>}
          {' '}— אפשר לשבץ סבב שוב, ומי שכבר קיבל הזמנה לא יקבל שנייה.
        </p>
      )}

      <button
        type="button"
        onClick={onClose}
        className="min-h-[48px] w-full rounded-card bg-page text-sm font-bold text-ink-700"
      >
        סגור
      </button>
    </div>
  );
}
