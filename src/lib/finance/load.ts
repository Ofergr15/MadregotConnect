import type { createServerClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { buildPaymentBoard, type PaymentRecord } from '@/lib/academy/payments';
import { BILLING_COLUMNS, loadRoster, toBilling } from '@/lib/academy/payments-server';
import { monthKey, monthsEnding, type FinanceInput, type PodiumOrderIn, type StoreOrderIn } from '@/lib/finance/summary';
import { budgetOf, orderTotal } from '@/lib/podium/model';
import { loadProducts, toRound } from '@/lib/podium/server';

type Db = ReturnType<typeof createServerClient>;

/**
 * Everything buildFinance needs for `month` ('YYYY-MM'), read-only. Shared by GET
 * /api/admin/finance and GET /api/admin/finance/unpaid so the list and the screen can never
 * disagree. Every source degrades on its own: a missing table (academy 115, podium 172) drops
 * that stream instead of failing.
 */
export async function loadFinanceInput(db: Db, month: string, now: Date): Promise<FinanceInput> {
  const months = monthsEnding(month);
  const from = `${months[0]}-01`;
  const [ey, em] = month.split('-').map(Number);
  const to = new Date(Date.UTC(ey, em, 1)).toISOString().slice(0, 10);   // first day after the month

  // ── Academy: the board for this month + collected per month for the trend ──
  let board = null;
  const academyByMonth: Array<{ month: string; collectedIls: number }> = [];
  const billing = await db.from('academy_billing').select(BILLING_COLUMNS);
  if (!(billing.error && isMissingTable(billing.error))) {
    const roster = await loadRoster(db);
    const billingFor = new Map((billing.data || []).map((r) => { const b = toBilling(r as Record<string, unknown>); return [b.athleteId, b]; }));
    const paid = await db.from('academy_payments').select('athlete_id, period, amount_ils, source').gte('period', from).lt('period', to);
    const rows = (paid.data || []) as Array<{ athlete_id: string; period: string; amount_ils: number | null; source: string | null }>;
    const period = `${month}-01`;
    const payments: PaymentRecord[] = rows.filter((r) => String(r.period).slice(0, 10) === period).map((r) => ({
      athleteId: String(r.athlete_id), period: String(r.period),
      amountIls: r.amount_ils == null ? null : Number(r.amount_ils), source: (r.source as PaymentRecord['source']) || 'manual',
    }));
    board = buildPaymentBoard({ trainees: roster.map((t) => ({ ...t, billing: billingFor.get(t.athleteId) ?? null })), payments, period, today: now });
    for (const m of months) {
      academyByMonth.push({ month: m, collectedIls: rows.filter((r) => String(r.period).slice(0, 7) === m).reduce((s, r) => s + Number(r.amount_ils || 0), 0) });
    }
  }

  // ── Store: the window's orders + every still-open one (older than the window too) ──
  const names = new Map<string, string>();
  const storeRows: Array<{ id: string; athlete_id: string; status: string; total: number; created_at: string }> = [];
  const inWindow = await db.from('store_orders').select('id, athlete_id, status, total, created_at')
    .gte('created_at', `${from}T00:00:00`).neq('status', 'cancelled');
  const open = await db.from('store_orders').select('id, athlete_id, status, total, created_at')
    .in('status', ['pending_payment', 'paid']);
  for (const r of [...(inWindow.data || []), ...(open.data || [])] as typeof storeRows) {
    if (!storeRows.some((x) => x.id === r.id)) storeRows.push(r);
  }

  // ── Podium: submitted orders of rounds that lock inside the window ──
  const podium: PodiumOrderIn[] = [];
  const rounds = await db.from('podium_rounds').select('*').gte('locks_at', `${from}T00:00:00`).lt('locks_at', `${to}T00:00:00`);
  if (!rounds.error && (rounds.data || []).length) {
    const products = await loadProducts(db);
    const byRound = new Map((rounds.data || []).map((r) => [String(r.id), toRound(r)]));
    const ord = await db.from('podium_orders').select('*, podium_order_items(product_id, quantity)').in('round_id', [...byRound.keys()]);
    type OrderRow = {
      id: string; round_id: string; athlete_id: string | null; label: string | null; submitted_at: string | null;
      approval: PodiumOrderIn['approval']; budget: number | string | null; updated_at: string;
      podium_order_items?: Array<{ product_id: string; quantity: number }> | null;
    };
    for (const o of (ord.data || []) as unknown as OrderRow[]) {
      const round = byRound.get(String(o.round_id));
      if (!round) continue;
      const items = Object.fromEntries((o.podium_order_items ?? []).map((i) => [i.product_id, i.quantity]));
      podium.push({
        id: String(o.id), athleteId: o.athlete_id ?? null, name: o.label ?? '', roundTitle: round.title,
        lockMonth: monthKey(new Date(round.locksAt)), submitted: !!o.submitted_at, approval: o.approval,
        total: orderTotal(items, products), budget: budgetOf(round, { athleteId: o.athlete_id, budget: o.budget == null ? null : Number(o.budget) }),
        updatedAt: String(o.updated_at),
      });
    }
  }

  const ids = [...new Set([...storeRows.map((r) => r.athlete_id), ...podium.map((p) => p.athleteId)].filter(Boolean) as string[])];
  if (ids.length) {
    const { data } = await db.from('athletes').select('id, name').in('id', ids);
    for (const a of data || []) names.set(String(a.id), String(a.name || ''));
  }
  const storeOrders: StoreOrderIn[] = storeRows.map((r) => ({
    id: String(r.id), athleteId: String(r.athlete_id), name: names.get(String(r.athlete_id)) ?? '',
    status: r.status, total: Number(r.total || 0), createdAt: r.created_at,
  }));
  for (const p of podium) if (p.athleteId) p.name = names.get(p.athleteId) ?? p.name;

  return { month, now, board, academyByMonth, storeOrders, podiumOrders: podium };
}
