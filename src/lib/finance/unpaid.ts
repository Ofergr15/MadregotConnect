import { REMINDABLE, type FinanceInput } from './summary';
import type { PaymentState } from '@/lib/academy/payments';

/**
 * "Who hasn't paid" as one flat list (task 188), for the manager and as a CSV: every academy
 * trainee whose month is not settled (the REMINDABLE states — paid and cancelled are out) and
 * every store order still waiting for payment. Read-only, derived from the same FinanceInput
 * the כספים screen is built from (lib/finance/load), so the file and the screen agree.
 *
 * Podium over-budget orders are NOT here: they wait for an approval, not for a payment.
 */

export type UnpaidSource = 'academy' | 'store';

export interface UnpaidRow {
  source: UnpaidSource;
  /** athlete id (academy) / order id (store). */
  id: string;
  athleteId: string | null;
  name: string;
  /** academy: the payment state; store: 'pending_payment'. */
  state: PaymentState | 'pending_payment';
  amountIls: number | null;
  /** academy: days since the GO link; store: days since the order. */
  days: number | null;
  coachName: string | null;
  note: string | null;
}

const daysSince = (iso: string, now: Date) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
};

export function unpaidRows(input: FinanceInput): UnpaidRow[] {
  const out: UnpaidRow[] = [];
  for (const r of input.board?.rows ?? []) {
    if (!REMINDABLE.has(r.state)) continue;
    out.push({
      source: 'academy', id: r.athleteId, athleteId: r.athleteId, name: r.name, state: r.state,
      amountIls: r.monthlyAmountIls, days: r.daysSinceLink, coachName: r.coachName, note: r.note,
    });
  }
  for (const o of input.storeOrders) {
    if (o.status !== 'pending_payment') continue;
    out.push({
      source: 'store', id: o.id, athleteId: o.athleteId, name: o.name, state: 'pending_payment',
      amountIls: o.total, days: daysSince(o.createdAt, input.now), coachName: null, note: null,
    });
  }
  // Oldest first — the one waiting longest is the next phone call.
  return out.sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.name.localeCompare(b.name, 'he'));
}

const STATE_HE: Record<UnpaidRow['state'], string> = {
  unpaid: 'הוראת קבע פעילה, לא סומן תשלום', link_pending: 'קישור נשלח', link_overdue: 'קישור בלי מענה',
  awaiting_link: 'עוד לא נשלח קישור', failed: 'הוראת קבע נכשלה', paid: 'שולם', cancelled: 'בוטל',
  pending_payment: 'הזמנה ממתינה לתשלום',
};
const SOURCE_HE: Record<UnpaidSource, string> = { academy: 'אקדמיה', store: 'חנות' };

/**
 * A spreadsheet cell. Quoted when it must be, and a leading = + - @ is defused with an
 * apostrophe: a name is typed by its owner, and Excel would run "=HYPERLINK(...)" as a formula.
 */
export function csvCell(v: string | number | null): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** With a BOM so Excel opens the Hebrew correctly (same as the podium file). */
export function unpaidCsv(rows: UnpaidRow[]): string {
  const head = ['מקור', 'שם', 'מצב', 'סכום (₪)', 'ימים', 'מאמן/ת', 'הערה'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([SOURCE_HE[r.source], r.name, STATE_HE[r.state], r.amountIls, r.days, r.coachName, r.note].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
