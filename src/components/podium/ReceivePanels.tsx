'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Download, RotateCcw } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Sheet, SegmentedControl } from '@/components/ui';
import { englishName, type PodiumProduct, type PodiumRound } from '@/lib/podium/model';
import { sumQty, type Share } from '@/lib/podium/receive';
import { ProductImage, Stepper, shekelRound } from '@/components/podium/parts';

type Qty = Record<string, number>;
interface View {
  ordered: Qty; received: Qty; recorded: boolean; over: string[]; missingItems: number; missingValue: number;
  shares: Record<string, Share & { manual: boolean; deliveredAt: string | null }>;
  error?: string; message?: string;
}
interface Order { id: string; athleteId: string; items: Qty }

const post = async (url: string, body: unknown, method = 'POST') => {
  const r = await fetch(url, { method, headers: await apiHeaders(true), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ?? 'משהו השתבש');
  return j;
};

function Missing({ items, value, label }: { items: number; value: number; label: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-2 rounded-card p-3.5 text-center', items ? 'bg-[#FFF1EA] text-[#9A3412]' : 'bg-accent-600/10 text-accent-900')}>
      <div><b className="block text-2xl font-black tabular-nums"><bdi>{items}</bdi></b><small className="text-2xs font-bold">{items ? label : 'לא חסר כלום'}</small></div>
      <div><b className="block text-2xl font-black tabular-nums"><bdi dir="ltr">{shekelRound(value)}</bdi></b><small className="text-2xs font-bold">שווי החוסר</small></div>
    </div>
  );
}

/**
 * The goods arrived: how many of each product came (lib/podium/receive). Starts at what was ordered —
 * lower only what came short. Saved on "שמירה"; "סיימתי לקבל" moves on to the split.
 */
export function ReceivePanel({ round, products, onDone }: { round: PodiumRound; products: PodiumProduct[]; onDone: () => void }) {
  const { data, mutate } = useApi<View>(`/api/admin/podium/receive?round=${round.id}`);
  const [draft, setDraft] = useState<Qty | null>(null);
  const [onlyShort, setOnlyShort] = useState<'all' | 'short'>('all');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  if (!data) return <div className="h-40 animate-pulse rounded-card bg-card" />;
  if (data.error) return <p className="rounded-card bg-card p-4 text-center text-sm text-ink-500">{data.message}</p>;
  const rec = draft ?? data.received;
  const ids = Object.keys(data.ordered).sort((a, b) => (data.ordered[b] - data.ordered[a]));
  const shortIds = ids.filter((id) => (rec[id] ?? 0) < data.ordered[id]);
  const missItems = ids.reduce((s, id) => s + Math.max(0, data.ordered[id] - (rec[id] ?? 0)), 0);
  const missValue = ids.reduce((s, id) => s + Math.max(0, data.ordered[id] - (rec[id] ?? 0)) * (byId.get(id)?.price ?? 0), 0);
  const save = async (done?: boolean) => {
    setBusy(true); setNote(null);
    try { await mutate(await post('/api/admin/podium/receive', { round: round.id, received: rec, ...(done !== undefined ? { done } : {}) }), { revalidate: false }); setDraft(null); if (done) onDone(); }
    catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <Missing items={missItems} value={missValue} label="פריטים חסרים" />
      <SegmentedControl<'all' | 'short'> value={onlyShort} onChange={setOnlyShort} options={[{ value: 'all', label: `הכול · ${ids.length}` }, { value: 'short', label: `רק חסרים · ${shortIds.length}` }]} />
      <div className="rounded-card bg-card px-4 py-1 ring-1 ring-black/[0.04]">
        {(onlyShort === 'short' ? shortIds : ids).map((id) => {
          const p = byId.get(id); if (!p) return null;
          const o = data.ordered[id]; const r = rec[id] ?? 0; const d = Math.max(0, o - r);
          return (
            <div key={id} className={cn('-mx-4 flex items-center gap-3 border-b border-page px-4 py-2.5 last:border-0', d > 0 && 'bg-[#FFF7F2]')}>
              <div className="h-11 w-11 shrink-0 rounded-xl bg-white p-1 ring-1 ring-black/5"><ProductImage p={p} /></div>
              <div className="min-w-0 flex-1">
                <span dir="ltr" className="block truncate text-left text-13 font-bold">{englishName(p.name)}</span>
                <span className="block text-2xs text-ink-400">הוזמנו <bdi>{o}</bdi>{d > 0 && <b className="text-[#C2410C]"> · חסר <bdi>{d}</bdi> · <bdi dir="ltr">{shekelRound(d * (p.price ?? 0))}</bdi></b>}</span>
              </div>
              <Stepper qty={r} size="sm" onChange={(n) => setDraft({ ...rec, [id]: Math.max(0, n) })} />
            </div>
          );
        })}
        {onlyShort === 'short' && shortIds.length === 0 && <p className="py-6 text-center text-13 text-ink-400">הכול הגיע ✓</p>}
      </div>
      {note && <p className="text-center text-xs font-bold text-red-600">{note}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || !draft} onClick={() => void save()} className="rounded-2xl bg-card py-3 text-sm font-extrabold text-ink-700 ring-1 ring-black/5 disabled:opacity-40">שמירה</button>
        <button type="button" disabled={busy} onClick={() => void save(true)} className="rounded-2xl bg-brand-600 py-3 text-sm font-extrabold text-white disabled:opacity-50">✓ סיימתי · לחלוקה ›</button>
      </div>
    </div>
  );
}

/**
 * The split: per runner what they get, what's missing (items and ₪) and what they transfer now.
 * Short products go first-to-send first. A runner's share can be set by hand; "נמסר" tells them.
 */
export function DistributePanel({ round, products, orders, names }: {
  round: PodiumRound; products: PodiumProduct[]; orders: Order[]; names: (athleteId: string) => string;
}) {
  const { data, mutate } = useApi<View>(`/api/admin/podium/receive?round=${round.id}`);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!data) return <div className="h-40 animate-pulse rounded-card bg-card" />;
  if (data.error) return <p className="rounded-card bg-card p-4 text-center text-sm text-ink-500">{data.message}</p>;
  const rows = orders.filter((o) => data.shares[o.id]).map((o) => ({ o, s: data.shares[o.id] }))
    .sort((a, b) => Number(!!a.s.deliveredAt) - Number(!!b.s.deliveredAt) || b.s.missingValue - a.s.missingValue || names(a.o.athleteId).localeCompare(names(b.o.athleteId), 'he'));
  const missItems = rows.reduce((t, r) => t + sumQty(r.s.missing), 0);
  const missValue = rows.reduce((t, r) => t + r.s.missingValue, 0);
  const delivered = rows.filter((r) => r.s.deliveredAt).length;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setNote(null);
    try { await fn(); await mutate(); } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  const cur = rows.find((r) => r.o.id === open);
  return (
    <div className="space-y-3">
      <Missing items={missItems} value={missValue} label="חסר אצל רצים" />
      <div className="rounded-2xl bg-card px-4 py-3 text-13 ring-1 ring-black/[0.04]">
        <b className="block text-ink-900">איך מתחלק חוסר</b>
        <span className="text-ink-500">מי ששלח קודם מקבל קודם. אפשר לתקן ידנית לכל רץ.{data.over.length > 0 && <b className="text-red-600"> חולק יותר ממה שהגיע ב-<bdi>{data.over.length}</bdi> מוצרים.</b>}</span>
      </div>
      <div className="rounded-card bg-card px-4 py-1 ring-1 ring-black/[0.04]">
        <p className="py-2 text-2xs font-bold text-ink-400">נמסרו <bdi>{delivered}</bdi> מתוך <bdi>{rows.length}</bdi></p>
        {rows.map(({ o, s }) => {
          const got = sumQty(s.got); const want = got + sumQty(s.missing);
          return (
            <button key={o.id} type="button" onClick={() => setOpen(o.id)} className={cn('flex w-full items-center gap-3 border-t border-page py-3 text-start', s.deliveredAt && 'opacity-60')}>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm text-ink-900">{names(o.athleteId)}{s.manual && <span className="ms-1 text-3xs text-brand-600">✎ ידני</span>}</b>
                <span className="text-2xs text-ink-400"><bdi>{got}</bdi> מתוך <bdi>{want}</bdi> פריטים{s.missingValue > 0 ? <b className="text-[#C2410C]"> · חסר <bdi>{want - got}</bdi> · <bdi dir="ltr">{shekelRound(s.missingValue)}</bdi></b> : ' · ✓ מלא'}{s.owes > 0 ? <> · להעביר <bdi dir="ltr">{shekelRound(s.owes)}</bdi></> : ''}</span>
              </span>
              <span className={cn('rounded-pill px-2 py-0.5 text-3xs font-extrabold', s.deliveredAt ? 'bg-page text-ink-500' : s.missingValue > 0 ? 'bg-[#FFF1EA] text-[#9A3412]' : 'bg-accent-600/10 text-accent-900')}>{s.deliveredAt ? 'נמסר' : s.missingValue > 0 ? 'חלקי' : 'מוכן'}</span>
              <ChevronRight className="h-4 w-4 rotate-180 text-ink-300" />
            </button>
          );
        })}
      </div>
      {note && <p className="text-center text-xs font-bold text-red-600">{note}</p>}
      <a href={`/api/admin/podium/csv?round=${round.id}&kind=packing`} className="flex items-center justify-center gap-1.5 rounded-2xl bg-ink-900 py-3 text-sm font-extrabold text-white"><Download className="h-4 w-4" />רשימת אריזה (CSV)</a>

      <Sheet open={!!cur} onOpenChange={(v) => { if (!v) setOpen(null); }} title={cur ? names(cur.o.athleteId) : ''}>
        {cur && <ShareEditor key={cur.o.id + (cur.s.manual ? 'm' : 'a')} order={cur.o} share={cur.s} products={products} budget={round.budget} busy={busy}
          onSave={(alloc) => act(() => post(`/api/admin/podium/orders/${cur.o.id}`, { allocation: alloc }, 'PATCH'))}
          onDeliver={(v) => act(() => post(`/api/admin/podium/orders/${cur.o.id}`, { delivered: v }, 'PATCH')).then(() => { if (v) setOpen(null); })} />}
      </Sheet>
    </div>
  );
}

function ShareEditor({ order, share, products, budget, busy, onSave, onDeliver }: {
  order: Order; share: Share & { manual: boolean; deliveredAt: string | null }; products: PodiumProduct[]; budget: number; busy: boolean;
  onSave: (alloc: Qty | null) => void; onDeliver: (v: boolean) => void;
}) {
  const [got, setGot] = useState<Qty>(share.got);
  const byId = new Map(products.map((p) => [p.id, p]));
  const changed = Object.keys(order.items).some((id) => (got[id] ?? 0) !== (share.got[id] ?? 0));
  const val = (q: Qty) => Object.entries(q).reduce((s, [id, n]) => s + n * (byId.get(id)?.price ?? 0), 0);
  const ordered = val(order.items); const gv = val(got); const owes = Math.max(0, gv - budget);
  return (
    <div className="space-y-3 pb-2">
      <div className="divide-y divide-page">
        {Object.entries(order.items).map(([id, want]) => {
          const p = byId.get(id); if (!p) return null;
          const g = got[id] ?? 0; const d = want - g;
          return (
            <div key={id} className="flex items-center gap-3 py-2.5">
              <div className="h-11 w-11 shrink-0 rounded-xl bg-white p-1 ring-1 ring-black/5"><ProductImage p={p} /></div>
              <div className="min-w-0 flex-1">
                <span dir="ltr" className="block truncate text-left text-13 font-bold">{englishName(p.name)}</span>
                <span className="block text-2xs text-ink-400">הזמין <bdi>{want}</bdi>{d > 0 ? <b className="text-[#C2410C]"> · מקבל <bdi>{g}</bdi> · חסר <bdi>{d}</bdi> · <bdi dir="ltr">{shekelRound(d * (p.price ?? 0))}</bdi></b> : ' · מקבל הכול'}</span>
              </div>
              <Stepper qty={g} size="sm" disabled={!!share.deliveredAt} onChange={(n) => setGot({ ...got, [id]: Math.max(0, Math.min(want, n)) })} />
            </div>
          );
        })}
      </div>
      <div className="space-y-1.5 rounded-2xl bg-page p-3.5 text-sm">
        <div className="flex justify-between"><span>הזמין</span><bdi dir="ltr">{shekelRound(ordered)}</bdi></div>
        {ordered > gv && <div className="flex justify-between font-bold text-[#C2410C]"><span>חסר</span><bdi dir="ltr">−{shekelRound(ordered - gv)}</bdi></div>}
        <div className="flex justify-between border-t border-card pt-2 text-base font-black"><span>שווי מה שמקבל</span><bdi dir="ltr">{shekelRound(gv)}</bdi></div>
        {owes > 0 && <div className="flex justify-between font-extrabold text-[#C2410C]"><span>להעביר למועדון (מעל <bdi dir="ltr">{shekelRound(budget)}</bdi>)</span><bdi dir="ltr">{shekelRound(owes)}</bdi></div>}
      </div>
      {!share.deliveredAt && (changed || share.manual) && (
        <div className="flex gap-2">
          {changed && <button type="button" disabled={busy} onClick={() => onSave(got)} className="flex-1 rounded-2xl bg-ink-900 py-3 text-sm font-extrabold text-white">שמירת חלוקה ידנית</button>}
          {share.manual && <button type="button" disabled={busy} onClick={() => onSave(null)} className="flex items-center gap-1 rounded-2xl bg-page px-3 text-13 font-bold text-ink-600"><RotateCcw className="h-4 w-4" />אוטומטי</button>}
        </div>
      )}
      {share.deliveredAt
        ? <button type="button" disabled={busy} onClick={() => onDeliver(false)} className="w-full rounded-2xl bg-page py-3 text-sm font-extrabold text-ink-600">ביטול &quot;נמסר&quot;</button>
        : <button type="button" disabled={busy || changed} onClick={() => onDeliver(true)} className="w-full rounded-2xl bg-brand-600 py-3.5 font-extrabold text-white disabled:opacity-50">✓ נמסר · הרץ יקבל התראה מה קיבל</button>}
      {changed && !share.deliveredAt && <p className="text-center text-2xs text-ink-400">קודם שומרים את השינוי</p>}
    </div>
  );
}
