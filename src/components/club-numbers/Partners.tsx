'use client';

import { useState } from 'react';
import { Check, ChevronLeft, Copy, Download } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EmptyState, Sheet, SkeletonList } from '@/components/ui';
import type { PartnerOrderRow, PartnerSummary } from '@/lib/partner-orders/summary';
import { monthShort, niceStep } from './charts';

/**
 * "שותפויות" — what the club's codes bring the partners (mockup ~/.cache/madregot/coupons/mockup.html,
 * Ofer 10-23). Internal only: no sharing, a CSV of every order, and no commission anywhere.
 */

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const B = ({ children }: { children: React.ReactNode }) => <bdi dir="ltr">{children}</bdi>;
const when = (iso: string) => new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dmy = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: '2-digit' });

/** Other partners in "הטבות" that send the club nothing to count (yet). */
const SILENT = ['SAYSKY', 'Podium', 'LIFT', 'Alpha Sport', 'PhysyoutLV', 'וולנס'];

async function downloadCsv() {
  const res = await fetch('/api/admin/partner-orders?format=csv', { headers: await apiHeaders() }).catch(() => null);
  if (!res?.ok) return;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: 'madregot-partner-orders.csv' });
  a.click(); URL.revokeObjectURL(url);
}

/** Money as the column against a ₪ axis, the number of orders in a badge on it — both per month in one chart. */
const PH = 120, PAD = 22;
function MonthChart({ months, picked, onPick }: { months: PartnerSummary['months']; picked: number; onPick: (i: number) => void }) {
  const step = niceStep(Math.max(1, ...months.map((m) => m.amount)), 4);
  const top = Math.max(step, Math.ceil(Math.max(1, ...months.map((m) => m.amount)) / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const y = (v: number) => (v / top) * PH;
  const axis = (v: number) => (v === 0 ? '0' : v >= 1000 ? `₪${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K` : `₪${v}`);
  return (
    <div className="flex gap-1.5" dir="ltr">
      <div className="relative w-[34px] flex-none" style={{ height: PH + PAD }}>
        {ticks.map((v) => <span key={v} className="absolute right-0 translate-y-1/2 text-[9.5px] font-semibold tabular-nums text-ink-400" style={{ bottom: y(v) }}>{axis(v)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height: PH + PAD }}>
          {ticks.map((v) => <i key={v} className={cn('absolute inset-x-0 block h-px', v === 0 ? 'bg-ink-300' : 'bg-[#EEF0F4]')} style={{ bottom: y(v) }} />)}
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {months.map((m, i) => (
              // The whole column is the target (a 2px bar is not), so an empty month can be picked too.
              <button type="button" key={m.month} onClick={() => onPick(i)} aria-pressed={i === picked} aria-label={`${monthShort(Number(m.month.slice(5)))} ${m.month.slice(0, 4)}`}
                className={cn('flex h-full min-w-0 flex-1 items-end justify-center rounded-t-[6px]', i === picked && 'bg-brand-600/[0.07]')}>
                <i className={cn('relative flex w-full justify-center rounded-t-[5px] transition-colors', i === picked ? 'bg-brand-600' : 'bg-[#C9CFFD]')} style={{ height: Math.max(m.amount ? 2 : 0, y(m.amount)) }}>
                  {m.count > 0 && <em className={cn('absolute -top-[19px] h-4 min-w-4 rounded-full px-[3px] text-center text-[10px] font-extrabold not-italic leading-4 text-white', i === picked ? 'bg-brand-600' : 'bg-ink-900')}>{m.count}</em>}
                </i>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1 flex gap-[3px]">
          {months.map((m, i) => {
            const [yr, mo] = m.month.split('-').map(Number);
            return <span key={m.month} className={cn('min-w-0 flex-1 text-center text-[10px] leading-tight', i === picked ? 'font-extrabold text-brand-600' : 'text-ink-400')}>{monthShort(mo)}{(i === 0 || mo === 1) && <><br />{String(yr).slice(2)}</>}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

const ilMonth = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).slice(0, 7);
const MONTH_LONG = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** The tapped month: its orders, its money, its average — and each order opens. */
function MonthDetail({ m, orders, onOpen }: { m: PartnerSummary['months'][number] | undefined; orders: PartnerOrderRow[]; onOpen: (o: PartnerOrderRow) => void }) {
  if (!m) return null;
  const name = `${MONTH_LONG[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}`;
  return (
    <div className="mt-3 rounded-[16px] bg-[#EEF0FF] p-3">
      <b className="text-[14px] font-extrabold text-[#1D2A99]">{name}</b>
      <div className="mt-2 flex gap-2">
        {([[n(m.count), 'הזמנות'], [`₪${n(m.amount)}`, 'סכום'], [m.count ? `₪${n(m.amount / m.count)}` : '—', 'סל ממוצע']] as const).map(([v, l]) => (
          <div key={l} className="flex-1 rounded-[12px] bg-white p-2"><b className="block text-[17px] font-black text-ink-900"><B>{v}</B></b><span className="text-[11px] text-ink-400">{l}</span></div>
        ))}
      </div>
      {orders.length === 0 ? <p className="mt-2.5 text-[12.5px] text-ink-500">אין הזמנות בחודש הזה</p> : (
        <div className="mt-2 overflow-hidden rounded-[12px] bg-white">
          {orders.map((o, i) => (
            <button type="button" key={`${o.order_number}-${i}`} onClick={() => onOpen(o)} className="flex min-h-[44px] w-full items-center gap-2 border-t border-[#F0F1F4] px-3 text-start first:border-t-0 active:opacity-70">
              <span className="flex-1 text-[13px] text-ink-500"><B>{dmy(o.ordered_at)}</B> · {o.partner}{o.via ? ` · ${o.via}` : ''}</span>
              <b className="text-[14px] font-extrabold"><B>₪{n(o.amount)}</B></b>
              <ChevronLeft className="h-4 w-4 flex-none text-ink-300" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One order, from its email: the date, the amount and the order number (copyable) — Ofer 10-23. */
function OrderSheet({ order, onClose }: { order: PartnerOrderRow | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!order?.order_number) return;
    try { await navigator.clipboard.writeText(order.order_number); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };
  const line = (label: string, value: React.ReactNode) => (
    <div key={label} className="flex min-h-[48px] items-center justify-between gap-3 border-b border-page px-4 last:border-0">
      <span className="text-[14px] text-ink-400">{label}</span><span className="text-[15px] font-semibold text-ink-900">{value}</span>
    </div>
  );
  return (
    <Sheet open={!!order} onOpenChange={(o) => { if (!o) { setCopied(false); onClose(); } }} title={`הזמנה · ${order?.partner ?? ''}`}>
      {order && (
        <div dir="rtl" className="pb-4">
          <div className="mx-4 overflow-hidden rounded-2xl bg-page/60">
            {line('תאריך', when(order.ordered_at))}
            {line('סכום', <B>₪{order.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</B>)}
            {line('מספר הזמנה', order.order_number
              ? <button type="button" onClick={copy} className="flex min-h-[44px] items-center gap-1.5 text-brand-600" aria-label="להעתיק את מספר ההזמנה"><B>{order.order_number}</B>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
              : '—')}
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function Partners() {
  const { data, error, isLoading } = useApi<PartnerSummary>('/api/admin/partner-orders');
  const [open, setOpen] = useState<PartnerOrderRow | null>(null);
  const [pickedMonth, setPickedMonth] = useState<number | null>(null);
  if (error) return <EmptyState title="לא הצלחנו לטעון את השותפויות" />;
  if (isLoading || !data) return <div className="p-4"><SkeletonList count={4} /></div>;
  if (!data.count) return <EmptyState title="עוד אין הזמנות" description="ההזמנות נקראות מהמייל של המועדון פעם ביום" />;
  const cur = data.months.at(-1);
  // The current month until a column is tapped.
  const picked = pickedMonth ?? data.months.length - 1;
  const best = data.months.reduce((a, b) => (b.amount > a.amount ? b : a), data.months[0]);
  const since = new Date(data.since!).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', month: 'long', year: 'numeric' });
  return (
    <div className="mt-3">
      <section className="mx-4 mb-2.5 rounded-[22px] bg-gradient-to-br from-[#2B44FF] to-[#6A3CFF] p-4 text-white">
        <span className="text-[12.5px] opacity-85">רכישות שהמדרגות הביאו · מאז {since}</span>
        <b className="mt-1 block text-[42px] font-black leading-none tracking-tight"><B>₪{n(data.total)}</B></b>
        <div className="mt-3 flex gap-2">
          {([[n(data.count), 'הזמנות עם הקוד'], [`₪${n(data.avg)}`, 'סל ממוצע'], [n(cur?.count ?? 0), 'הזמנות החודש']] as const).map(([v, l]) => (
            <div key={l} className="flex-1 rounded-[14px] bg-white/15 p-2.5"><b className="block text-[19px] font-black"><B>{v}</B></b><span className="text-[11px] opacity-90">{l}</span></div>
          ))}
        </div>
      </section>

      <section className="mx-4 mb-2.5 rounded-[22px] bg-card p-3.5">
        <b className="text-sm font-extrabold text-ink-900">הזמנות וכסף לפי חודש</b>
        {best && <p className="mb-3 text-[11.5px] text-ink-400">השיא: {monthShort(Number(best.month.slice(5)))} <B>{best.month.slice(0, 4)}</B> — <B>{best.count}</B> הזמנות, <B>₪{n(best.amount)}</B></p>}
        <MonthChart months={data.months} picked={picked} onPick={setPickedMonth} />
        <MonthDetail m={data.months[picked]} orders={data.orders.filter((o) => ilMonth(o.ordered_at) === data.months[picked]?.month)} onOpen={setOpen} />
        <div className="mt-2.5 flex justify-center gap-4 text-[11.5px] text-ink-400">
          <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-[3px] bg-[#C9CFFD]" />סכום הרכישות</span>
          <span className="flex items-center gap-1.5"><em className="h-4 min-w-4 rounded-full bg-ink-900 px-[3px] text-center text-[10px] font-extrabold not-italic leading-4 text-white">#</em>מספר הזמנות</span>
        </div>
      </section>

      <section className="mx-4 mb-2.5 rounded-[22px] bg-card p-3.5">
        <b className="text-sm font-extrabold text-ink-900">השותפים</b>
        <p className="mb-1 text-[11.5px] text-ink-400">מאיפה מגיע המידע</p>
        {data.partners.map((p) => (
          <div key={p.partner} className="flex items-center gap-2.5 border-t border-[#F0F1F4] py-2.5 first-of-type:border-t-0">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-ink-900 text-[13px] font-black text-white">{p.partner[0]}</span>
            <div className="min-w-0 flex-1"><b className="block text-[15px]">{p.partner}</b><span className="text-[12.5px] text-ink-400"><B>{p.count}</B> הזמנות{p.via ? ` דרך ${p.via}` : ''} · דיווח אוטומטי</span></div>
            <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11.5px] font-bold text-[#15803d]">מחובר</span>
          </div>
        ))}
        <div className="flex items-center gap-2.5 border-t border-[#F0F1F4] py-2.5">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-[#F1F1F5] text-[13px] font-black text-ink-400">+</span>
          <div className="min-w-0 flex-1"><b className="block text-[14px]">{SILENT.join(' · ')}</b><span className="text-[12.5px] text-ink-400">לא שולחים דיווח למייל</span></div>
          <span className="rounded-full bg-[#F1F1F5] px-2 py-0.5 text-[11.5px] font-bold text-ink-400">אין מידע</span>
        </div>
      </section>

      <section className="mx-4 mb-2.5 rounded-[22px] bg-card p-3.5">
        <div className="flex items-center justify-between">
          <b className="text-sm font-extrabold text-ink-900">הזמנות אחרונות</b>
          <button type="button" onClick={downloadCsv} className="flex min-h-[34px] items-center gap-1 rounded-full border border-[#C9CFFD] px-3 text-[12.5px] font-bold text-brand-600"><Download className="h-3.5 w-3.5" />ייצוא ל-CSV</button>
        </div>
        <p className="mb-1 text-[11.5px] text-ink-400">מתעדכן מהמייל של המועדון · כל ההזמנות בקובץ</p>
        {data.recent.map((r, i) => (
          <button type="button" key={`${r.order_number}-${i}`} onClick={() => setOpen(r)} className="flex w-full items-center gap-2.5 border-t border-[#F0F1F4] py-2 text-start first-of-type:border-t-0 active:opacity-70">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-ink-900 text-[12px] font-black text-white">{r.partner[0]}</span>
            <div className="min-w-0 flex-1"><b className="block text-[14px]">{r.partner}</b><span className="text-[12px] text-ink-400"><B>{dmy(r.ordered_at)}</B>{r.via ? ` · ${r.via}` : ''}</span></div>
            <b className="text-[15px] font-extrabold"><B>₪{n(r.amount)}</B></b>
            <ChevronLeft className="h-4 w-4 flex-none text-ink-300" />
          </button>
        ))}
      </section>
      <OrderSheet order={open} onClose={() => setOpen(null)} />
    </div>
  );
}
