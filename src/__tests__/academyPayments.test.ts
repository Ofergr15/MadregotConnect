import { describe, expect, it } from 'vitest';
import {
  LINK_STALE_DAYS, PARTNER_SHARE, VAT_RATE,
  buildPaymentBoard, daysSince, mentorLoadSimulation, mentorPayouts,
  paymentReminderText, paymentStateFor, perTraineeEconomics, periodOf,
  type BillingRecord, type PaymentRecord, type TraineeBillingInput,
} from '@/lib/academy/payments';

/**
 * Section 6 — payment status beside coaching status.
 *
 * The arithmetic is trivial and the judgements are not, so this file is almost entirely about
 * the judgements:
 *
 *  - **Never chasing somebody who paid.** The one mistake here that damages a relationship.
 *  - **Never missing somebody being coached for free.** The one that costs money.
 *  - **Never colouring a state that is working.** A link sent yesterday is the process, not an
 *    alarm, and a cancelled arrangement is somebody who left.
 *  - **Never printing a zero where a rate is missing.** That is how a mentor gets underpaid.
 */

const TODAY = '2026-09-20T09:00:00.000Z';
const PERIOD = '2026-09-01';

function billing(over: Partial<BillingRecord> = {}): BillingRecord {
  return {
    athleteId: 'a1', status: 'active', monthlyAmountIls: 800,
    linkSentAt: null, activatedAt: '2026-03-01T00:00:00.000Z', failedAt: null, cancelledAt: null, note: null,
    ...over,
  };
}

function trainee(over: Partial<TraineeBillingInput> = {}): TraineeBillingInput {
  return {
    athleteId: 'a1', name: 'Dor Alon', bandNumber: 7, coachId: 'c1', coachName: 'Dani',
    academySince: '2026-02-01', billing: billing(), ...over,
  };
}

function paid(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return { athleteId: 'a1', period: PERIOD, amountIls: 800, source: 'manual', ...over };
}

describe('the month a payment belongs to', () => {
  it('normalises any date to the first of its month', () => {
    expect(periodOf('2026-09-14')).toBe('2026-09-01');
    expect(periodOf('2026-09-01')).toBe('2026-09-01');
    expect(periodOf('2026-12-31T22:00:00.000Z')).toBe('2026-12-01');
  });

  it('reads the first of the month in UTC, not local time', () => {
    // The period is a label on a month. A local-midnight read of '2026-10-01' east of Greenwich
    // lands in September, which would file October's payment under September and make one month
    // look collected twice and the next look unpaid.
    expect(periodOf('2026-10-01')).toBe('2026-10-01');
    expect(periodOf('2026-10-01T00:00:00.000Z')).toBe('2026-10-01');
  });

  it('says nothing rather than guessing about an unparseable date', () => {
    expect(periodOf('not a date')).toBe('');
    expect(daysSince(null, TODAY)).toBeNull();
    expect(daysSince('nonsense', TODAY)).toBeNull();
  });
});

