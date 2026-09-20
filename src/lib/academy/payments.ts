// Payment STATUS beside coaching status — and the one number that says whether a mentor pays
// for itself.
//
// Flow-map row 12 ("קישור תשלום → הוראת קבע; מייל על תשלום → סימון בקובץ", owner Ofer, tools GO
// + Excel) and row 15 (the small finance module). The mockup's own reason for the screen is the
// whole design brief: "'מי לא שילם' חייב לשבת ליד 'מי מקבל ליווי' — אחרת אתה מגלה את זה רק בסוף
// החודש."
//
// ── THIS FILE DOES NOT HANDLE MONEY ─────────────────────────────────────────────────────
//
// The money stays in GO. GO issues the link, GO holds the standing order, GO sends the receipt.
// Nothing here charges anybody and nothing here is an accounting ledger. What it computes is
// STATE — link sent / standing order active / paid this month — because state is the part that
// currently lives in a spreadsheet beside a roster that moves without it.
//
// Pure and Supabase-free like every other decision lib in here, for the usual reason and one
// extra: the outputs are sentences about people's money ("מתאמנת פעילה שמקבלת ליווי בחינם"), and
// being wrong about that in either direction is expensive — a false alarm sends a coach to ask
// somebody for money they already paid.
//
// ── THE RULE WORTH THE WHOLE SCREEN ─────────────────────────────────────────────────────
//
// `coachedForFree`. A trainee who is in the academy, getting a written plan and weekly feedback,
// with no standing order behind them. Today that is invisible until the end of the month, and it
// is the only state here that quietly costs real money. It is DERIVED rather than stored,
// because it is a fact about the gap between two tables: storing it would make it wrong the
// moment either side moved.
//
// ── WHICH NUMBERS HERE ARE REAL ─────────────────────────────────────────────────────────
//
// `VAT_RATE` is real: 18% in Israel since January 2025, and the club's prices are quoted
// VAT-inclusive, so the tax is extracted from the fee rather than added to it. Everything else —
// `LINK_STALE_DAYS`, `PARTNER_SHARE` — is a placeholder for a figure Ofer has and I do not, and
// they are named constants in one block for exactly that reason. The mentor cost is not a
// constant at all: it comes from `academy_coach_pay`, because it is a per-person deal.

/**
 * How long a payment link may sit unanswered before the trainee is "being coached for free".
 *
 * A GUESS. The mockup's red box fires at five days, which tells me five is already too late
 * rather than that five is the threshold. Three days is a working assumption: long enough that a
 * trainee who set it up over the weekend is not chased, short enough that the alert arrives
 * while the month can still be saved.
 */
export const LINK_STALE_DAYS = 3;

/**
 * Israeli VAT, 18% since 1 January 2025. NOT a guess.
 *
 * The club quotes VAT-inclusive prices, so the tax is a share OF the fee and not an addition to
 * it: ₪800 charged is ₪678 of revenue and ₪122 of VAT, not ₪800 + ₪144. The mockup's ₪124 is
 * rounding in a mockup; the arithmetic below is the one to trust.
 */
export const VAT_RATE = 0.18;

/**
 * The partners' share of a trainee's fee.
 *
 * A GUESS, read off the mockup's illustrative column (₪230 of ₪800 ≈ 29%). Whether it is a
 * percentage at all, or a fixed monthly amount, is one of the questions this screen is meant to
 * ask rather than answer — which is why it is a parameter with a default and not baked in.
 */
export const PARTNER_SHARE = 0.29;

export type BillingStatus = 'none' | 'link_sent' | 'active' | 'failed' | 'cancelled';

/**
 * What the screen shows per trainee. Wider than `BillingStatus` on purpose: the stored status is
 * a fact about a standing order, and these are facts about a standing order IN A GIVEN MONTH.
 * 'active' plus no payment row for September is the state that matters most and has no name in
 * the database at all.
 */
export type PaymentState =
  | 'paid'          // there is a payment row for this month. Nothing to do.
  | 'unpaid'        // a live standing order, but this month has not been marked.
  | 'link_pending'  // the link went out recently. Waiting is the correct action.
  | 'link_overdue'  // the link went out and nothing happened. The red box.
  | 'awaiting_link' // no link has been sent yet.
  | 'failed'        // the standing order broke. Needs a call, not a link.
  | 'cancelled';    // deliberately ended. Not a problem, and not chased.

export interface BillingRecord {
  athleteId: string;
  status: BillingStatus;
  monthlyAmountIls: number | null;
  linkSentAt: string | null;
  activatedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  note: string | null;
}

