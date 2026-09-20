'use client';

import { notFound } from 'next/navigation';
import { useMemo, useState } from 'react';

import { israelToday } from '@/lib/utils';
import {
  buildPaymentBoard, mentorPayouts, perTraineeEconomics, periodOf,
  type CoachPayRecord, type PaymentRecord, type TraineeBillingInput,
} from '@/lib/academy/payments';
import { PaymentsView } from '@/components/academy/AcademyPayments';

// ── Login-free preview of the payments board ─────────────────────────────────
//
// The manager tab is the strictest gate in the academy — what one trainee pays and what a mentor
// earns are the two facts no colleague is entitled to — which also meant it was the one screen
// that could not be looked at without real data in front of you. `PaymentsView` was written to
// take a computed board for exactly this, and then nothing ever mounted it.
//
// Every number and every chip below comes out of the REAL `buildPaymentBoard`, `mentorPayouts`
// and `perTraineeEconomics`. That is what makes the page worth auditing: a row in the wrong
// section here is a bug, not a fixture typo. What it is for:
//
//  1. **`paid` beats every other state.** Noa's card failed after she paid, and her row still
//     reads שולם. Asking somebody for money they already paid is the mistake here that damages a
//     relationship, so the collected month wins over the arrangement that broke afterwards.
//  2. **Red is only for money the club is not collecting from somebody it is actively coaching.**
//     A link sent yesterday is grey — the process working. Somebody who left is grey too.
//  3. **`coachedForFree` is a gap between two tables**, never a stored flag, and it needs a join
//     date to be aged against. Uri has one and is in the red box; the trainee who joined this
//     week is not, because a red box he has not earned is how the box stops being read.
//  4. **A missing mentor rate renders לא הוגדר, never a zero.** A zero in a payout column is how
//     somebody gets left out of a payment run.
//
// Deterministic, like the rest of this directory: dates are counted back from the Israel calendar
// day rather than built from `Date.now()` at module scope, which would render one thing on the
// server and another in the browser and make React throw out the tree.
//
// Development only. In production the route does not exist.

const DAY = 24 * 3_600_000;

/** The Israel calendar day `daysAgo` before today, as 'YYYY-MM-DD'. */
function day(daysAgo: number): string {
  return israelToday(new Date(Date.parse(israelToday()) - daysAgo * DAY));
}

/** An instant on that day, for the timestamp columns. */
function at(daysAgo: number, hhmm = '10:00'): string {
  return new Date(`${day(daysAgo)}T${hhmm}:00+03:00`).toISOString();
}

const MENTORS = { dani: 'דני', yossi: 'יוסי' };

function trainee(
  athleteId: string,
  name: string,
  bandNumber: number | null,
  coachId: keyof typeof MENTORS,
  academySinceDaysAgo: number,
  billing: TraineeBillingInput['billing'],
): TraineeBillingInput {
  return {
    athleteId, name, bandNumber,
    coachId, coachName: MENTORS[coachId],
    academySince: day(academySinceDaysAgo),
    billing,
  };
}