describe('what state a trainee fee is in', () => {
  it('a paid month is paid, whatever happened to the standing order afterwards', () => {
    // The single most damaging error on this screen is asking somebody for money they already
    // paid, so a collected month wins over a card that expired in the meantime.
    const state = paymentStateFor(trainee({ billing: billing({ status: 'failed', failedAt: TODAY }) }), {
      paid: paid(), today: TODAY,
    });
    expect(state.state).toBe('paid');
    expect(state.coachedForFree).toBe(false);
  });

  it('a live standing order with no payment row is unpaid, which the database has no word for', () => {
    expect(paymentStateFor(trainee(), { paid: null, today: TODAY }).state).toBe('unpaid');
  });

  it('a link sent yesterday is waiting, not an alarm', () => {
    const fresh = paymentStateFor(
      trainee({ billing: billing({ status: 'link_sent', activatedAt: null, linkSentAt: '2026-09-19T09:00:00.000Z' }) }),
      { paid: null, today: TODAY },
    );
    expect(fresh.state).toBe('link_pending');
    expect(fresh.coachedForFree).toBe(false);
  });

  it('a link nobody answered is the red box', () => {
    const stale = paymentStateFor(
      trainee({ billing: billing({ status: 'link_sent', activatedAt: null, linkSentAt: '2026-09-15T09:00:00.000Z' }) }),
      { paid: null, today: TODAY },
    );
    expect(stale.state).toBe('link_overdue');
    expect(stale.daysSinceLink).toBe(5);
    expect(stale.coachedForFree).toBe(true);
  });

  it('draws the line at LINK_STALE_DAYS and not a day earlier', () => {
    const onTheDay = new Date(Date.parse(TODAY) - LINK_STALE_DAYS * 86_400_000).toISOString();
    expect(paymentStateFor(
      trainee({ billing: billing({ status: 'link_sent', activatedAt: null, linkSentAt: onTheDay }) }),
      { paid: null, today: TODAY },
    ).state).toBe('link_pending');
  });

  it('a broken standing order is free coaching too', () => {
    const failed = paymentStateFor(
      trainee({ billing: billing({ status: 'failed', failedAt: '2026-09-01T00:00:00.000Z' }) }),
      { paid: null, today: TODAY },
    );
    expect(failed.state).toBe('failed');
    expect(failed.coachedForFree).toBe(true);
  });

  it('a cancelled arrangement is not free coaching', () => {
    // Somebody who left, or is leaving. That belongs on the roster, not in a payment alert, and
    // an alert here would send a coach to ask a departing trainee for money.
    const done = paymentStateFor(
      trainee({ billing: billing({ status: 'cancelled', cancelledAt: '2026-09-01T00:00:00.000Z' }) }),
      { paid: null, today: TODAY },
    );
    expect(done.state).toBe('cancelled');
    expect(done.coachedForFree).toBe(false);
  });

  it('somebody who joined yesterday is not owed a red box', () => {
    const fresh = paymentStateFor(
      trainee({ billing: null, academySince: '2026-09-19' }),
      { paid: null, today: TODAY },
    );
    expect(fresh.state).toBe('awaiting_link');
    expect(fresh.coachedForFree).toBe(false);
  });

  it('says nothing about free coaching when there is no join date to age', () => {
    // Without `academy_joined_on` there is nothing to measure, and a guess in either direction is
    // worse than silence: a false red box teaches the coach to ignore the real ones.
    const unknown = paymentStateFor(trainee({ billing: null, academySince: null }), { paid: null, today: TODAY });
    expect(unknown.state).toBe('awaiting_link');
    expect(unknown.coachedForFree).toBe(false);
  });

  it('an old trainee with no link ever sent is being coached for free', () => {
    const forgotten = paymentStateFor(
      trainee({ billing: null, academySince: '2026-02-01' }),
      { paid: null, today: TODAY },
    );
    expect(forgotten.coachedForFree).toBe(true);
  });
});

