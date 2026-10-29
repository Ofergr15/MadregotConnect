'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ExternalLink, Search, ShoppingBag, Lock, Settings2, Trash2, Users } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { textMatches } from '@/lib/search/match';
import { cn } from '@/lib/utils';
import { Sheet, SkeletonCard, EmptyState } from '@/components/ui';
import {
  AUDIENCE_TAG, GROUPS, orderable, englishName, groupOf, hebrewName, itemCount, orderTotal, overBy,
  type Approval, type PodiumProduct, type PodiumRound, type RoundState,
} from '@/lib/podium/model';
import { Price, ProductCard, ProductImage, ProductLine, Stepper, shekel, shekelRound, timeLeft, whenIL } from '@/components/podium/parts';

interface Mine { id: string; items: Record<string, number>; submittedAt: string | null; approval: Approval; updatedAt: string; editedByClub: boolean }
interface Delivered { at: string; got: Record<string, number>; missing: Record<string, number>; gotValue: number; missingValue: number; owes: number }
interface Person { id: string; name: string; submitted: boolean; total: number; budget: number }
interface GroupOrder { id: string; label: string; submitted: boolean; total: number; budget: number }
interface Resp {
  staff: boolean; round: (PodiumRound & { state: RoundState }) | null; products?: PodiumProduct[]; order?: Mine | null; delivered?: Delivered | null; error?: string;
  /** This order's budget (the person's own, a group order's own, else the round's). */
  budget?: number;
  /** May order for other members (Ofer, 10-29): then who, and the round's people and group orders. */
  forOthers?: boolean;
  target?: { kind: 'me' | 'person' | 'group' | 'none'; id: string | null; name: string | null };
  people?: Person[]; groups?: GroupOrder[]; expected?: number | null;
}

/**
 * הזמנת פודיום — the club's order from Podium (lib/podium/model), for whoever the round is open to. The cart saves itself as you tap;
 * "שליחה" sends it to the club. Above the budget the runner is warned (a toast when the cart crosses
 * it, a note by the send button) and may still send — they transfer the difference; no approval. Was: the
 * difference and the club approves. After the lock everything is read-only.
 */