/** One trainee per state the board can render, deliberately out of order so the sort works. */
const TRAINEES: TraineeBillingInput[] = [
  // Paid by standing order, read off a GO email. The calm row.
  trainee('t1', 'Dor Alon', 7, 'dani', 210, {
    athleteId: 't1', status: 'active', monthlyAmountIls: 800,
    linkSentAt: at(205), activatedAt: at(203), failedAt: null, cancelledAt: null, note: null,
  }),
  // Paid this month, and the card died afterwards. `paid` wins: see note 1 above.
  trainee('t2', 'Noa Shemesh', 6, 'dani', 180, {
    athleteId: 't2', status: 'failed', monthlyAmountIls: 800,
    linkSentAt: at(175), activatedAt: at(173), failedAt: at(4), cancelledAt: null,
    note: 'כרטיס פג תוקף — נשלחה הודעה',
  }),
  // A live standing order with nothing recorded for this month. The list the screen exists for.
  trainee('t3', 'Avi Barak', 5, 'yossi', 150, {
    athleteId: 't3', status: 'active', monthlyAmountIls: 800,
    linkSentAt: at(145), activatedAt: at(143), failedAt: null, cancelledAt: null, note: null,
  }),
  // The link went out yesterday. Grey, because this is the process working.
  trainee('t4', 'Michal Cohen', 8, 'dani', 6, {
    athleteId: 't4', status: 'link_sent', monthlyAmountIls: 800,
    linkSentAt: at(1), activatedAt: null, failedAt: null, cancelledAt: null, note: null,
  }),
  // Sent five days ago and never answered — past LINK_STALE_DAYS, so red, and free coaching.
  trainee('t5', 'Yael Peretz', 7, 'yossi', 30, {
    athleteId: 't5', status: 'link_sent', monthlyAmountIls: 800,
    linkSentAt: at(5), activatedAt: null, failedAt: null, cancelledAt: null, note: null,
  }),
  // Training for six weeks with no link ever sent. The quiet one that costs the most.
  trainee('t6', 'Uri Gal', 4, 'dani', 44, null),
  // Joined this week, no link yet: NOT a red box. Normal, and still normal tomorrow.
  trainee('t7', 'Tamar Bar', null, 'yossi', 2, null),
  // Left. Grey, and deliberately not counted as free coaching.
  trainee('t8', 'Gil Adar', 6, 'dani', 400, {
    athleteId: 't8', status: 'cancelled', monthlyAmountIls: 800,
    linkSentAt: at(395), activatedAt: at(393), failedAt: null, cancelledAt: at(20),
    note: 'עבר לאימון עצמאי',
  }),
];

const PAYMENTS: PaymentRecord[] = [
  { athleteId: 't1', period: periodOf(day(0)), amountIls: 800, source: 'go_email' },
  { athleteId: 't2', period: periodOf(day(0)), amountIls: 800, source: 'manual' },
];

/** Dani is paid per trainee; nobody has recorded what Yossi is paid. */
const RATES: CoachPayRecord[] = [
  { coachId: 'dani', perTraineeIls: 120, monthlyFlatIls: null, active: true },
];

export default function PreviewAcademyPayments() {
  if (process.env.NODE_ENV === 'production') notFound();

  // The month is state so the arrows do something: a payments screen where the month cannot move
  // is the spreadsheet again, and "did he pay" means nothing without saying which month.
  const [period, setPeriod] = useState(() => periodOf(day(0)));

  const board = useMemo(
    () => buildPaymentBoard({ trainees: TRAINEES, payments: PAYMENTS, period, today: day(0) }),
    [period],
  );
  const payouts = useMemo(() => mentorPayouts({ rows: board.rows, rates: RATES }), [board.rows]);

  // The per-trainee arithmetic, off the fee the fixtures actually carry and the mentor cost the
  // payout table computed — not a second copy of either.
  const economics = useMemo(() => {
    const fee = board.rows.find(r => r.monthlyAmountIls)?.monthlyAmountIls ?? 0;
    const dani = payouts.find(p => p.coachId === 'dani');
    return perTraineeEconomics({ monthlyAmountIls: fee, mentorIls: dani?.perTraineeIls ?? 0 });
  }, [board.rows, payouts]);

  const shiftPeriod = (delta: number) => {
    const [year, month] = period.split('-').map(Number);
    setPeriod(periodOf(new Date(Date.UTC(year, month - 1 + delta, 1))));
  };

  return (
    <div className="min-h-screen bg-page px-3 py-4" dir="rtl">
      <div className="mx-auto max-w-[430px] space-y-3">
        <header className="pt-2">
          <h1 className="text-xl font-bold text-ink-900">תשלומים ורווחיות</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
            תצוגה מקדימה בלי התחברות, על נתוני דמה. כל המצבים מחושבים במנוע האמיתי: מי שילם, מי
            מאומן בחינם, ומה נשאר מהתשלום. החצים מזיזים חודש — בחודש אחר אין תשלומים רשומים,
            וזה בכוונה.
          </p>
        </header>
        <PaymentsView
          board={board}
          payouts={payouts}
          economics={economics}
          economicsBasis={{
            feesRecorded: board.rows.filter(r => r.monthlyAmountIls).length,
            trainees: board.rows.length,
            mentorTotalIls: payouts.reduce((n, p) => n + p.payoutIls, 0),
          }}
          ratesMissing={payouts.some(p => p.rateMissing)}
          onShiftMonth={shiftPeriod}
        />
      </div>
    </div>
  );
}
