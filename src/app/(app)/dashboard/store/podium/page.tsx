'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ExternalLink, Search, ShoppingBag, Lock, Settings2, Trash2 } from 'lucide-react';
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
interface Resp { staff: boolean; round: (PodiumRound & { state: RoundState }) | null; products?: PodiumProduct[]; order?: Mine | null; delivered?: Delivered | null; error?: string }

/**
 * הזמנת פודיום — the club's order from Podium (lib/podium/model), for whoever the round is open to. The cart saves itself as you tap;
 * "שליחה" sends it to the club. Above the budget the runner confirms they'll transfer the
 * difference and the club approves. After the lock everything is read-only.
 */
export default function PodiumOrderPage() {
  const { data, mutate, isLoading } = useApi<Resp>('/api/podium');
  const round = data?.round ?? null;
  const products = useMemo(() => data?.products ?? [], [data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [items, setItems] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Mine | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!data || loaded.current) return;
    loaded.current = true;
    setItems(data.order?.items ?? {});
    setMine(data.order ?? null);
    if (data.order?.submittedAt && data.round?.state === 'open') setView('done');
  }, [data]);

  const [group, setGroup] = useState<string>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<PodiumProduct | null>(null);
  // A sent order opens on its 'done' summary; ✏️ עריכה goes to the cart (Ofer 10-26).
  const [view, setView] = useState<'done' | 'shop' | 'cart'>('shop');
  const [accept, setAccept] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const editable = round?.state === 'open';
  const total = orderTotal(items, byId);
  const count = itemCount(items);
  const budget = round?.budget ?? 600;
  const over = overBy(total, budget);
  const lines = Object.entries(items).filter(([id]) => byId.has(id));

  // The cart saves itself: 700ms after the last tap, the whole cart in one PUT.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(async (next: Record<string, number>, submit = false) => {
    setSaving('saving');
    const res = await fetch('/api/podium', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ items: next, submit, acceptOverage: submit ? accept : undefined }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setSaving('error'); setMsg(j.message ?? (j.error === 'over' ? 'מעל התקציב: צריך לאשר שההפרש עליך' : 'לא נשמר. נסו שוב.')); return false; }
    setMine(j.order); setSaving('saved'); setMsg(null);
    void mutate((d) => (d ? { ...d, order: j.order } : d), { revalidate: false });
    return true;
  }, [accept, mutate]);
  const setQty = (id: string, qn: number) => {
    if (!editable) return;
    const next = { ...items };
    if (qn > 0) next[id] = qn; else delete next[id];
    setItems(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), 700);
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

      {status && view !== 'done' && <div className={cn('flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-13 font-bold', status.tone)}>{status.icon}<span className="flex-1">{status.text}</span></div>}

      {data?.delivered ? <Got d={data.delivered} byId={byId} /> : <Budget total={total} budget={budget} />}

      {round.state !== 'upcoming' && !data?.delivered && view !== 'done' && (
        <div className="flex rounded-2xl bg-[#E3E5EB] p-1">
          {([['shop', 'מוצרים'], ['cart', 'העגלה שלי']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setView(k); window.scrollTo({ top: 0 }); }}
              className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition-colors', view === k ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-500')}>
              {l}{k === 'cart' && count > 0 && <bdi className={cn('min-w-[22px] rounded-pill px-1.5 text-xs leading-5 text-white', over > 0 ? 'bg-[#FF5A1F]' : 'bg-brand-600')}>{count}</bdi>}
            </button>
          ))}
        </div>
      )}

      {round.state !== 'upcoming' && !data?.delivered && view === 'shop' && (
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
              <Row k="התקציב שלך" v={shekelRound(budget)} />
              {over > 0 ? <Row k="ההפרש שעליך" v={shekelRound(over)} tone="text-[#C2410C] font-extrabold" /> : <Row k="נשאר בתקציב" v={shekelRound(budget - total)} tone="text-ink-500" />}
              <p className="pt-1 text-2xs leading-relaxed text-ink-400">המחירים מהאתר של פודיום, במחיר רגיל (בלי מבצעים). המחיר הסופי נקבע בחנות.</p>
            </div>

            {editable && (
              <div className="space-y-2">
                {over > 0 && (
                  <label className="flex items-start gap-2.5 rounded-2xl bg-[#FFF1EA] p-3 text-13 text-[#9A3412]">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#FF5A1F]" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                    <span><b>מעל התקציב ב-<bdi dir="ltr">{shekelRound(over)}</bdi>.</b> אני מעביר/ה את ההפרש למועדון. ההזמנה תחכה לאישור.</span>
                  </label>
                )}
                {msg && <p className="text-center text-xs font-bold text-red-600">{msg}</p>}
                <button type="button" disabled={sending || (over > 0 && !accept)} onClick={() => void send()}
                  className="w-full rounded-2xl bg-brand-600 py-4 text-base font-extrabold text-white disabled:opacity-50">
                  {sending ? 'שולח…' : mine?.submittedAt ? 'עדכון ההזמנה' : '✓ שליחת ההזמנה'}
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
            <p className="mt-3 text-xl font-black text-ink-900">ההזמנה בוצעה</p>
            <p className="mt-1 text-13 text-ink-500"><bdi>{count}</bdi> פריטים · <bdi dir="ltr">{shekelRound(total)}</bdi>{mine.approval === 'pending' ? ' · מחכה לאישור חריגה' : ''}</p>
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

      {count > 0 && !data?.delivered && view === 'shop' && (
        <button type="button" onClick={() => { setView('cart'); window.scrollTo({ top: 0 }); }}
          className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-30 mx-auto flex max-w-md items-center justify-between rounded-[20px] bg-ink-900 px-4 py-3.5 text-white shadow-[0_14px_30px_-6px_rgb(0_0_0/0.5)]">
          <span className="text-start"><b className="block text-sm"><bdi>{count}</bdi> פריטים</b><small className="text-2xs opacity-70">{saving === 'saving' ? 'שומר…' : saving === 'error' ? 'לא נשמר' : mine?.submittedAt ? 'נשלח · השינויים נשמרים' : 'טיוטה · נשמר אוטומטית'}</small></span>
          <span className={cn('rounded-xl px-3.5 py-2 text-sm font-extrabold', over > 0 ? 'bg-[#FF5A1F]' : 'bg-brand-600')}><bdi dir="ltr">{shekelRound(total)}</bdi> · לעגלה ›</span>
        </button>
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

function Budget({ total, budget }: { total: number; budget: number }) {
  const pct = Math.min(100, (total / budget) * 100);
  const over = total > budget;
  return (
    <div className="rounded-2xl bg-card px-4 py-3 ring-1 ring-black/[0.04]">
      <div className="flex items-baseline justify-between text-13">
        <span className="font-bold text-ink-700">התקציב שלך</span>
        <span className="tabular-nums"><b className={cn('text-base font-black', over ? 'text-[#C2410C]' : 'text-ink-900')}><bdi>{shekelRound(total)}</bdi></b><span className="text-ink-400"> / <bdi>{shekelRound(budget)}</bdi></span></span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-pill bg-page"><div className={cn('h-full rounded-pill transition-all', over ? 'bg-[#FF5A1F]' : 'bg-brand-600')} style={{ width: `${over ? 100 : pct}%` }} /></div>
      <p className="mt-1.5 text-2xs text-ink-400">{over ? `מעל התקציב ב-${shekelRound(total - budget)}: את ההפרש מעבירים למועדון, ואחרי שליחה ההזמנה מחכה לאישור.` : `נשארו ${shekelRound(budget - total)}`}</p>
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
  if (mine?.approval === 'pending' && mine.submittedAt) return { text: 'נשלח · מעל התקציב, מחכה לאישור המועדון', tone: 'bg-[#FFF1EA] text-[#9A3412]', icon: '⏳' };
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