describe('the board', () => {
  const roster: TraineeBillingInput[] = [
    trainee({ athleteId: 'p1', name: 'Dor Alon' }),
    trainee({ athleteId: 'p2', name: 'Noa Shemesh' }),
    trainee({ athleteId: 'u1', name: 'Uri Gal', billing: billing({ athleteId: 'u1', status: 'failed', failedAt: '2026-09-01T00:00:00.000Z' }) }),
    trainee({
      athleteId: 'y1', name: 'Yael Peretz',
      billing: billing({ athleteId: 'y1', status: 'link_sent', activatedAt: null, linkSentAt: '2026-09-15T09:00:00.000Z' }),
    }),
    trainee({ athleteId: 'n1', name: 'New Runner', billing: null, academySince: '2026-09-19' }),
  ];
  const board = buildPaymentBoard({
    trainees: roster,
    payments: [paid({ athleteId: 'p1' }), paid({ athleteId: 'p2' })],
    period: PERIOD,
    today: TODAY,
  });

  it('every count agrees with the list it sits above', () => {
    // The failure mode of assembling the same numbers twice: a footer saying two above a list of
    // three. One builder, so it cannot happen.
    expect(board.kpi.unpaid).toBe(board.unpaid.length);
    expect(board.needsAttention).toBe(board.unpaid.length);
    expect(board.kpi.coachedForFree).toBe(board.freeRiders.length);
    expect(board.paid.length + board.unpaid.length).toBeLessThanOrEqual(board.rows.length);
  });

  it('counts the standing orders, the trouble and the waiting separately', () => {
    expect(board.kpi.trainees).toBe(5);
    // The two who paid. A failed order, an unanswered link and a brand-new trainee are three
    // different kinds of "no standing order", and none of them counts as one.
    expect(board.kpi.activeStandingOrders).toBe(2);
    // Uri (failed) and Yael (link unanswered). The brand-new trainee is not trouble, and the two
    // who paid are not either — which is what stops this list from being the roster.
    expect(board.kpi.unpaid).toBe(2);
    expect(board.unpaid.map(r => r.name)).toContain('Uri Gal');
    expect(board.unpaid.map(r => r.name)).toContain('Yael Peretz');
    expect(board.unpaid.map(r => r.name)).not.toContain('New Runner');
    // Only the new trainee: Yael's link went out days ago and stopped being "waiting".
    expect(board.kpi.awaitingLink).toBe(1);
  });

  it('puts the most overdue first, because that is the order the calls get made in', () => {
    expect(board.unpaid[0].name).toBe('Yael Peretz');
  });

  it('names who is being coached for free', () => {
    expect(board.freeRiders.map(r => r.name)).toEqual(['Yael Peretz', 'Uri Gal']);
  });

  it('adds up what was collected from the payment rows, not from the fees', () => {
    // The fee is what was agreed; the payment row is what happened. A revenue figure computed
    // from the agreement is a forecast wearing the clothes of a total.
    expect(board.kpi.collectedIls).toBe(1600);
  });

  it('does not count a cancelled trainee as a shortfall', () => {
    const withLeaver = buildPaymentBoard({
      trainees: [
        trainee({ athleteId: 'p1' }),
        trainee({ athleteId: 'x1', billing: billing({ athleteId: 'x1', status: 'cancelled', cancelledAt: '2026-08-30T00:00:00.000Z' }) }),
      ],
      payments: [paid({ athleteId: 'p1' })],
      period: PERIOD,
      today: TODAY,
    });
    expect(withLeaver.kpi.expectedIls).toBe(800);
  });

  it('ignores payments from another month', () => {
    const augustOnly = buildPaymentBoard({
      trainees: [trainee({ athleteId: 'p1' })],
      payments: [paid({ athleteId: 'p1', period: '2026-08-01' })],
      period: PERIOD,
      today: TODAY,
    });
    expect(augustOnly.paid).toHaveLength(0);
    expect(augustOnly.unpaid).toHaveLength(1);
  });
});

describe('what is left of a fee', () => {
  it('extracts VAT from the fee rather than adding it on top', () => {
    // The club quotes VAT-inclusive prices. Adding 18% to ₪800 would invent ₪144 of tax nobody
    // charged and understate the remainder by more than the mentor line.
    const e = perTraineeEconomics({ monthlyAmountIls: 800, mentorIls: 220 });
    expect(e.vatIls).toBeCloseTo(800 - 800 / (1 + VAT_RATE), 2);
    expect(e.vatIls).toBeLessThan(800 * VAT_RATE);
  });

  it('leaves the mockup remainder, to the shekel', () => {
    const e = perTraineeEconomics({ monthlyAmountIls: 800, mentorIls: 220 });
    expect(e.partnersIls).toBeCloseTo(800 * PARTNER_SHARE, 2);
    expect(Math.round(e.remainingIls)).toBe(226);
    expect(e.remainingShare).toBeGreaterThan(0.27);
  });

  it('the lines add back up to the fee', () => {
    const e = perTraineeEconomics({ monthlyAmountIls: 640, mentorIls: 180 });
    expect(e.vatIls + e.mentorIls + e.partnersIls + e.remainingIls).toBeCloseTo(e.grossIls, 2);
  });

  it('answers zero rather than NaN for a trainee with no recorded fee', () => {
    const e = perTraineeEconomics({ monthlyAmountIls: 0, mentorIls: 220 });
    expect(e.remainingShare).toBe(0);
    expect(Number.isFinite(e.remainingIls)).toBe(true);
  });
});

