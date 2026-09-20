import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import {
  buildPaymentBoard, mentorPayouts, perTraineeEconomics, periodOf,
  type BillingRecord, type BillingStatus, type CoachPayRecord, type PaymentRecord,
  type TraineeBillingInput,
} from '@/lib/academy/payments';

export const dynamic = 'force-dynamic';

/**
 * Payment status beside coaching status — flow-map row 12, and the last section of the mockup.
 *
 *   GET  /api/academy/payments?period=2026-09-01   → the board, the KPIs and the mentor payouts
 *   POST /api/academy/payments                     → mark a status, mark a month paid, set a rate
 *
 * ── MANAGER ONLY, BOTH WAYS ───────────────────────────────────────────────────────────────
 *
 * Unlike every other academy staff route, a coach gets nothing here. What one trainee pays and
 * what a mentor earns are the two facts in this app that no colleague is entitled to, and the
 * mockup says so itself: "מודול קטן ומוגן — רק אתה". A coach-scoped version of this screen would
 * still show one mentor what the club's arrangement with their trainees is.
 *
 * ── NOTHING HERE MOVES MONEY, AND NOTHING HERE SENDS A MESSAGE ─────────────────────────────
 *
 * The money stays in GO. These writes record STATE — a link was sent, a standing order exists,
 * this month was collected — which is the part that lives in a spreadsheet today. A payment
 * reminder is text the coach copies (`paymentReminderText`); the app does not chase anybody for
 * money, because whether it ever should is an open question and not a default to infer.
 */

const BILLING_COLUMNS =
  'athlete_id, status, monthly_amount_ils, link_sent_at, activated_at, failed_at, cancelled_at, note';

/** The action → stored status map, and the timestamp each one owns. */
const STATUS_ACTIONS: Record<string, { status: BillingStatus; stamp?: string }> = {
  link_sent: { status: 'link_sent', stamp: 'link_sent_at' },
  activate: { status: 'active', stamp: 'activated_at' },
  failed: { status: 'failed', stamp: 'failed_at' },
  cancel: { status: 'cancelled', stamp: 'cancelled_at' },
  // Back to the start, for a status set by mistake. It clears nothing: the timestamps are the
  // record of what happened, and erasing them would make a re-sent link look like a first one.
  reset: { status: 'none' },
};

function toBilling(row: Record<string, unknown>): BillingRecord {
  return {
    athleteId: String(row.athlete_id),
    status: (row.status as BillingStatus) || 'none',
    monthlyAmountIls: row.monthly_amount_ils === null || row.monthly_amount_ils === undefined
      ? null : Number(row.monthly_amount_ils),
    linkSentAt: (row.link_sent_at as string) ?? null,
    activatedAt: (row.activated_at as string) ?? null,
    failedAt: (row.failed_at as string) ?? null,
    cancelledAt: (row.cancelled_at as string) ?? null,
    note: (row.note as string) ?? null,
  };
}

/**
 * An amount somebody could actually be charged, or null.
 *
 * The same reasoning as the pace bounds on the analysis route: this number multiplies into the
 * revenue KPI and the mentor payout table, so a slipped decimal is not a cosmetic error. The
 * bounds mirror migration 115's own CHECK, so the app refuses what the database would refuse
 * rather than surfacing a constraint violation.
 */
function money(value: unknown, max = 6000): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 100) / 100;
}

