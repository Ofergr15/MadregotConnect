import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { buildPaymentBoard, paymentReminderText, type PaymentRecord } from '@/lib/academy/payments';
import { BILLING_COLUMNS, loadRoster, toBilling } from '@/lib/academy/payments-server';
import { REMINDABLE, monthKey } from '@/lib/finance/summary';
import { notifyAthlete } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/finance/remind { athleteId } — כספים › "תזכורת": one in-app notification to that
 * academy trainee, with the same words the payments screen offers to copy (paymentReminderText),
 * which point at the GO link they already have. Owner's default for the open channel question
 * (mockup v3: "התראה באפליקציה … עם הקישור הקיים של GO"). No WhatsApp, no email, no money moved.
 *
 * MANAGER ONLY. The athlete must be on this month's board and actually owe something — the server
 * decides that from the same rows, so a stale screen can't chase a month that was paid since.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.role === 'admin')) {
      return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
    }
    const body = (await request.json().catch(() => ({}))) as { athleteId?: unknown };
    const athleteId = typeof body.athleteId === 'string' ? body.athleteId.trim() : '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    const db = createServerClient();
    const billing = await db.from('academy_billing').select(BILLING_COLUMNS).eq('athlete_id', athleteId);
    if (billing.error && isMissingTable(billing.error)) return NextResponse.json({ error: 'payments not set up' }, { status: 503 });
    const roster = (await loadRoster(db)).filter((t) => t.athleteId === athleteId);
    if (!roster.length) return NextResponse.json({ error: 'not an academy trainee' }, { status: 404 });

    const now = new Date();
    const month = monthKey(now);
    const period = `${month}-01`;
    const paid = await db.from('academy_payments').select('athlete_id, period, amount_ils, source').eq('athlete_id', athleteId).eq('period', period);
    const payments: PaymentRecord[] = (paid.data || []).map((r) => ({
      athleteId: String(r.athlete_id), period: String(r.period),
      amountIls: r.amount_ils == null ? null : Number(r.amount_ils), source: (r.source as PaymentRecord['source']) || 'manual',
    }));
    const b = (billing.data || [])[0];
    const board = buildPaymentBoard({
      trainees: [{ ...roster[0], billing: b ? toBilling(b as Record<string, unknown>) : null }], payments, period, today: now,
    });
    const row = board.rows[0];
    if (!row || !REMINDABLE.has(row.state)) return NextResponse.json({ error: 'nothing to remind', state: row?.state ?? null }, { status: 409 });

    const monthHe = new Intl.DateTimeFormat('he-IL', { month: 'long', timeZone: 'UTC' }).format(new Date(`${period}T00:00:00Z`));
    const text = paymentReminderText(row, monthHe);
    const result = await notifyAthlete({
      athleteId, kind: 'payment_reminder', actorAthleteId: caller.athleteId ?? null,
      title: 'תזכורת תשלום · אקדמיה', body: text, url: '/inbox', tag: `payment-reminder-${athleteId}-${month}`,
    });
    return NextResponse.json({ ok: true, state: row.state, delivered: result.delivered, subscriptions: result.subscriptions });
  } catch (err) {
    console.error('POST /api/admin/finance/remind failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