describe('what the mentors are owed', () => {
  const rows = [
    { coachId: 'dani', coachName: 'Dani' }, { coachId: 'dani', coachName: 'Dani' },
    { coachId: 'dani', coachName: 'Dani' }, { coachId: 'shahar', coachName: 'Shahar' },
    { coachId: null, coachName: null },
  ];

  it('is a flat fee plus a per-head amount, because both arrangements are real', () => {
    const payouts = mentorPayouts({
      rows,
      rates: [
        { coachId: 'dani', perTraineeIls: 220, monthlyFlatIls: null, active: true },
        { coachId: 'shahar', perTraineeIls: null, monthlyFlatIls: 1320, active: true },
      ],
    });
    expect(payouts.find(p => p.coachId === 'dani')).toMatchObject({ trainees: 3, payoutIls: 660, perTraineeIls: 220 });
    expect(payouts.find(p => p.coachId === 'shahar')).toMatchObject({ trainees: 1, payoutIls: 1320 });
  });

  it('shows a gap instead of a zero when nobody recorded a rate', () => {
    // A payout table that silently omits a mentor is how somebody gets left out of a payment run,
    // and a zero beside their name reads as a settled amount.
    const payouts = mentorPayouts({ rows, rates: [] });
    expect(payouts).toHaveLength(2);
    expect(payouts.every(p => p.rateMissing)).toBe(true);
    expect(payouts.every(p => p.payoutIls === 0)).toBe(true);
  });

  it('does not invent a mentor for an unassigned trainee', () => {
    expect(mentorPayouts({ rows, rates: [] }).map(p => p.coachId)).toEqual(['Dani', 'Shahar'].map(n => n.toLowerCase()));
  });

  it('answers the simulation the mockup asks: ten trainees instead of six', () => {
    // "אם מלווה מטפל ב-10 מתאמנים במקום 6 — הנשאר למתאמן עולה". The whole economic argument for
    // the feedback form, so the arithmetic behind it is a test and not a slide.
    const sim = mentorLoadSimulation({ monthlyAmountIls: 800, flatIls: 1320, from: 6, to: 10 });
    expect(sim).not.toBeNull();
    expect(sim!.from.mentorIls).toBe(220);
    expect(sim!.to.mentorIls).toBe(132);
    expect(Math.round(sim!.gainIls)).toBe(88);
  });

  it('does not claim a purely per-head deal gets cheaper with volume', () => {
    const sim = mentorLoadSimulation({ monthlyAmountIls: 800, flatIls: 0, perTraineeIls: 220, from: 6, to: 10 });
    expect(sim!.gainIls).toBe(0);
  });
});

describe('the reminder words', () => {
  const board = buildPaymentBoard({
    trainees: [
      trainee({ athleteId: 'u1', name: 'Uri Gal', billing: billing({ status: 'failed', failedAt: TODAY }) }),
      trainee({ athleteId: 'y1', name: 'Yael Peretz', billing: billing({ status: 'link_sent', activatedAt: null, linkSentAt: '2026-09-15T09:00:00.000Z' }) }),
      trainee({ athleteId: 'n1', name: 'New Runner', billing: null }),
      trainee({ athleteId: 'd1', name: 'Dor Alon' }),
    ],
    payments: [], period: PERIOD, today: TODAY,
  });
  const textFor = (name: string) =>
    paymentReminderText(board.rows.find(r => r.name === name)!, 'ספטמבר');

  it('says what the situation actually is, per state', () => {
    expect(textFor('Uri Gal')).toContain('הוראת הקבע');
    expect(textFor('Yael Peretz')).toContain('קישור');
    expect(textFor('New Runner')).toContain('אשלח');
    expect(textFor('Dor Alon')).toContain('ספטמבר');
  });

  it('leaves room for having got it wrong', () => {
    // A message about money that asserts somebody did not pay is a message that will one day be
    // wrong, and the person receiving it is a paying customer.
    expect(textFor('Dor Alon')).toContain('אם שילמת');
  });

  it('uses a first name, because that is how the coach talks to them', () => {
    expect(textFor('Yael Peretz')).toContain('Yael');
    expect(textFor('Yael Peretz')).not.toContain('Peretz');
  });
});