/** The academy roster this screen is about: everybody being coached, with their band and mentor. */
async function loadRoster(supabase: ReturnType<typeof createServerClient>) {
  const { data: athletes } = await supabase
    .from('athletes')
    .select('id, name, academy_coach_id, academy_band_id, academy_joined_on')
    .eq('coach_id', COACH_ID)
    .eq('is_academy', true);
  const rows = (athletes || []) as Array<Record<string, unknown>>;

  const { data: bandRows } = await supabase.from('academy_bands').select('id, band_number');
  const bandNumber = new Map((bandRows || []).map(b => [String(b.id), Number(b.band_number)]));

  // Mentor names, looked up rather than joined: `academy_coach_id` points at another athletes row,
  // and a self-join through PostgREST would carry every column of it.
  const coachIds = [...new Set(rows.map(r => r.academy_coach_id).filter(Boolean).map(String))];
  const coachName = new Map<string, string>();
  if (coachIds.length) {
    const { data: coaches } = await supabase.from('athletes').select('id, name').in('id', coachIds);
    for (const c of coaches || []) coachName.set(String(c.id), String(c.name || ''));
  }

  return rows.map<Omit<TraineeBillingInput, 'billing'>>(r => ({
    athleteId: String(r.id),
    name: String(r.name || ''),
    bandNumber: r.academy_band_id ? bandNumber.get(String(r.academy_band_id)) ?? null : null,
    coachId: r.academy_coach_id ? String(r.academy_coach_id) : null,
    coachName: r.academy_coach_id ? coachName.get(String(r.academy_coach_id)) ?? null : null,
    academySince: (r.academy_joined_on as string) ?? null,
  }));
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.role === 'admin')) {
      return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
    }

    const supabase = createServerClient();
    const asked = new URL(request.url).searchParams.get('period');
    const period = asked ? periodOf(asked) : periodOf(new Date());
    if (!period) return NextResponse.json({ error: 'period is not a date' }, { status: 400 });

    const roster = await loadRoster(supabase);

    const billing = await supabase.from('academy_billing').select(BILLING_COLUMNS);
    // Migration 115 is pasted by hand like every other one. Until it is, the roster is known and
    // the payment state is not — and the board must not be computed from that, because "nobody has
    // a standing order" would render as eighteen people being coached for free.
    if (billing.error && isMissingTable(billing.error)) {
      return NextResponse.json({ period, tableMissing: true, trainees: roster.length, board: null });
    }
    const billingFor = new Map((billing.data || []).map(r => {
      const rec = toBilling(r as Record<string, unknown>);
      return [rec.athleteId, rec];
    }));

    const paid = await supabase
      .from('academy_payments')
      .select('athlete_id, period, amount_ils, source')
      .eq('period', period);
    const payments: PaymentRecord[] = (paid.data || []).map(r => ({
      athleteId: String(r.athlete_id),
      period: String(r.period),
      amountIls: r.amount_ils === null || r.amount_ils === undefined ? null : Number(r.amount_ils),
      source: (r.source as PaymentRecord['source']) || 'manual',
    }));

    const rates = await supabase
      .from('academy_coach_pay')
      .select('coach_id, per_trainee_ils, monthly_flat_ils, active');
    const coachPay: CoachPayRecord[] = (rates.data || []).map(r => ({
      coachId: String(r.coach_id),
      perTraineeIls: r.per_trainee_ils === null || r.per_trainee_ils === undefined ? null : Number(r.per_trainee_ils),
      monthlyFlatIls: r.monthly_flat_ils === null || r.monthly_flat_ils === undefined ? null : Number(r.monthly_flat_ils),
      active: r.active !== false,
    }));

    const trainees: TraineeBillingInput[] = roster.map(t => ({
      ...t, billing: billingFor.get(t.athleteId) ?? null,
    }));
    const board = buildPaymentBoard({ trainees, payments, period, today: new Date() });
    const payouts = mentorPayouts({ rows: board.rows, rates: coachPay });

    // The per-trainee breakdown, at the average fee and the average mentor cost. Deliberately an
    // average and labelled as one: a per-trainee figure computed from one person's fee would read
    // as the club's economics when it is one row of it.
    const fees = board.rows.map(r => r.monthlyAmountIls).filter((n): n is number => typeof n === 'number');
    const avgFee = fees.length ? fees.reduce((a, b) => a + b, 0) / fees.length : 0;
    const mentorTotal = payouts.reduce((sum, p) => sum + p.payoutIls, 0);
    const economics = avgFee > 0
      ? perTraineeEconomics({
          monthlyAmountIls: avgFee,
          mentorIls: board.rows.length ? mentorTotal / board.rows.length : 0,
        })
      : null;

    return NextResponse.json({
      period,
      tableMissing: false,
      board,
      payouts,
      economics,
      // What the economics were computed from, so a screen can say "average of 12 recorded fees"
      // rather than presenting an average as a price.
      economicsBasis: { feesRecorded: fees.length, trainees: board.rows.length, mentorTotalIls: mentorTotal },
      ratesMissing: payouts.some(p => p.rateMissing),
    });
  } catch (err) {
    console.error('GET /api/academy/payments failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.role === 'admin')) {
      return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || '');
    const supabase = createServerClient();
    const now = new Date().toISOString();

    // ── What a mentor is paid. Keyed by coach, not by trainee. ──────────────────────────────
    if (action === 'set_coach_pay') {
      const coachId = String(body.coachId || '');
      if (!coachId) return NextResponse.json({ error: 'coachId is required' }, { status: 400 });
      const perTrainee = money(body.perTraineeIls);
      const flat = money(body.monthlyFlatIls, 40000);
      // Migration 115's own CHECK. Refused here so the screen gets a sentence instead of a
      // constraint violation: a mentor row with neither amount cannot produce a payout, and a
      // payout table that silently omits a mentor is how somebody gets underpaid.
      if (perTrainee === null && flat === null) {
        return NextResponse.json({ error: 'A rate needs an amount', code: 'no_amount' }, { status: 400 });
      }
      const { error } = await supabase.from('academy_coach_pay').upsert({
        coach_id: coachId,
        per_trainee_ils: perTrainee,
        monthly_flat_ils: flat,
        note: typeof body.note === 'string' ? body.note : null,
        updated_at: now,
        updated_by: caller.athleteId,
      }, { onConflict: 'coach_id' });
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ error: 'Migration 115 has not run', code: 'table_missing' }, { status: 503 });
        console.error('set_coach_pay failed:', error);
        return NextResponse.json({ error: 'Could not save the rate' }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    const athleteId = String(body.athleteId || '');
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    // Every write is about somebody the club actually coaches. Read from the database rather than
    // trusted from the body: this is the only place in the app where a stray id would attach a
    // payment record to a person who is not in the academy at all.
    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, is_academy')
      .eq('id', athleteId)
      .eq('coach_id', COACH_ID)
      .maybeSingle();
    if (!athlete?.is_academy) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // ── This month was collected. ───────────────────────────────────────────────────────────
    if (action === 'mark_paid' || action === 'unmark_paid') {
      const period = body.period ? periodOf(String(body.period)) : periodOf(new Date());
      if (!period) return NextResponse.json({ error: 'period is not a date' }, { status: 400 });

      if (action === 'unmark_paid') {
        const { error } = await supabase.from('academy_payments')
          .delete().eq('athlete_id', athleteId).eq('period', period);
        if (error) {
          if (isMissingTable(error)) return NextResponse.json({ error: 'Migration 115 has not run', code: 'table_missing' }, { status: 503 });
          console.error('unmark_paid failed:', error);
          return NextResponse.json({ error: 'Could not undo the marking' }, { status: 500 });
        }
        return NextResponse.json({ ok: true, period });
      }

      // The amount falls back to the agreed monthly fee, and is COPIED rather than joined: the
      // fee changes, and what September was paid must keep saying what September was paid.
      let amount = money(body.amountIls);
      if (amount === null) {
        const { data: row } = await supabase.from('academy_billing')
          .select('monthly_amount_ils').eq('athlete_id', athleteId).maybeSingle();
        amount = money(row?.monthly_amount_ils);
      }
      const { error } = await supabase.from('academy_payments').upsert({
        athlete_id: athleteId,
        period,
        amount_ils: amount,
        // Always 'manual' from this route. The other value exists for an automation that has not
        // been decided on, and writing it from a human tap would erase the distinction.
        source: 'manual',
        marked_at: now,
        marked_by: caller.athleteId,
        note: typeof body.note === 'string' ? body.note : null,
      }, { onConflict: 'athlete_id,period' });
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ error: 'Migration 115 has not run', code: 'table_missing' }, { status: 503 });
        console.error('mark_paid failed:', error);
        return NextResponse.json({ error: 'Could not mark it paid' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, period, amountIls: amount });
    }

    // ── The standing order behind the coaching. ─────────────────────────────────────────────
    const transition = STATUS_ACTIONS[action];
    if (!transition) return NextResponse.json({ error: 'Unknown action', code: 'bad_action' }, { status: 400 });

    const patch: Record<string, unknown> = {
      athlete_id: athleteId,
      status: transition.status,
      updated_at: now,
      updated_by: caller.athleteId,
    };
    if (transition.stamp) patch[transition.stamp] = now;
    if ('monthlyAmountIls' in body) patch.monthly_amount_ils = money(body.monthlyAmountIls);
    if (typeof body.note === 'string') patch.note = body.note;

    const { error } = await supabase.from('academy_billing').upsert(patch, { onConflict: 'athlete_id' });
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ error: 'Migration 115 has not run', code: 'table_missing' }, { status: 503 });
      console.error('academy billing status write failed:', error);
      return NextResponse.json({ error: 'Could not save the status' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status: transition.status });
  } catch (err) {
    console.error('POST /api/academy/payments failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