export interface PaymentRecord {
  athleteId: string;
  /** First of the month, 'YYYY-MM-01'. */
  period: string;
  amountIls: number | null;
  source: 'manual' | 'go_email';
}

export interface TraineeBillingInput {
  athleteId: string;
  name: string;
  bandNumber: number | null;
  coachId: string | null;
  coachName: string | null;
  /** When they became an academy trainee, so a link that was never sent can be aged too. */
  academySince: string | null;
  billing: BillingRecord | null;
}

export interface PaymentRowView {
  athleteId: string;
  name: string;
  bandNumber: number | null;
  coachId: string | null;
  coachName: string | null;
  state: PaymentState;
  /** The stored status, kept beside the derived state so the screen can explain itself. */
  status: BillingStatus;
  monthlyAmountIls: number | null;
  paidAmountIls: number | null;
  paidSource: 'manual' | 'go_email' | null;
  /** Days since the payment link went out, or null when none has. */
  daysSinceLink: number | null;
  /** Receiving coaching with no standing order behind it. The one alert that costs money. */
  coachedForFree: boolean;
  /** Appears in the mockup's "לא שולם" list and the footer's "דורשים טיפול" count. */
  needsAttention: boolean;
  note: string | null;
}

/** The first of the month a date falls in, as 'YYYY-MM-01'. */
export function periodOf(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  // UTC parts, not local: the period is a label on a month, and a local-midnight read of
  // '2026-10-01' in a UTC+3 zone lands in September.
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Whole days from `from` to `to`, or null when `from` is missing or unparseable. */
export function daysSince(from: string | null | undefined, to: string | Date): number | null {
  if (!from) return null;
  const a = new Date(from).getTime();
  const b = (typeof to === 'string' ? new Date(to) : to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

/**
 * The state of one trainee's coaching fee in one month.
 *
 * `paid` wins over everything, including a failed standing order: a month that was collected was
 * collected, and a card that expired afterwards is next month's problem. Chasing somebody for a
 * month they paid is the one mistake on this screen that damages a relationship.
 */
export function paymentStateFor(
  trainee: TraineeBillingInput,
  opts: { paid: PaymentRecord | null; today: string | Date },
): { state: PaymentState; daysSinceLink: number | null; coachedForFree: boolean } {
  const { paid, today } = opts;
  const status = trainee.billing?.status ?? 'none';
  const daysSinceLink = daysSince(trainee.billing?.linkSentAt, today);

  if (paid) return { state: 'paid', daysSinceLink, coachedForFree: false };

  const state: PaymentState =
    status === 'active' ? 'unpaid'
    : status === 'failed' ? 'failed'
    : status === 'cancelled' ? 'cancelled'
    : status === 'link_sent'
      ? (daysSinceLink !== null && daysSinceLink > LINK_STALE_DAYS ? 'link_overdue' : 'link_pending')
      : 'awaiting_link';

  // A cancelled arrangement is not free coaching — it is somebody who left, or is about to, and
  // the honest place for that is the roster rather than a payment alert.
  //
  // 'awaiting_link' is only free coaching once it has had time to stop being normal. Somebody
  // who joined yesterday is not owed a red box, and without `academySince` there is nothing to
  // age them against — so the app says nothing rather than guessing.
  const coachedForFree =
    state === 'link_overdue' || state === 'failed'
      ? true
      : state === 'awaiting_link'
        ? (daysSince(trainee.academySince, today) ?? -1) > LINK_STALE_DAYS
        : false;

  return { state, daysSinceLink, coachedForFree };
}

export interface PaymentBoard {
  /** 'YYYY-MM-01'. */
  period: string;
  rows: PaymentRowView[];
  unpaid: PaymentRowView[];
  paid: PaymentRowView[];
  kpi: {
    trainees: number;
    activeStandingOrders: number;
    unpaid: number;
    awaitingLink: number;
    coachedForFree: number;
    /** Collected this month, in shekels, from the payment rows themselves. */
    collectedIls: number;
    /** What an all-paid month would be worth, from the billing rows. */
    expectedIls: number;
  };
  /** The named red box: who is being coached for free right now, longest first. */
  freeRiders: PaymentRowView[];
  needsAttention: number;
}

/**
 * The payments screen, as one computed object.
 *
 * Every list and every KPI on the mockup comes out of here, so that the screen cannot show a
 * count of two above a list of three — the failure mode of assembling the same numbers twice.
 */
export function buildPaymentBoard(opts: {
  trainees: TraineeBillingInput[];
  payments: PaymentRecord[];
  period: string;
  today: string | Date;
}): PaymentBoard {
  const { trainees, payments, period, today } = opts;
  const paidByAthlete = new Map(
    payments.filter(p => p.period === period).map(p => [p.athleteId, p]),
  );

  const rows: PaymentRowView[] = trainees.map(t => {
    const paid = paidByAthlete.get(t.athleteId) ?? null;
    const { state, daysSinceLink, coachedForFree } = paymentStateFor(t, { paid, today });
    return {
      athleteId: t.athleteId,
      name: t.name,
      bandNumber: t.bandNumber,
      coachId: t.coachId,
      coachName: t.coachName,
      state,
      status: t.billing?.status ?? 'none',
      monthlyAmountIls: t.billing?.monthlyAmountIls ?? null,
      paidAmountIls: paid?.amountIls ?? null,
      paidSource: paid?.source ?? null,
      daysSinceLink,
      coachedForFree,
      // A cancelled arrangement and a link sent yesterday need nothing from anybody. Everything
      // else on this list is somebody's next phone call.
      needsAttention: state === 'unpaid' || state === 'failed' || state === 'link_overdue'
        || (state === 'awaiting_link' && coachedForFree),
      note: t.billing?.note ?? null,
    };
  });

  const paidRows = rows.filter(r => r.state === 'paid');
  const unpaidRows = rows.filter(r => r.needsAttention);

  return {
    period,
    rows,
    // Both lists sorted the way the coach reads them: the most overdue first, and the paid list
    // alphabetically, because nothing in it is a queue.
    unpaid: [...unpaidRows].sort((a, b) => (b.daysSinceLink ?? 0) - (a.daysSinceLink ?? 0)
      || a.name.localeCompare(b.name)),
    paid: [...paidRows].sort((a, b) => a.name.localeCompare(b.name)),
    kpi: {
      trainees: rows.length,
      activeStandingOrders: rows.filter(r => r.status === 'active').length,
      unpaid: unpaidRows.length,
      awaitingLink: rows.filter(r => r.state === 'awaiting_link' || r.state === 'link_pending').length,
      coachedForFree: rows.filter(r => r.coachedForFree).length,
      collectedIls: round2(paidRows.reduce((sum, r) => sum + (r.paidAmountIls ?? r.monthlyAmountIls ?? 0), 0)),
      // Cancelled trainees are not expected revenue; counting them would make every month look
      // like a shortfall.
      expectedIls: round2(rows
        .filter(r => r.state !== 'cancelled')
        .reduce((sum, r) => sum + (r.monthlyAmountIls ?? 0), 0)),
    },
    freeRiders: rows.filter(r => r.coachedForFree)
      .sort((a, b) => (b.daysSinceLink ?? 0) - (a.daysSinceLink ?? 0)),
    needsAttention: unpaidRows.length,
  };
}

export interface TraineeEconomics {
  grossIls: number;
  vatIls: number;
  mentorIls: number;
  partnersIls: number;
  remainingIls: number;
  /** The remainder as a share of the fee, which is the figure the simulation moves. */
  remainingShare: number;
}

/**
 * What is left of one trainee's fee.
 *
 * The manager phone's argument in arithmetic: "השורה שמזיזה את זה היא עלות המלווה למתאמן — ולכן
 * זמן הפידבק הוא מדד כלכלי, לא רק נוחות". The mentor cost is the only line here that the app can
 * change, and it changes it by making a mentor able to carry more trainees for the same fee.
 *
 * VAT is extracted, not added — see `VAT_RATE`.
 */
export function perTraineeEconomics(opts: {
  monthlyAmountIls: number;
  mentorIls: number;
  partnerShare?: number;
  vatRate?: number;
}): TraineeEconomics {
  const gross = Math.max(0, opts.monthlyAmountIls || 0);
  const vatRate = opts.vatRate ?? VAT_RATE;
  const vat = round2(gross - gross / (1 + vatRate));
  const mentor = Math.max(0, opts.mentorIls || 0);
  const partners = round2(gross * (opts.partnerShare ?? PARTNER_SHARE));
  const remaining = round2(gross - vat - mentor - partners);
  return {
    grossIls: round2(gross),
    vatIls: vat,
    mentorIls: round2(mentor),
    partnersIls: partners,
    remainingIls: remaining,
    remainingShare: gross > 0 ? remaining / gross : 0,
  };
}

export interface CoachPayRecord {
  coachId: string;
  perTraineeIls: number | null;
  monthlyFlatIls: number | null;
  active: boolean;
}

export interface MentorPayout {
  coachId: string;
  coachName: string;
  trainees: number;
  payoutIls: number;
  /** What this mentor costs per trainee, which is the line `perTraineeEconomics` needs. */
  perTraineeIls: number;
  /** True when nobody has recorded what this mentor is paid, so the payout is not a real zero. */
  rateMissing: boolean;
}

/**
 * The mentor payout table: how many trainees each mentor carries this month and what that costs.
 *
 * A flat fee plus a per-trainee amount, because both arrangements are real and they are not
 * exclusive. A mentor with no recorded rate returns zero with `rateMissing` set rather than
 * being dropped — a payout table that silently omits a mentor is worse than one that shows a
 * gap, because the gap is the thing to go and fix.
 */
export function mentorPayouts(opts: {
  rows: Array<{ coachId: string | null; coachName: string | null }>;
  rates: CoachPayRecord[];
}): MentorPayout[] {
  const byCoach = new Map<string, { name: string; trainees: number }>();
  for (const row of opts.rows) {
    if (!row.coachId) continue;
    const at = byCoach.get(row.coachId) ?? { name: row.coachName || '—', trainees: 0 };
    at.trainees += 1;
    byCoach.set(row.coachId, at);
  }
  const rateFor = new Map(opts.rates.map(r => [r.coachId, r]));

  return [...byCoach.entries()]
    .map(([coachId, { name, trainees }]) => {
      const rate = rateFor.get(coachId);
      const flat = rate?.monthlyFlatIls ?? 0;
      const per = rate?.perTraineeIls ?? 0;
      const payout = round2(flat + per * trainees);
      return {
        coachId,
        coachName: name,
        trainees,
        payoutIls: payout,
        perTraineeIls: trainees > 0 ? round2(payout / trainees) : 0,
        rateMissing: !rate || (rate.perTraineeIls === null && rate.monthlyFlatIls === null),
      };
    })
    .sort((a, b) => b.payoutIls - a.payoutIls || a.coachName.localeCompare(b.coachName));
}

/**
 * The simulation the mockup names: what happens to the remainder per trainee when one mentor
 * carries `to` trainees instead of `from`, at the same monthly fee.
 *
 * Only meaningful where a flat fee exists — a purely per-trainee deal does not get cheaper per
 * head, and pretending it does would be an argument for a screen that has not earned it. That is
 * why `flatIls` is required and `perTraineeIls` is subtracted unchanged.
 */
export function mentorLoadSimulation(opts: {
  monthlyAmountIls: number;
  flatIls: number;
  perTraineeIls?: number;
  from: number;
  to: number;
  partnerShare?: number;
}): { from: TraineeEconomics; to: TraineeEconomics; gainIls: number } | null {
  if (opts.from <= 0 || opts.to <= 0) return null;
  const cost = (n: number) => opts.flatIls / n + (opts.perTraineeIls ?? 0);
  const before = perTraineeEconomics({
    monthlyAmountIls: opts.monthlyAmountIls, mentorIls: cost(opts.from), partnerShare: opts.partnerShare,
  });
  const after = perTraineeEconomics({
    monthlyAmountIls: opts.monthlyAmountIls, mentorIls: cost(opts.to), partnerShare: opts.partnerShare,
  });
  return { from: before, to: after, gainIls: round2(after.remainingIls - before.remainingIls) };
}

/**
 * The words for a payment reminder, for the coach to send himself.
 *
 * Deliberately NOT a message this app delivers. A reminder about money is the most
 * relationship-sensitive thing in the academy, it goes out over WhatsApp today, and whether the
 * app should ever send one is an open question — so this returns text to copy and nothing else
 * happens. The alternative, an app that quietly chases people for money, is not a feature to
 * infer.
 */
export function paymentReminderText(row: PaymentRowView, monthLabel: string): string {
  const name = row.name.split(' ')[0] || row.name;
  if (row.state === 'failed') {
    return `היי ${name}, נראה שהוראת הקבע הפסיקה לעבוד. אפשר לחדש אותה בקישור הקודם, ואם נוח לך — נסגור את זה בטלפון.`;
  }
  if (row.state === 'link_overdue' || row.state === 'link_pending') {
    return `היי ${name}, שלחתי קישור להקמת הוראת קבע ונראה שהוא עוד לא הושלם. אם משהו לא עבד תגיד לי ואשלח שוב.`;
  }
  if (row.state === 'awaiting_link') {
    return `היי ${name}, אשלח לך קישור להקמת הוראת קבע כדי לסדר את התשלום מהחודש הבא.`;
  }
  return `היי ${name}, בדיקה קטנה — התשלום של ${monthLabel} עוד לא נרשם אצלי. אם שילמת, תתעלם מההודעה.`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
