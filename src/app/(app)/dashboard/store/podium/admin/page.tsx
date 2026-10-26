'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronRight, Download, RefreshCw, Link2, Eye, EyeOff, Plus, Search } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { textMatches } from '@/lib/search/match';
import { cn } from '@/lib/utils';
import { Sheet, SkeletonCard, SegmentedControl } from '@/components/ui';
import {
  AUDIENCES, AUDIENCE_TAG, DEFAULT_BUDGET, englishName, hebrewName, itemCount, orderTotal, overBy, roundTotals,
  type Approval, type Audience, type PodiumProduct, type PodiumRound, type RoundState,
} from '@/lib/podium/model';
import { ProductImage, ProductLine, shekelRound, whenIL } from '@/components/podium/parts';
import { DistributePanel, ReceivePanel } from '@/components/podium/ReceivePanels';

type Round = PodiumRound & { state: RoundState };
interface Order { id: string; athleteId: string; items: Record<string, number>; submittedAt: string | null; approval: Approval; updatedAt: string }
interface Resp { rounds: Round[]; round: Round | null; products: PodiumProduct[]; orders: Order[]; core: string[]; people: Record<string, { name: string; avatarUrl: string | null; isCore?: boolean; isStaff?: boolean }>; error?: string; message?: string }

const STATE: Record<RoundState, { label: string; tone: string }> = {
  upcoming: { label: '⏳ עוד לא נפתח', tone: 'bg-page text-ink-500' },
  open: { label: '🟢 פתוח להזמנות', tone: 'bg-accent-600/10 text-accent-900' },
  locked: { label: '🔒 נסגר לשינויים · מוכן לשליחה', tone: 'bg-[#FFF1EA] text-[#9A3412]' },
  sent: { label: '📦 נשלח לפודיום', tone: 'bg-page text-ink-700' },
};

/** The admin side of הזמנת פודיום (lib/podium): the round, every order, the summary, the file, the catalog. */
export default function PodiumAdminPage() {
  return <Suspense fallback={null}><PodiumAdmin /></Suspense>;
}

