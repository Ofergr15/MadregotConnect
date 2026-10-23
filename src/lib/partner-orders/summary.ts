/** The "שותפויות" tab's numbers, from partner_orders rows. Commission is deliberately left out. */
export interface PartnerOrderRow { partner: string; via: string | null; order_number: string | null; amount: number; ordered_at: string }
export interface PartnerSummary {
  total: number; count: number; avg: number; since: string | null;
  months: Array<{ month: string; count: number; amount: number }>;
  partners: Array<{ partner: string; via: string | null; count: number; amount: number }>;
  recent: PartnerOrderRow[];
  /** Every order, newest first — for the month a tap on the chart opens. */
  orders: PartnerOrderRow[];
}

const ilMonth = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7);

export function summarize(rows: PartnerOrderRow[], now = new Date()): PartnerSummary {
  const sorted = [...rows].sort((a, b) => b.ordered_at.localeCompare(a.ordered_at));
  const total = sorted.reduce((s, r) => s + Number(r.amount), 0);
  const first = sorted.at(-1)?.ordered_at ?? null;
  const months: PartnerSummary['months'] = [];
  if (first) {
    const [y0, m0] = ilMonth(first).split('-').map(Number), [y1, m1] = ilMonth(now.toISOString()).split('-').map(Number);
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) months.push({ month: `${y}-${String(m).padStart(2, '0')}`, count: 0, amount: 0 });
    const at = new Map(months.map((x) => [x.month, x]));
    for (const r of sorted) { const x = at.get(ilMonth(r.ordered_at)); if (x) { x.count++; x.amount += Number(r.amount); } }
  }
  const byP = new Map<string, PartnerSummary['partners'][number]>();
  for (const r of sorted) {
    const p = byP.get(r.partner) ?? { partner: r.partner, via: r.via, count: 0, amount: 0 };
    p.count++; p.amount += Number(r.amount); byP.set(r.partner, p);
  }
  return {
    total, count: sorted.length, avg: sorted.length ? total / sorted.length : 0, since: first,
    months, partners: [...byP.values()].sort((a, b) => b.amount - a.amount), recent: sorted.slice(0, 8), orders: sorted,
  };
}

export function toCsv(rows: PartnerOrderRow[]): string {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ['date,time,partner,store,order_number,amount_ils'];
  for (const r of [...rows].sort((a, b) => a.ordered_at.localeCompare(b.ordered_at))) {
    const d = new Date(r.ordered_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const tm = new Date(r.ordered_at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
    lines.push([d, tm, r.partner, r.via, r.order_number, Number(r.amount).toFixed(2)].map(esc).join(','));
  }
  return '﻿' + lines.join('\n') + '\n';
}