export default function PodiumOrderPage() {
  // Whose order is on screen: '' mine, an athlete id, or 'g:<orderId>' a group order (ordering for others, 10-29).
  const [forId, setForId] = useState('');
  const { data, mutate, isLoading } = useApi<Resp>(`/api/podium${forId ? `?for=${encodeURIComponent(forId)}` : ''}`);
  const round = data?.round ?? null;
  const products = useMemo(() => data?.products ?? [], [data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [items, setItems] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Mine | null>(null);
  const [picking, setPicking] = useState(false);
  // Loaded once per order: switching whom you order for loads that cart afresh.
  const loaded = useRef<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!data || loaded.current === forId) return;
    // useApi keeps the last response while the next loads: wait for the one that is this person's.
    const t = data.target;
    const isThis = !forId ? !t || t.kind === 'me' || t.kind === 'none' : forId.startsWith('g:') ? t?.kind === 'group' && `g:${t.id}` === forId : t?.id === forId;
    if (!isThis) return;
    loaded.current = forId;
    setLoadedFor(forId);
    setItems(data.order?.items ?? {});
    setMine(data.order ?? null);
    setView(data.order?.submittedAt && data.round?.state === 'open' ? 'done' : 'shop');
    if (data.target?.kind === 'none') setPicking(true);
  }, [data, forId]);
  const target = data?.target;
  const others = target && target.kind !== 'me' && target.kind !== 'none';
  const whoName = target?.kind === 'group' ? `👥 ${target.name ?? ''}` : (target?.name ?? '').split(' ')[0];
  const choose = (id: string) => { if (timer.current) { clearTimeout(timer.current); timer.current = null; void save(items); } setPicking(false); setMsg(null); setSaving('idle'); setForId(id); window.scrollTo({ top: 0 }); };

  const [group, setGroup] = useState<string>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<PodiumProduct | null>(null);
  // A sent order opens on its 'done' summary; ✏️ עריכה goes to the cart (Ofer 10-26).
  const [view, setView] = useState<'done' | 'shop' | 'cart'>('shop');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Not while the switched-to cart is still loading: a tap would land on the last person's.
  const editable = round?.state === 'open' && loadedFor === forId;
  const total = orderTotal(items, byId);
  const count = itemCount(items);
  const budget = data?.budget ?? round?.budget ?? 600;
  const credit = round ? budget - round.budget : 0;
  const over = overBy(total, budget);
  const lines = Object.entries(items).filter(([id]) => byId.has(id));

  // The cart saves itself: 700ms after the last tap, the whole cart in one PUT.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(async (next: Record<string, number>, submit = false) => {
    setSaving('saving');
    const res = await fetch('/api/podium', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ items: next, submit, ...(forId ? { for: forId } : {}) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setSaving('error'); setMsg(j.message ?? (j.error === 'over' ? 'מעל התקציב: צריך לאשר שההפרש עליך' : 'לא נשמר. נסו שוב.')); return false; }
    setMine(j.order); setSaving('saved'); setMsg(null);
    void mutate((d) => (d ? { ...d, order: j.order } : d), { revalidate: !!forId });
    return true;
  }, [mutate, forId]);
  const [crossed, setCrossed] = useState<number | null>(null);
  const setQty = (id: string, qn: number) => {
    if (!editable) return;
    const next = { ...items };
    if (qn > 0) next[id] = qn; else delete next[id];
    // The moment this tap takes the cart over the budget: say so (Ofer 10-28) — a warning, not a block.
    const after = orderTotal(next, byId);
    if (after > budget && total <= budget) { setCrossed(after - budget); setTimeout(() => setCrossed(null), 4500); }
    setItems(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void save(next); }, 700);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const send = async () => {
    if (timer.current) clearTimeout(timer.current);
    setSending(true);
    const ok = await save(items, true);
    setSending(false);
    if (ok) { setView('done'); window.scrollTo({ top: 0 }); }
  };

  const shown = products.filter((p) => orderable(p) && (group === 'all' || groupOf(p.dept) === group) && (!q.trim() || textMatches(q, p.name)));
  const groups = GROUPS.filter((g) => products.some((p) => groupOf(p.dept) === g.key));

  if (isLoading && !data) return <div className="grid grid-cols-2 gap-3 pt-16">{Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} className="h-60" />)}</div>;
  if (!round) {
    return (
      <div className="space-y-4">
        <Header staff={!!data?.staff} />
        <EmptyState icon={ShoppingBag} title="אין כרגע הזמנה מפודיום" description="כשהמועדון יפתח הזמנה, היא תופיע כאן ותגיע התראה." className="py-12" />
      </div>
    );
  }

  const status = statusLine(round, mine);
  return (
    <div className="space-y-3 pb-28">
      <Header staff={!!data?.staff} title={round.title} tag={AUDIENCE_TAG[round.audience]} sub={round.state === 'upcoming' ? `נפתחת ${whenIL(round.opensAt)}` : round.state === 'open' ? `אפשר להזמין עד ${whenIL(round.locksAt)}` : 'ההזמנה נסגרה'} />

      {data?.forOthers && (
        <ForBar target={target} name={whoName} onOpen={() => setPicking(true)} />
      )}
      {others && (
        <p className="rounded-2xl bg-brand-600/10 px-3.5 py-2.5 text-13 font-bold leading-relaxed text-brand-700">
          {target?.kind === 'group'
            ? <>את/ה ממלא/ת את הזמנת הקבוצה „{target.name}”. היא נכנסת לסיכום ולקובץ לפודיום כמו כל הזמנה.</>
            : <>את/ה ממלא/ת את ההזמנה של {whoName}. כשתשלח/י, {whoName} יקבל/תקבל התראה ויוכל/תוכל לראות ולשנות עד הסגירה.</>}
        </p>
      )}

      {target?.kind === 'none' && (
        <div className="rounded-card bg-card px-6 py-10 text-center ring-1 ring-black/[0.04]">
          <Users className="mx-auto h-10 w-10 text-ink-300" />
          <p className="mt-3 text-base font-extrabold text-ink-900">הסבב לא פתוח לך</p>
          <p className="mt-1 text-13 text-ink-500">אפשר להזמין עבור מי שהסבב פתוח לו</p>
          <button type="button" onClick={() => setPicking(true)} className="mt-4 rounded-2xl bg-brand-600 px-5 py-3 text-sm font-extrabold text-white">לבחור עבור מי</button>
        </div>
      )}

      {target?.kind !== 'none' && status && view !== 'done' && <div className={cn('flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-13 font-bold', status.tone)}>{status.icon}<span className="flex-1">{status.text}</span></div>}

      {target?.kind !== 'none' && (data?.delivered ? <Got d={data.delivered} byId={byId} /> : <Budget total={total} budget={budget} credit={credit} who={others ? whoName : null} />)}

      {target?.kind !== 'none' && round.state !== 'upcoming' && !data?.delivered && view !== 'done' && (
        <div className="flex rounded-2xl bg-[#E3E5EB] p-1">
          {([['shop', 'מוצרים'], ['cart', others ? `העגלה של ${whoName}` : 'העגלה שלי']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setView(k); window.scrollTo({ top: 0 }); }}
              className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition-colors', view === k ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-500')}>
              {l}{k === 'cart' && count > 0 && <bdi className={cn('min-w-[22px] rounded-pill px-1.5 text-xs leading-5 text-white', over > 0 ? 'bg-[#FF5A1F]' : 'bg-brand-600')}>{count}</bdi>}
            </button>
          ))}
        </div>
      )}

      {target?.kind !== 'none' && round.state !== 'upcoming' && !data?.delivered && view === 'shop' && (
        <>
          <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 ring-1 ring-black/[0.04]">
            <Search className="h-4 w-4 text-ink-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש מוצר" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400" />
          </div>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {[{ key: 'all', label: 'הכול' }, ...groups].map((g) => (
              <button key={g.key} type="button" onClick={() => setGroup(g.key)}
                className={cn('shrink-0 rounded-pill px-3.5 py-1.5 text-13 font-bold', group === g.key ? 'bg-ink-900 text-white' : 'bg-card text-ink-500 ring-1 ring-black/[0.04]')}>{g.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {shown.map((p) => <ProductCard key={p.id} p={p} qty={items[p.id] ?? 0} onQty={(n) => setQty(p.id, n)} onOpen={() => setOpen(p)} locked={!editable} />)}
          </div>
          {shown.length === 0 && <p className="py-8 text-center text-sm text-ink-400">לא נמצאו מוצרים</p>}
        </>
      )}

      {/* העגלה שלי — the whole order on one screen: every line with its photo, quantity, remove
          and line total; the totals against the budget; the over-budget confirmation; send. */}
      {round.state !== 'upcoming' && !data?.delivered && view === 'cart' && (
        count === 0 ? (
          <div className="rounded-card bg-card px-6 py-10 text-center ring-1 ring-black/[0.04]">
            <ShoppingBag className="mx-auto h-10 w-10 text-ink-300" />
            <p className="mt-3 text-base font-extrabold text-ink-900">העגלה ריקה</p>
            <p className="mt-1 text-13 text-ink-500">מוסיפים מוצרים עם ה-+ בכל מוצר</p>
            <button type="button" onClick={() => setView('shop')} className="mt-4 rounded-2xl bg-brand-600 px-5 py-3 text-sm font-extrabold text-white">למוצרים</button>
          </div>
        ) : (
          <>
            <div className="rounded-card bg-card px-4 py-1 ring-1 ring-black/[0.04]">
              {lines.map(([id, n]) => {
                const p = byId.get(id)!;
                return (
                  <div key={id} className="flex gap-3 border-b border-page py-3 last:border-0">
                    <button type="button" onClick={() => setOpen(p)} className="h-[68px] w-[68px] shrink-0 rounded-2xl bg-white p-1.5 ring-1 ring-black/5"><ProductImage p={p} /></button>
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => setOpen(p)} dir="ltr" className="block w-full truncate text-left text-13 font-bold text-ink-900">{englishName(p.name)}</button>
                      <span className="block text-2xs text-ink-400"><bdi dir="ltr">{shekel(p.price ?? 0)}</bdi> ליחידה{hebrewName(p.name) ? ` · ${hebrewName(p.name)}` : ''}</span>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Stepper qty={n} size="sm" disabled={!editable} onChange={(v) => setQty(id, v)} />
                        <b className="text-[15px] font-black tabular-nums"><bdi dir="ltr">{shekelRound((p.price ?? 0) * n)}</bdi></b>
                      </div>
                    </div>
                    {editable && <button type="button" aria-label="להסיר" onClick={() => setQty(id, 0)} className="self-start p-1 text-ink-300 active:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5 rounded-card bg-card p-4 text-sm ring-1 ring-black/[0.04]">
              <Row k="פריטים" v={String(count)} />
              <Row k="סה״כ משוער" v={shekelRound(total)} big />
              <Row k={others ? 'התקציב' : 'התקציב שלך'} v={shekelRound(budget)} />
              {over > 0 ? <Row k={others ? 'ההפרש' : 'ההפרש שעליך'} v={shekelRound(over)} tone="text-[#C2410C] font-extrabold" /> : <Row k="נשאר בתקציב" v={shekelRound(budget - total)} tone="text-ink-500" />}
              <p className="pt-1 text-2xs leading-relaxed text-ink-400">המחירים מהאתר של פודיום, במחיר רגיל (בלי מבצעים). המחיר הסופי נקבע בחנות.</p>
            </div>

            {editable && (
              <div className="space-y-2">
                {over > 0 && (
                  <div className="flex items-start gap-2.5 rounded-2xl bg-[#FFF1EA] p-3.5 text-13 text-[#9A3412]">
                    <span className="text-lg leading-none">⚠️</span>
                    <span><b>{others ? 'מעל התקציב' : 'עברת את התקציב'} ב-<bdi dir="ltr">{shekelRound(over)}</bdi>.</b> אפשר לשלוח כך. {others ? (target?.kind === 'group' ? 'ההפרש על המועדון.' : `ההפרש על ${whoName}, ומעבירים אותו למועדון.`) : 'ההפרש עליך, ומעבירים אותו למועדון.'}</span>
                  </div>
                )}
                {msg && <p className="text-center text-xs font-bold text-red-600">{msg}</p>}
                <button type="button" disabled={sending} onClick={() => void send()}
                  className="w-full rounded-2xl bg-brand-600 py-4 text-base font-extrabold text-white disabled:opacity-50">
                  {sending ? 'שולח…' : mine?.submittedAt ? (others ? `עדכון ההזמנה של ${whoName}` : 'עדכון ההזמנה') : others ? `✓ לשלוח את ההזמנה של ${whoName}` : '✓ שליחת ההזמנה'}
                </button>
                <p className="text-center text-2xs text-ink-400">{saving === 'saving' ? 'שומר…' : 'כל שינוי נשמר לבד'} · אפשר לשנות עד {whenIL(round.locksAt)}</p>
              </div>
            )}
          </>
        )
      )}

      {/* בוצע: the sent order at a glance, until when it can change, and the way back in. */}
      {round.state === 'open' && !data?.delivered && view === 'done' && mine?.submittedAt && (
        <div className="rounded-card bg-card p-5 ring-1 ring-black/[0.04]">
          <div className="text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#16A34A] text-2xl font-black text-white">✓</span>
            <p className="mt-3 text-xl font-black text-ink-900">{others ? `ההזמנה של ${whoName} בוצעה` : 'ההזמנה בוצעה'}</p>
            <p className="mt-1 text-13 text-ink-500"><bdi>{count}</bdi> פריטים · <bdi dir="ltr">{shekelRound(total)}</bdi>{over > 0 ? <span className="text-[#C2410C]"> · מעל התקציב ב-<bdi dir="ltr">{shekelRound(over)}</bdi></span> : ''}</p>
          </div>
          <div className="mt-4 rounded-2xl bg-[#ECFDF5] px-4 py-3 text-center text-[#065F46]">
            <b className="block text-sm">אפשר לערוך עד {whenIL(round.locksAt)}</b>
            {timeLeft(round.locksAt) && <span className="text-13">{timeLeft(round.locksAt)}</span>}
          </div>
          <div className="mt-3 divide-y divide-page">
            {lines.map(([id, n]) => <ProductLine key={id} p={byId.get(id)!} qty={n} right={<b className="min-w-[48px] text-left text-13 tabular-nums"><bdi dir="ltr">{shekelRound((byId.get(id)!.price ?? 0) * n)}</bdi></b>} />)}
          </div>
          <button type="button" onClick={() => { setView('cart'); window.scrollTo({ top: 0 }); }} className="mt-4 w-full rounded-2xl bg-ink-900 py-3.5 text-base font-extrabold text-white">✏️ עריכת ההזמנה</button>
        </div>
      )}

      {crossed != null && (
        <div role="status" className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+64px)] z-40 mx-auto max-w-md rounded-2xl bg-[#FF5A1F] px-4 py-3 text-sm font-bold text-white shadow-[0_12px_30px_-8px_rgb(0_0_0/0.45)]">
          ⚠️ {others ? 'מעל התקציב' : 'עברת את התקציב'} של <bdi dir="ltr">{shekelRound(budget)}</bdi>{others ? '' : ' · ההפרש עליך'}
        </div>
      )}

      {count > 0 && !data?.delivered && view === 'shop' && (
        <button type="button" onClick={() => { setView('cart'); window.scrollTo({ top: 0 }); }}
          className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-30 mx-auto flex max-w-md items-center justify-between rounded-[20px] bg-ink-900 px-4 py-3.5 text-white shadow-[0_14px_30px_-6px_rgb(0_0_0/0.5)]">
          <span className="text-start"><b className="block text-sm"><bdi>{count}</bdi> פריטים</b><small className="text-2xs opacity-70">{saving === 'saving' ? 'שומר…' : saving === 'error' ? 'לא נשמר' : mine?.submittedAt ? 'נשלח · השינויים נשמרים' : 'טיוטה · נשמר אוטומטית'}</small></span>
          <span className={cn('rounded-xl px-3.5 py-2 text-sm font-extrabold', over > 0 ? 'bg-[#FF5A1F]' : 'bg-brand-600')}><bdi dir="ltr">{shekelRound(total)}</bdi> · לעגלה ›</span>
        </button>
      )}

      {data?.forOthers && (
        <Sheet open={picking} onOpenChange={setPicking} title="מזמין עבור">
          <Picker data={data} current={forId} onPick={choose} />
        </Sheet>
      )}

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }} title="">
        {open && <ProductSheet p={open} qty={items[open.id] ?? 0} onQty={(n) => setQty(open.id, n)} locked={!editable} />}
      </Sheet>
    </div>
  );
}

function Header({ staff, title = 'הזמנת פודיום', sub, tag }: { staff: boolean; title?: string; sub?: string; tag?: string }) {
  return (
    <div className="flex items-end justify-between gap-3 pt-1">
      <div className="min-w-0">
        <Link href="/dashboard/store" className="mb-1 flex w-fit items-center gap-0.5 text-13 font-bold text-brand-600"><ChevronRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />החנות</Link>
        {tag && <span className="mb-1 block w-fit rounded-pill bg-card px-2.5 py-0.5 text-3xs font-extrabold text-ink-500 ring-1 ring-black/5">{tag}</span>}
        <h1 className="text-[26px] font-black leading-tight tracking-tight text-ink-900">{title}</h1>
        {sub && <p className="text-13 text-ink-500">{sub}</p>}
      </div>
      {staff && <Link href="/dashboard/store/podium/admin" className="flex shrink-0 items-center gap-1 rounded-pill bg-card px-3 py-2 text-13 font-bold text-ink-700 ring-1 ring-black/5"><Settings2 className="h-4 w-4" />ניהול</Link>}
    </div>
  );
}

/** Handed over (lib/podium/receive): what came, what didn't, and what to transfer — recomputed on what came. */
function Got({ d, byId }: { d: Delivered; byId: Map<string, PodiumProduct> }) {
  const lines = Object.keys({ ...d.got, ...d.missing }).filter((id) => byId.has(id));
  const got = Object.values(d.got).reduce((a, b) => a + b, 0);
  const miss = Object.values(d.missing).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-3">
      <div className="rounded-card bg-card p-4 ring-1 ring-black/[0.04]">
        <p className="text-base font-black text-ink-900">📦 ההזמנה שלך אצלך</p>
        <p className="text-13 text-ink-500">{miss > 0 ? <>קיבלת <bdi>{got}</bdi> מתוך <bdi>{got + miss}</bdi> פריטים. <bdi>{miss}</bdi> לא הגיעו מהחנות.</> : <>קיבלת את כל <bdi>{got}</bdi> הפריטים.</>}</p>
        <div className="mt-2 divide-y divide-page">
          {lines.map((id) => {
            const g = d.got[id] ?? 0; const m = d.missing[id] ?? 0; const p = byId.get(id)!;
            return <ProductLine key={id} p={p} qty={g} right={m > 0 ? <span className="text-2xs font-extrabold text-[#C2410C]">חסר <bdi>{m}</bdi></span> : undefined} />;
          })}
        </div>
        <div className="mt-3 space-y-1.5 rounded-2xl bg-page p-3.5 text-sm">
          {d.missingValue > 0 && <div className="flex justify-between font-bold text-[#C2410C]"><span>לא הגיע</span><bdi dir="ltr">{shekelRound(d.missingValue)}</bdi></div>}
          <div className="flex justify-between font-black"><span>שווי מה שקיבלת</span><bdi dir="ltr">{shekelRound(d.gotValue)}</bdi></div>
          {d.owes > 0 && <div className="flex justify-between font-extrabold text-[#C2410C]"><span>להעביר למועדון</span><bdi dir="ltr">{shekelRound(d.owes)}</bdi></div>}
        </div>
        {d.owes > 0 && <p className="mt-2 text-2xs text-ink-400">ההפרש חושב מחדש לפי מה שקיבלת בפועל.</p>}
      </div>
    </div>
  );
}

/** "מזמין עבור: …" — whose order this is, and the way to switch (only for who may order for others). */
function ForBar({ target, name, onOpen }: { target: Resp['target']; name: string; onOpen: () => void }) {
  const me = !target || target.kind === 'me';
  return (
    <button type="button" onClick={onOpen}
      className={cn('flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-start ring-1', me ? 'bg-card ring-black/[0.04]' : 'bg-ink-900 text-white ring-ink-900')}>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black', me ? 'bg-page text-ink-500' : 'bg-white/15')}>{target?.kind === 'group' ? '👥' : <Users className="h-4 w-4" />}</span>
      <span className="min-w-0 flex-1">
        <small className={cn('block text-2xs font-bold', me ? 'text-ink-400' : 'text-white/60')}>מזמין עבור</small>
        <b className="block truncate text-sm">{target?.kind === 'none' ? 'לבחור…' : me ? 'אני' : name}</b>
      </span>
      <span className={cn('flex items-center text-13 font-bold', me ? 'text-brand-600' : 'text-white/80')}>להחליף<ChevronLeft className="h-4 w-4 ltr:rotate-180" /></span>
    </button>
  );
}

/** Everyone the round is open to, who sent and for how much, and the round's group orders. */
function Picker({ data, current, onPick }: { data: Resp; current: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const people = (data.people ?? []).filter((p) => !q.trim() || textMatches(q, p.name));
  const groups = (data.groups ?? []).filter((g) => !q.trim() || textMatches(q, g.label));
  const sent = (data.people ?? []).filter((p) => p.submitted).length + (data.groups ?? []).filter((g) => g.submitted).length;
  const expected = data.expected ?? (data.people ?? []).length + (data.groups ?? []).length;
  const row = (key: string, label: React.ReactNode, sub: React.ReactNode, on: boolean, done: boolean) => (
    <button key={key} type="button" onClick={() => onPick(key)}
      className={cn('flex w-full items-center gap-3 border-b border-page py-3 text-start last:border-0', on && 'font-black')}>
      <span className="min-w-0 flex-1"><b className="block truncate text-sm text-ink-900">{label}</b><small className="text-2xs text-ink-400">{sub}</small></span>
      <span className={cn('shrink-0 rounded-pill px-2.5 py-1 text-3xs font-extrabold', done ? 'bg-[#16A34A]/10 text-[#15803D]' : 'bg-page text-ink-500')}>{done ? 'הזמין' : 'עוד לא'}</span>
      {on && <span className="text-brand-600">✓</span>}
    </button>
  );
  return (
    <div className="space-y-3 pb-2">
      <p className="text-13 text-ink-500">נשלחו <bdi>{sent}</bdi> מתוך <bdi>{expected}</bdi></p>
      <div className="flex items-center gap-2 rounded-xl bg-page px-3 py-2.5">
        <Search className="h-4 w-4 text-ink-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400" />
      </div>
      <div>
        {data.target?.kind !== 'none' && !q.trim() && (
          <button type="button" onClick={() => onPick('')} className="flex w-full items-center gap-3 border-b border-page py-3 text-start">
            <b className="flex-1 text-sm text-ink-900">אני</b>{current === '' && <span className="text-brand-600">✓</span>}
          </button>
        )}
        {people.map((p) => row(p.id, p.name, p.submitted || p.total > 0 ? <><bdi dir="ltr">{shekelRound(p.total)}</bdi> מתוך <bdi dir="ltr">{shekelRound(p.budget)}</bdi></> : `תקציב ${shekelRound(p.budget)}`, current === p.id, p.submitted))}
      </div>
      {groups.length > 0 && (
        <div>
          <p className="pt-1 text-xs font-extrabold text-ink-500">👥 הזמנות קבוצה</p>
          {groups.map((g) => row(`g:${g.id}`, g.label, <><bdi dir="ltr">{shekelRound(g.total)}</bdi> מתוך <bdi dir="ltr">{shekelRound(g.budget)}</bdi></>, current === `g:${g.id}`, g.submitted))}
        </div>
      )}
    </div>
  );
}

function Budget({ total, budget, credit = 0, who = null }: { total: number; budget: number; credit?: number; who?: string | null }) {
  const pct = Math.min(100, (total / budget) * 100);
  const over = total > budget;
  return (
    <div className="rounded-2xl bg-card px-4 py-3 ring-1 ring-black/[0.04]">
      <div className="flex items-baseline justify-between text-13">
        <span className="font-bold text-ink-700">{who ? `התקציב של ${who}` : 'התקציב שלך'}</span>
        <span className="tabular-nums"><b className={cn('text-base font-black', over ? 'text-[#C2410C]' : 'text-ink-900')}><bdi>{shekelRound(total)}</bdi></b><span className="text-ink-400"> / <bdi>{shekelRound(budget)}</bdi></span></span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-pill bg-page"><div className={cn('h-full rounded-pill transition-all', over ? 'bg-[#FF5A1F]' : 'bg-brand-600')} style={{ width: `${over ? 100 : pct}%` }} /></div>
      <p className="mt-1.5 text-2xs text-ink-400">
        {over ? (who ? `מעל התקציב ב-${shekelRound(total - budget)}. אפשר להזמין, וההפרש משולם למועדון.` : `עברת את התקציב ב-${shekelRound(total - budget)}. אפשר להזמין, וההפרש עליך: מעבירים אותו למועדון.`) : `נשארו ${shekelRound(budget - total)}`}
        {credit > 0 && <> · כולל קרדיט <bdi dir="ltr">{shekelRound(credit)}</bdi></>}
      </p>
    </div>
  );
}

function Row({ k, v, big, tone }: { k: string; v: string; big?: boolean; tone?: string }) {
  return <div className={cn('flex justify-between', big && 'border-t border-card pt-2 text-base font-black', tone)}><span>{k}</span><bdi className="tabular-nums">{v}</bdi></div>;
}

function statusLine(round: { state: RoundState; locksAt: string }, mine: Mine | null): { text: string; tone: string; icon: React.ReactNode } | null {
  if (round.state === 'upcoming') return { text: 'עוד לא נפתח. תגיע התראה כשאפשר להזמין.', tone: 'bg-page text-ink-500', icon: '⏳' };
  if (round.state !== 'open') {
    return mine?.submittedAt
      ? { text: round.state === 'sent' ? 'ההזמנה נשלחה לפודיום. נעדכן כשהיא אצלך.' : 'ההזמנה נסגרה. אי אפשר לשנות.', tone: 'bg-page text-ink-700', icon: <Lock className="h-4 w-4" /> }
      : { text: 'ההזמנה נסגרה.', tone: 'bg-page text-ink-500', icon: <Lock className="h-4 w-4" /> };
  }
  if (mine?.approval === 'rejected') return { text: 'המועדון לא אישר את החריגה. צריך להוריד לתקציב.', tone: 'bg-red-50 text-red-700', icon: '✋' };
  if (mine?.editedByClub && mine.submittedAt) return { text: 'המועדון עדכן את ההזמנה שלך', tone: 'bg-brand-600/10 text-brand-700', icon: '✏️' };
  if (mine?.approval === 'approved' && mine.submittedAt) return { text: 'ההזמנה אושרה. נשאר להעביר את ההפרש.', tone: 'bg-accent-600/10 text-accent-900', icon: '✅' };
  if (mine?.submittedAt) return { text: `בוצע ✓ אפשר לערוך עד ${whenIL(round.locksAt)}${timeLeft(round.locksAt) ? ` (${timeLeft(round.locksAt)})` : ''}`, tone: 'bg-accent-600/10 text-accent-900', icon: '✓' };
  if (mine && Object.keys(mine.items).length > 0) return { text: `ההזמנה בתהליך · עוד לא נשלחה · נסגרת ${whenIL(round.locksAt)}${timeLeft(round.locksAt) ? ` (${timeLeft(round.locksAt)})` : ''}`, tone: 'bg-[#FFF1EA] text-[#9A3412]', icon: '🛒' };
  return null;
}

function ProductSheet({ p, qty, onQty, locked }: { p: PodiumProduct; qty: number; onQty: (n: number) => void; locked: boolean }) {
  return (
    <div className="space-y-3 pb-2">
      <div className="mx-auto aspect-square w-full max-w-[280px] rounded-3xl bg-white p-4"><ProductImage p={p} /></div>
      <div>
        <h3 dir="ltr" className="text-left text-lg font-extrabold leading-snug text-ink-900">{englishName(p.name)}</h3>
        <p className="text-13 text-ink-400">{[hebrewName(p.name), p.dept].filter(Boolean).join(' · ')}</p>
      </div>
      <Price p={p} big />
      <div className="flex items-center justify-between gap-3">
        <Stepper qty={qty} onChange={onQty} disabled={locked} />
        {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-13 font-bold text-brand-600">לעמוד באתר <ExternalLink className="h-3.5 w-3.5" /></a>}
      </div>
      {qty > 0 && p.price != null && <p className="text-13 text-ink-500"><bdi>{qty}</bdi> × {shekel(p.price)} = <b className="text-ink-900"><bdi>{shekelRound(qty * p.price)}</bdi></b></p>}
    </div>
  );
}