function PodiumAdmin() {
  const params = useSearchParams();
  const [roundId, setRoundId] = useState<string | null>(null);
  const key = `/api/admin/podium${roundId ? `?round=${roundId}` : ''}`;
  const { data, mutate, isLoading } = useApi<Resp>(key);
  const [tab, setTab] = useState<'people' | 'products' | 'catalog' | 'receive' | 'split' | null>(() => (params?.get('tab') === 'catalog' ? 'catalog' : null));
  const [edit, setEdit] = useState<string | null>(params?.get('order') ?? null);
  const [roundForm, setRoundForm] = useState<Partial<Round> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const products = useMemo(() => data?.products ?? [], [data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const round = data?.round ?? null;
  const orders = useMemo(() => data?.orders ?? [], [data]);
  const sent = orders.filter((o) => o.submittedAt);
  const totals = useMemo(() => roundTotals(orders), [orders]);
  const sum = sent.reduce((s, o) => s + orderTotal(o.items, byId), 0);
  const pending = sent.filter((o) => o.approval === 'pending');
  const ordered = new Set(orders.map((o) => o.athleteId));
  const notOrdered = (data?.core ?? []).filter((id) => !ordered.has(id));
  const name = (id: string) => data?.people[id]?.name ?? 'רץ';
  // Once sent, the screen opens on receiving (or the split, when receiving is done).
  const view = tab ?? (round?.state === 'sent' ? (round.receivedAt ? 'split' : 'receive') : 'people');

  const post = async (url: string, body: unknown, method = 'POST') => {
    const r = await fetch(url, { method, headers: await apiHeaders(true), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message ?? 'משהו השתבש');
    return j;
  };
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setNote(null);
    try { await fn(); await mutate(); } catch (e) { setNote((e as Error).message); } finally { setBusy(null); }
  };

  if (isLoading && !data) return <div className="space-y-3 pt-12">{Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} className="h-24" />)}</div>;
  if (data?.error) return <p className="pt-16 text-center text-sm text-ink-500">{data.message ?? 'לא זמין'}</p>;

  return (
    <div className="space-y-3 pb-16">
      <div className="pt-1">
        <Link href="/dashboard/manage/store" className="mb-1 inline-flex items-center gap-0.5 text-13 font-bold text-brand-600"><ChevronRight className="h-4 w-4" />חנות</Link>
        <div className="flex items-end justify-between gap-2">
          <h1 className="text-[26px] font-black leading-tight tracking-tight text-ink-900">ניהול פודיום</h1>
          <button type="button" onClick={() => setRoundForm({ title: '', budget: DEFAULT_BUDGET })} className="flex items-center gap-1 rounded-pill bg-brand-600 px-3 py-2 text-13 font-bold text-white"><Plus className="h-4 w-4" />סבב חדש</button>
        </div>
      </div>

      {(data?.rounds.length ?? 0) > 1 && (
        <select value={round?.id ?? ''} onChange={(e) => setRoundId(e.target.value)} className="w-full rounded-xl bg-card px-3 py-2.5 text-sm font-bold ring-1 ring-black/5">
          {data!.rounds.map((r) => <option key={r.id} value={r.id}>{r.title} · {STATE[r.state].label}</option>)}
        </select>
      )}

      {!round ? (
        <div className="rounded-card bg-card p-6 text-center text-sm text-ink-500">אין עדיין סבב. &quot;סבב חדש&quot; פותח הזמנה, עם תאריכי פתיחה וסגירה ולמי היא פתוחה. כדאי להתחיל ב&quot;רק אני&quot; כדי לבדוק.</div>
      ) : (
        <>
          <div className="rounded-card bg-card p-4 ring-1 ring-black/[0.04]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-extrabold text-ink-900">{round.title}</h2>
                <span className="mb-1 inline-flex rounded-pill bg-page px-2 py-0.5 text-3xs font-extrabold text-ink-500">{AUDIENCE_TAG[round.audience]}{round.audience === 'people' ? ` · ${round.audienceIds.length}` : ''}</span>
                <p className="text-xs text-ink-500">נפתח {whenIL(round.opensAt)}<br />נסגר {whenIL(round.locksAt)} · תקציב <bdi>{shekelRound(round.budget)}</bdi> לרץ</p>
              </div>
              <button type="button" onClick={() => setRoundForm(round)} className="text-13 font-bold text-brand-600">עריכה</button>
            </div>
            <div className={cn('mt-3 rounded-xl px-3 py-2 text-13 font-bold', STATE[round.state].tone)}>{stateLabel(round)}</div>
            {round.state !== 'sent' && round.state !== 'locked' && (
              <Reach round={round} people={data?.people ?? {}} audience={data?.core ?? []} busy={!!busy}
                onWiden={(audience, notify) => act('reach', async () => {
                  await post('/api/admin/podium', { action: 'update', id: round.id, title: round.title, opensAt: round.opensAt, locksAt: round.locksAt, budget: round.budget,
                    audience, audienceIds: round.audienceIds, autoNotify: notify === 'auto' ? true : notify === 'none' ? false : round.autoNotify !== false, notifyTitle: round.notifyTitle ?? '', notifyBody: round.notifyBody ?? '' });
                  if (notify === 'now' && round.state === 'open') {
                    const j = await post('/api/admin/podium', { action: 'notify', id: round.id });
                    setNote(`נפתח ל${audience === 'all' ? 'כולם' : 'גרעין'} · התראה נשלחה ל-${j.sent}`);
                  } else setNote(`נפתח ל${audience === 'all' ? 'כולם' : 'גרעין'}`);
                })} />
            )}
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <Kpi n={`${sent.length}/${data?.core.length ?? 0}`} l="שלחו" />
              <Kpi n={String([...totals.values()].reduce((a, b) => a + b, 0))} l="פריטים" />
              <Kpi n={shekelRound(sum)} l="משוער" />
              <Kpi n={String(pending.length)} l="לאישור" warn={pending.length > 0} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={`/api/admin/podium/csv?round=${round.id}`} className="flex items-center justify-center gap-1.5 rounded-2xl bg-ink-900 py-3 text-sm font-extrabold text-white"><Download className="h-4 w-4" />קובץ לפודיום</a>
              {round.state === 'sent'
                ? <button type="button" disabled={!!busy} onClick={() => void act('unsent', () => post('/api/admin/podium', { action: 'unsent', id: round.id }))} className="rounded-2xl bg-page py-3 text-sm font-extrabold text-ink-700">ביטול &quot;נשלח&quot;</button>
                : <button type="button" disabled={!!busy || round.state !== 'locked'} onClick={() => { if (confirm('לסמן שההזמנה נשלחה לפודיום? אחרי זה אי אפשר לערוך.')) void act('sent', () => post('/api/admin/podium', { action: 'sent', id: round.id })); }} className="rounded-2xl bg-page py-3 text-sm font-extrabold text-ink-700 disabled:opacity-40">📦 נשלח לפודיום</button>}
            </div>
            {/* 🔔 the "it's open" notification: automatic or by hand, how many had it, send now (Ofer 10-26). */}
            <div className="mt-3 rounded-2xl bg-page p-3">
              <div className="flex items-center justify-between gap-2">
                <b className="text-13 text-ink-900">🔔 התראת פתיחה</b>
                <span className="text-2xs font-bold text-ink-500">{round.autoNotify === false ? 'ידנית בלבד' : 'אוטומטית בפתיחה'}</span>
              </div>
              <p className="mt-0.5 text-2xs text-ink-500">נשלחה ל-<bdi>{round.notifiedCount ?? 0}</bdi> מתוך <bdi>{data?.core.length ?? 0}</bdi>{round.state === 'upcoming' ? ` · ${round.autoNotify === false ? 'לא תישלח לבד' : `תצא ${whenIL(round.opensAt)}`}` : ''}</p>
              {round.state === 'open' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" disabled={!!busy || (round.notifiedCount ?? 0) >= (data?.core.length ?? 0)}
                    onClick={() => void act('notify', async () => { const j = await post('/api/admin/podium', { action: 'notify', id: round.id }); setNote(j.sent ? `נשלחה ל-${j.sent}` : 'כולם כבר קיבלו'); })}
                    className="rounded-xl bg-brand-600 py-2.5 text-xs font-extrabold text-white disabled:opacity-40">לשלוח עכשיו{(data?.core.length ?? 0) - (round.notifiedCount ?? 0) > 0 ? ` · ${(data?.core.length ?? 0) - (round.notifiedCount ?? 0)} שלא קיבלו` : ''}</button>
                  <button type="button" disabled={!!busy}
                    onClick={() => { if (confirm('לשלוח את ההתראה שוב לכל מי שההזמנה פתוחה לו?')) void act('notify', async () => { const j = await post('/api/admin/podium', { action: 'notify', id: round.id, again: true }); setNote(`נשלחה שוב ל-${j.sent}`); }); }}
                    className="rounded-xl bg-card py-2.5 text-xs font-extrabold text-ink-700 ring-1 ring-black/5">שוב לכולם</button>
                </div>
              )}
            </div>
            {round.state === 'open' && <p className="mt-2 text-2xs text-ink-400">אחרי הסגירה רצים לא יכולים לשנות. אדמין עדיין יכול לערוך עד שמסמנים &quot;נשלח&quot;.</p>}
          </div>

          {pending.length > 0 && (
            <div className="rounded-card bg-[#FFF1EA] p-3">
              <p className="mb-2 text-13 font-extrabold text-[#9A3412]">מחכים לאישור חריגה</p>
              {pending.map((o) => {
                const t = orderTotal(o.items, byId);
                return (
                  <div key={o.id} className="flex items-center gap-2 border-t border-white/60 py-2 first:border-0">
                    <span className="min-w-0 flex-1 text-13"><b>{name(o.athleteId)}</b> · <bdi>{shekelRound(t)}</bdi> <span className="text-[#C2410C]">· מעל ב-<bdi>{shekelRound(overBy(t, round.budget))}</bdi></span></span>
                    <button type="button" disabled={!!busy} onClick={() => void act('a', () => post(`/api/admin/podium/orders/${o.id}`, { approval: 'approved' }, 'PATCH'))} className="rounded-xl bg-accent-600 px-3 py-1.5 text-xs font-extrabold text-white">אישור</button>
                    <button type="button" disabled={!!busy} onClick={() => void act('r', () => post(`/api/admin/podium/orders/${o.id}`, { approval: 'rejected' }, 'PATCH'))} className="rounded-xl bg-white px-3 py-1.5 text-xs font-extrabold text-ink-700">לא</button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {note && <p className="rounded-xl bg-red-50 px-3 py-2 text-13 font-bold text-red-700">{note}</p>}

      {/* After "נשלח לפודיום": receiving the goods and the split (lib/podium/receive) come first. */}
      {round?.state === 'sent' && (
        <SegmentedControl<'receive' | 'split'> value={view === 'split' ? 'split' : 'receive'} onChange={setTab}
          options={[{ value: 'receive', label: '📦 קבלה' }, { value: 'split', label: '🎁 חלוקה' }]} />
      )}
      {round?.state === 'sent' && view === 'receive' && <ReceivePanel round={round} products={products} onDone={() => setTab('split')} />}
      {round?.state === 'sent' && view === 'split' && <DistributePanel round={round} products={products} orders={orders} names={name} />}

      <SegmentedControl<'people' | 'products' | 'catalog'> value={view === 'people' || view === 'products' || view === 'catalog' ? view : ('' as 'people')} onChange={setTab}
        options={[{ value: 'people', label: 'לפי רץ' }, { value: 'products', label: 'לפי מוצר' }, { value: 'catalog', label: 'קטלוג' }]} />

      {view === 'people' && round && (
        <div className="rounded-card bg-card px-4 py-1 ring-1 ring-black/[0.04]">
          {[...orders].sort((a, b) => Number(!!b.submittedAt) - Number(!!a.submittedAt) || name(a.athleteId).localeCompare(name(b.athleteId), 'he')).map((o) => (
            <button key={o.id} type="button" onClick={() => setEdit(o.id)} className="flex w-full items-center gap-3 border-b border-page py-3 text-start last:border-0">
              <Avatar url={data?.people[o.athleteId]?.avatarUrl} name={name(o.athleteId)} />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm text-ink-900">{name(o.athleteId)}</b>
                <span className="text-2xs text-ink-400"><bdi>{itemCount(o.items)}</bdi> פריטים · <bdi>{shekelRound(orderTotal(o.items, byId))}</bdi></span>
              </span>
              <Chip o={o} />
              <ChevronRight className="h-4 w-4 rotate-180 text-ink-300" />
            </button>
          ))}
          {orders.length === 0 && <p className="py-6 text-center text-13 text-ink-400">עוד אין הזמנות</p>}
          {notOrdered.length > 0 && (
            <details className="border-t border-page py-3">
              <summary className="cursor-pointer text-13 font-bold text-ink-500">עוד לא הזמינו · <bdi>{notOrdered.length}</bdi></summary>
              <p className="mt-2 text-13 leading-relaxed text-ink-500">{notOrdered.map(name).join(' · ')}</p>
            </details>
          )}
        </div>
      )}

      {view === 'products' && round && (
        <div className="rounded-card bg-card px-4 py-1 ring-1 ring-black/[0.04]">
          {[...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => {
            const p = byId.get(id); if (!p) return null;
            const who = sent.filter((o) => o.items[id] && o.approval !== 'rejected').map((o) => `${name(o.athleteId).split(' ')[0]} ${o.items[id]}`);
            return (
              <details key={id} className="border-b border-page last:border-0">
                <summary className="list-none"><ProductLine p={p} qty={n} /></summary>
                <p className="pb-3 text-2xs leading-relaxed text-ink-500">{who.join(' · ')}</p>
              </details>
            );
          })}
          {totals.size === 0 && <p className="py-6 text-center text-13 text-ink-400">אין עדיין הזמנות שנשלחו</p>}
        </div>
      )}

      {view === 'catalog' && <Catalog products={products} busy={busy} act={act} post={post} />}

      <Sheet open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null); }} title={edit ? name(orders.find((o) => o.id === edit)?.athleteId ?? '') : ''}>
        {edit && round && orders.find((o) => o.id === edit) && (
          <OrderEditor key={edit} order={orders.find((o) => o.id === edit)!} round={round} products={products}
            onSave={(items) => act('save', () => post(`/api/admin/podium/orders/${edit}`, { items }, 'PATCH')).then(() => setEdit(null))}
            onDelete={() => { if (confirm('למחוק את ההזמנה?')) void act('del', () => post(`/api/admin/podium/orders/${edit}`, {}, 'DELETE')).then(() => setEdit(null)); }}
            busy={!!busy} />
        )}
      </Sheet>

      <Sheet open={!!roundForm} onOpenChange={(o) => { if (!o) setRoundForm(null); }} title={roundForm?.id ? 'עריכת הסבב' : 'סבב חדש'}>
        {roundForm && <RoundForm init={roundForm} busy={!!busy} people={data?.people ?? {}} onCancel={() => setRoundForm(null)}
          onSave={(r) => act('round', async () => { const j = await post('/api/admin/podium', { action: roundForm.id ? 'update' : 'create', id: roundForm.id, ...r }); if (j.id) setRoundId(j.id); }).then(() => setRoundForm(null))}
          onDelete={roundForm.id ? () => { if (confirm('למחוק את הסבב וכל ההזמנות שבו?')) void act('delr', () => post('/api/admin/podium', { action: 'delete', id: roundForm.id })).then(() => { setRoundForm(null); setRoundId(null); }); } : undefined} />}
      </Sheet>
    </div>
  );
}

/** "פתוח" means little alone: say to whom (Ofer 10-26). */
function stateLabel(r: Round): string {
  if (r.state !== 'open' && r.state !== 'upcoming') return STATE[r.state].label;
  const who = r.audience === 'all' ? 'לכולם' : r.audience === 'core' ? 'לגרעין' : r.audience === 'admins' ? 'חלקית · אדמינים בלבד'
    : r.audience === 'me' ? 'רק לך (בדיקה)' : `חלקית · רק ל-${r.audienceIds.length} אנשים`;
  return r.state === 'open' ? `🟢 פתוח ${who}` : `⏳ ייפתח ${who} · ${whenIL(r.opensAt)}`;
}

/**
 * "למי זה פתוח" — the round's reach, and the way to widen it: to the core or to everyone, with
 * what will happen spelled out before it does (who is added, whether they're notified, when).
 */
function Reach({ round, people, audience, busy, onWiden }: {
  round: Round; people: Resp['people']; audience: string[]; busy: boolean;
  onWiden: (to: 'core' | 'all', notify: 'now' | 'auto' | 'none') => void;
}) {
  const [to, setTo] = useState<'core' | 'all' | null>(null);
  const [notify, setNotify] = useState<'now' | 'auto' | 'none'>('now');
  const all = Object.entries(people);
  const now = new Set(audience);
  const target = (k: 'core' | 'all') => all.filter(([, m]) => (k === 'all' ? true : m.isCore)).map(([id]) => id);
  const added = (k: 'core' | 'all') => target(k).filter((id) => !now.has(id)).length;
  const names = audience.map((id) => people[id]?.name).filter(Boolean) as string[];
  const options = (['core', 'all'] as const).filter((k) => round.audience !== k && !(k === 'core' && round.audience === 'all'));
  const open = round.state === 'open';
  return (
    <div className="mt-3 rounded-2xl bg-page p-3">
      <div className="flex items-center justify-between gap-2">
        <b className="text-13 text-ink-900">למי זה פתוח</b>
        <span className="text-2xs font-bold text-ink-500"><bdi>{audience.length}</bdi> אנשים</span>
      </div>
      <p className="mt-1 text-13 leading-relaxed text-ink-700">{round.audience === 'all' ? 'כל המועדון' : round.audience === 'core' ? 'כל רצי הגרעין' : names.length ? names.join(' · ') : '—'}</p>
      {options.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {options.map((k) => (
            <button key={k} type="button" disabled={busy} onClick={() => { setTo(k); setNotify(open ? 'now' : 'auto'); }}
              className={cn('rounded-xl py-2.5 text-xs font-extrabold', k === 'all' ? 'bg-accent-600 text-white' : 'bg-[#0c0c0d] text-white', options.length === 1 && 'col-span-2')}>
              {k === 'all' ? '🏃 לפתוח לכולם' : '🌰 לפתוח לגרעין'} · +<bdi>{added(k)}</bdi>
            </button>
          ))}
        </div>
      )}
      <Sheet open={!!to} onOpenChange={(v) => { if (!v) setTo(null); }} title={to === 'all' ? 'לפתוח לכל המועדון?' : 'לפתוח לגרעין?'}>
        {to && (
          <div className="space-y-3 pb-2">
            <div className="rounded-2xl bg-page p-3.5 text-13 leading-relaxed text-ink-700">
              <b className="block text-ink-900">מה יקרה</b>
              • <bdi>{added(to)}</bdi> אנשים חדשים יראו את ההזמנה: כרטיס בפיד, בחנות ובעמוד הגרעין. סה״כ <bdi>{target(to).length}</bdi>.<br />
              • מי שכבר מזמין ממשיך כרגיל, ושום הזמנה לא משתנה.<br />
              • התקציב (<bdi dir="ltr">{shekelRound(round.budget)}</bdi>) והסגירה ({whenIL(round.locksAt)}) נשארים.
            </div>
            <div>
              <b className="mb-1.5 block text-13 text-ink-900">התראה לחדשים</b>
              {([
                ...(open ? [['now', 'לשלוח עכשיו', `${added(to)} יקבלו "${round.notifyTitle?.trim() || `🛒 ${round.title} פתוחה`}" מיד`]] : []),
                ['auto', open ? 'אוטומטית' : 'אוטומטית בפתיחה', open ? 'תצא לבד תוך כמה דקות' : `תצא ב-${whenIL(round.opensAt)}`],
                ['none', 'בלי התראה', 'יראו את הכרטיס כשייכנסו לאפליקציה. אפשר לשלוח אחר כך מכאן'],
              ] as Array<['now' | 'auto' | 'none', string, string]>).map(([k, l, h]) => (
                <label key={k} className={cn('mb-1.5 flex items-start gap-2.5 rounded-xl p-3 ring-1', notify === k ? 'bg-brand-600/5 ring-brand-600' : 'bg-card ring-black/5')}>
                  <input type="radio" name="reach-notify" className="mt-0.5 h-4 w-4 accent-brand-600" checked={notify === k} onChange={() => setNotify(k)} />
                  <span><b className="block text-13 text-ink-900">{l}</b><small className="text-2xs text-ink-500">{h}</small></span>
                </label>
              ))}
            </div>
            <button type="button" disabled={busy} onClick={() => { onWiden(to, notify); setTo(null); }}
              className="w-full rounded-2xl bg-brand-600 py-3.5 font-extrabold text-white disabled:opacity-50">{to === 'all' ? 'לפתוח לכולם' : 'לפתוח לגרעין'}</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function Kpi({ n, l, warn }: { n: string; l: string; warn?: boolean }) {
  return <div className={cn('rounded-xl py-2', warn ? 'bg-[#FFF1EA] text-[#9A3412]' : 'bg-page')}><b className="block text-base font-black tabular-nums"><bdi>{n}</bdi></b><small className="text-3xs text-ink-500">{l}</small></div>;
}

function Avatar({ url, name }: { url?: string | null; name: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600/10 text-sm font-extrabold text-brand-600">{name.slice(0, 1)}</span>;
}

function Chip({ o }: { o: Order }) {
  const c = !o.submittedAt ? ['טיוטה', 'bg-page text-ink-500']
    : o.approval === 'pending' ? ['לאישור', 'bg-[#FFF1EA] text-[#9A3412]']
    : o.approval === 'rejected' ? ['לא אושר', 'bg-red-50 text-red-700']
    : o.approval === 'approved' ? ['אושר', 'bg-accent-600/10 text-accent-900']
    : ['נשלח', 'bg-accent-600/10 text-accent-900'];
  return <span className={cn('rounded-pill px-2 py-0.5 text-3xs font-extrabold', c[1])}>{c[0]}</span>;
}

function OrderEditor({ order, round, products, onSave, onDelete, busy }: {
  order: Order; round: Round; products: PodiumProduct[]; onSave: (items: Record<string, number>) => void; onDelete: () => void; busy: boolean;
}) {
  const [items, setItems] = useState<Record<string, number>>(order.items);
  const [q, setQ] = useState('');
  const byId = new Map(products.map((p) => [p.id, p]));
  const set = (id: string, n: number) => setItems((s) => { const x = { ...s }; if (n > 0) x[id] = n; else delete x[id]; return x; });
  const total = orderTotal(items, byId);
  const found = q.trim() ? products.filter((p) => !items[p.id] && textMatches(q, p.name)).slice(0, 6) : [];
  const locked = round.state === 'sent';
  return (
    <div className="space-y-3 pb-2">
      <div className="divide-y divide-page">
        {Object.entries(items).filter(([id]) => byId.has(id)).map(([id, n]) => <ProductLine key={id} p={byId.get(id)!} qty={n} onQty={locked ? undefined : (v) => set(id, v)} />)}
      </div>
      {!locked && (
        <div>
          <div className="flex items-center gap-2 rounded-xl bg-page px-3 py-2"><Search className="h-4 w-4 text-ink-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="להוסיף מוצר" className="flex-1 bg-transparent text-sm outline-none" /></div>
          {found.map((p) => <button key={p.id} type="button" onClick={() => { set(p.id, 1); setQ(''); }} className="block w-full text-start"><ProductLine p={p} qty={0} right={<Plus className="h-5 w-5 text-brand-600" />} /></button>)}
        </div>
      )}
      <div className="flex justify-between rounded-2xl bg-page p-3 text-sm font-black"><span>סה״כ משוער</span><span><bdi>{shekelRound(total)}</bdi>{total > round.budget && <span className="text-[#C2410C]"> · מעל ב-<bdi>{shekelRound(total - round.budget)}</bdi></span>}</span></div>
      {!locked && (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => onSave(items)} className="flex-1 rounded-2xl bg-brand-600 py-3.5 font-extrabold text-white disabled:opacity-50">שמירה · הרץ יקבל התראה</button>
          <button type="button" disabled={busy} onClick={onDelete} className="rounded-2xl bg-page px-4 font-extrabold text-red-600">מחיקה</button>
        </div>
      )}
    </div>
  );
}

const toLocal = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function RoundForm({ init, onSave, onCancel, onDelete, busy, people }: {
  init: Partial<Round>; onSave: (r: { title: string; opensAt: string; locksAt: string; budget: number; audience: Audience; audienceIds: string[]; autoNotify: boolean; notifyTitle: string; notifyBody: string }) => void;
  onCancel: () => void; onDelete?: () => void; busy: boolean; people: Resp['people'];
}) {
  const [audience, setAudience] = useState<Audience>(init.audience ?? 'me');
  const [ids, setIds] = useState<string[]>(init.audienceIds ?? []);
  const [who, setWho] = useState('');
  const [auto, setAuto] = useState(init.autoNotify !== false);
  const [nTitle, setNTitle] = useState(init.notifyTitle ?? '');
  const [nBody, setNBody] = useState(init.notifyBody ?? '');
  const [title, setTitle] = useState(init.title ?? '');
  const [opens, setOpens] = useState(toLocal(init.opensAt) || toLocal(new Date().toISOString()));
  const [locks, setLocks] = useState(toLocal(init.locksAt));
  const [budget, setBudget] = useState(String(init.budget ?? DEFAULT_BUDGET));
  const ok = title.trim() && opens && locks && new Date(locks) > new Date(opens) && (audience !== 'people' || ids.length > 0);
  const list = Object.entries(people).filter(([, m]) => m.name).sort((a, b) => Number(ids.includes(b[0])) - Number(ids.includes(a[0])) || a[1].name.localeCompare(b[1].name, 'he'));
  const shown = list.filter(([, m]) => textMatches(who, m.name)).slice(0, who ? 40 : 12);
  const count = audience === 'core' ? list.filter(([, m]) => m.isCore).length : audience === 'admins' ? list.filter(([, m]) => m.isStaff).length : audience === 'all' ? list.length : audience === 'people' ? ids.length : 1;
  const field = 'w-full rounded-xl bg-page px-3 py-3 text-sm outline-none';
  return (
    <div className="space-y-3 pb-2">
      <label className="block"><span className="mb-1 block text-13 font-bold text-ink-700">שם</span><input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="הזמנת פודיום · נובמבר" /></label>
      <div>
        <span className="mb-1 block text-13 font-bold text-ink-700">למי ההזמנה פתוחה</span>
        <div className="grid grid-cols-2 gap-1.5">
          {AUDIENCES.map((a) => (
            <button key={a.key} type="button" onClick={() => setAudience(a.key)}
              className={cn('rounded-xl px-3 py-2.5 text-start ring-1', audience === a.key ? 'bg-brand-600 text-white ring-brand-600' : 'bg-page text-ink-700 ring-transparent', a.key === 'all' && 'col-span-2')}>
              <b className="block text-13">{a.label}</b><small className={cn('text-3xs', audience === a.key ? 'text-white/80' : 'text-ink-400')}>{a.hint}</small>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-2xs text-ink-400"><bdi>{count}</bdi> {count === 1 ? 'אדם' : 'אנשים'} יראו את ההזמנה ויקבלו התראה{audience === 'me' ? '. אפשר להרחיב אחר כך, ורק החדשים יקבלו התראה.' : ''}</p>
        {audience === 'people' && (
          <div className="mt-2 rounded-xl bg-page p-2">
            <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="חיפוש שם" className="mb-1 w-full rounded-lg bg-card px-3 py-2 text-sm outline-none" />
            <div className="max-h-56 overflow-y-auto">
              {shown.map(([id, m]) => (
                <label key={id} className="flex items-center gap-2.5 px-1 py-1.5 text-13">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={ids.includes(id)} onChange={(e) => setIds((s) => e.target.checked ? [...s, id] : s.filter((x) => x !== id))} />
                  <span className="flex-1">{m.name}</span>{m.isCore && <span className="text-3xs">🌰</span>}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      <label className="block"><span className="mb-1 block text-13 font-bold text-ink-700">נפתח להזמנות</span><input type="datetime-local" dir="ltr" className={`${field} text-right`} value={opens} onChange={(e) => setOpens(e.target.value)} /></label>
      <label className="block"><span className="mb-1 block text-13 font-bold text-ink-700">נסגר לשינויים</span><input type="datetime-local" dir="ltr" className={`${field} text-right`} value={locks} onChange={(e) => setLocks(e.target.value)} /><small className="text-2xs text-ink-400">מהרגע הזה רצים לא יכולים לערוך. תזכורת יוצאת 24 שעות לפני.</small></label>
      <label className="block"><span className="mb-1 block text-13 font-bold text-ink-700">תקציב לרץ (₪)</span><input inputMode="numeric" className={field} value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))} /><small className="text-2xs text-ink-400">מעל זה ההזמנה צריכה אישור, וההפרש על הרץ.</small></label>
      <div className="rounded-xl bg-page p-3">
        <label className="flex items-center justify-between gap-3">
          <span><b className="block text-13 text-ink-900">🔔 התראה אוטומטית בפתיחה</b><small className="text-2xs text-ink-500">{auto ? 'יוצאת לבד ברגע הפתיחה, ולמי שנוסף אחר כך' : 'כבוי: שולחים בעצמך מהניהול, מתי שרוצים'}</small></span>
          <input type="checkbox" className="h-6 w-6 shrink-0 accent-brand-600" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        </label>
        <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} maxLength={80} placeholder={`🛒 ${title || 'הזמנת פודיום'} פתוחה`} className="mt-2 w-full rounded-lg bg-card px-3 py-2 text-13 font-bold outline-none" />
        <textarea value={nBody} onChange={(e) => setNBody(e.target.value)} maxLength={240} rows={2} placeholder={`ג׳לים, וופלים ומשקאות מפודיום, עד ₪${budget || DEFAULT_BUDGET} לכל אחד. אפשר להזמין עד…`} className="mt-1.5 w-full resize-none rounded-lg bg-card px-3 py-2 text-13 outline-none" />
        <small className="text-3xs text-ink-400">ריק = הנוסח הרגיל. תזכורת יוצאת יום לפני הסגירה למי שלא שלח.</small>
      </div>
      <button type="button" disabled={!ok || busy} onClick={() => onSave({ title: title.trim(), opensAt: new Date(opens).toISOString(), locksAt: new Date(locks).toISOString(), budget: Number(budget) || DEFAULT_BUDGET, audience, audienceIds: audience === 'people' ? ids : [], autoNotify: auto, notifyTitle: nTitle, notifyBody: nBody })} className="w-full rounded-2xl bg-brand-600 py-3.5 font-extrabold text-white disabled:opacity-50">שמירה</button>
      <div className="flex justify-between">
        <button type="button" onClick={onCancel} className="text-13 font-bold text-ink-500">ביטול</button>
        {onDelete && <button type="button" onClick={onDelete} className="text-13 font-bold text-red-600">מחיקת הסבב</button>}
      </div>
    </div>
  );
}

function Catalog({ products, busy, act, post }: {
  products: PodiumProduct[]; busy: string | null;
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  post: (url: string, body: unknown, method?: string) => Promise<{ updated?: number; missing?: string[]; changed?: unknown[] }>;
}) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const missing = products.filter((p) => p.price == null && !p.hidden);
  const rest = products.filter((p) => p.price != null);
  const checked = products.map((p) => p.checkedAt).filter(Boolean).sort().at(-1);
  return (
    <div className="space-y-3">
      <div className="rounded-card bg-card p-4 ring-1 ring-black/[0.04]">
        <button type="button" disabled={!!busy} onClick={() => void act('check', async () => {
          const r = await post('/api/admin/podium/products', { action: 'check' });
          setResult(`עודכנו ${r.updated ?? 0} מוצרים${r.changed?.length ? ` · ${r.changed.length} שינויי מחיר` : ''}${r.missing?.length ? ` · ${r.missing.length} לא נמצאו` : ''}`);
        })} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink-900 py-3 text-sm font-extrabold text-white disabled:opacity-60">
          <RefreshCw className={cn('h-4 w-4', busy === 'check' && 'animate-spin')} />{busy === 'check' ? 'בודק מול האתר…' : 'בדיקת מחירים מול האתר'}
        </button>
        <p className="mt-2 text-center text-2xs text-ink-400">{result ?? (checked ? `נבדק לאחרונה ${whenIL(checked)}` : '')}</p>
      </div>

      {missing.length > 0 && (
        <div className="rounded-card bg-card p-4 ring-1 ring-[#F5C26B]">
          <p className="text-[15px] font-extrabold text-ink-900">⚠️ <bdi>{missing.length}</bdi> מוצרים לא נמצאו באתר</p>
          <p className="mt-1 text-13 leading-relaxed text-ink-600">
            חיפשנו באתר של פודיום כל מוצר מהקובץ &quot;מדרגות תזונה&quot; לפי <b>הברקוד</b> שלו. את אלה לא מצאנו.
            כנראה הם לא נמכרים באתר, או רשומים שם עם ברקוד אחר. <b>רצים לא רואים אותם</b> עד שיש להם מחיר.
          </p>
          <ol className="mt-2 space-y-0.5 rounded-xl bg-page px-3 py-2 text-2xs leading-relaxed text-ink-600">
            <li>1. &quot;חיפוש באתר&quot; פותח את פודיום עם שם המוצר</li>
            <li>2. מצאת? מעתיקים את הכתובת של עמוד המוצר</li>
            <li>3. מדביקים כאן ו&quot;הוספה&quot;. התמונה והמחיר נכנסים לבד</li>
          </ol>
          {missing.map((p) => (
            <div key={p.id} className="mt-3 border-t border-page pt-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span dir="ltr" className="block text-left text-13 font-bold text-ink-900">{englishName(p.name)}</span>
                  <span className="block text-2xs text-ink-400">{[hebrewName(p.name), p.dept].filter(Boolean).join(' · ')}</span>
                  <span className="block text-2xs text-ink-400">פריט <bdi>{p.sku}</bdi> · ברקוד <bdi>{p.barcode}</bdi> · לא נמצא בחיפוש לפי ברקוד</span>
                </div>
                <a href={`https://www.podiumsport.co.il/search/?q=${encodeURIComponent(englishName(p.name).slice(0, 60))}`} target="_blank" rel="noreferrer"
                  className="shrink-0 rounded-xl bg-page px-2.5 py-1.5 text-2xs font-extrabold text-brand-600">חיפוש באתר ↗</a>
              </div>
              <div className="mt-2 flex gap-2">
                <input dir="ltr" value={links[p.id] ?? ''} onChange={(e) => setLinks((s) => ({ ...s, [p.id]: e.target.value }))} placeholder="הדבקת קישור לעמוד המוצר" className="min-w-0 flex-1 rounded-xl bg-page px-3 py-2 text-xs outline-none" />
                <button type="button" disabled={!links[p.id]?.trim() || !!busy} onClick={() => void act(`l${p.id}`, () => post('/api/admin/podium/products', { action: 'link', id: p.id, url: links[p.id] }))} className="flex items-center gap-1 rounded-xl bg-brand-600 px-3 text-xs font-extrabold text-white disabled:opacity-40"><Link2 className="h-3.5 w-3.5" />{busy === `l${p.id}` ? '…' : 'הוספה'}</button>
                <button type="button" disabled={!!busy} onClick={() => void act('h', () => post('/api/admin/podium/products', { action: 'hide', id: p.id, hidden: true }))} className="rounded-xl px-2 text-2xs font-bold text-ink-400">לא צריך</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-card bg-card px-4 py-1 ring-1 ring-black/[0.04]">
        {rest.map((p) => (
          <div key={p.id} className={cn('flex items-center gap-3 border-b border-page py-2.5 last:border-0', p.hidden && 'opacity-45')}>
            <div className="h-11 w-11 shrink-0 rounded-xl bg-white p-1 ring-1 ring-black/5"><ProductImage p={p} /></div>
            <div className="min-w-0 flex-1">
              <span dir="ltr" className="block truncate text-left text-13 font-bold">{englishName(p.name)}</span>
              <span className="block truncate text-2xs text-ink-400"><bdi dir="ltr">{shekelRound(p.price!)}</bdi>{hebrewName(p.name) ? ` · ${hebrewName(p.name)}` : ''}</span>
            </div>
            <button type="button" aria-label={p.hidden ? 'להציג' : 'להסתיר'} disabled={!!busy} onClick={() => void act('h', () => post('/api/admin/podium/products', { action: 'hide', id: p.id, hidden: !p.hidden }))} className="p-2 text-ink-400">
              {p.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
