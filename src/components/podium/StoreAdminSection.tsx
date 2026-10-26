'use client';

import Link from 'next/link';
import { ChevronLeft, Download, Plus, ShoppingBag, Store } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { InsetSection } from '@/components/ui';
import { STORE_OPEN } from '@/lib/nav-items';
import { itemCount, orderTotal, type Approval, type PodiumProduct, type PodiumRound, type RoundState } from '@/lib/podium/model';
import { shekelRound, whenIL } from '@/components/podium/parts';

type Round = PodiumRound & { state: RoundState };
interface Resp {
  round: Round | null; products: PodiumProduct[]; core: string[];
  orders: Array<{ items: Record<string, number>; submittedAt: string | null; approval: Approval }>;
  people: Record<string, { name: string }>; error?: string;
}

const STATE: Record<RoundState, { label: string; dot: string }> = {
  upcoming: { label: 'מתוזמן', dot: 'bg-ink-300' },
  open: { label: 'פתוח', dot: 'bg-accent-600' },
  locked: { label: 'נסגר · לשלוח לפודיום', dot: 'bg-[#FF5A1F]' },
  sent: { label: 'נשלח · לקבלה וחלוקה', dot: 'bg-brand-600' },
};

/** Who the round is open to, in words — names when it's a few people. */
function audienceLine(r: Round, people: Resp['people']): string {
  if (r.audience === 'me') return 'פתוח רק לך (בדיקה)';
  if (r.audience === 'admins') return 'פתוח רק לאדמינים';
  if (r.audience === 'core') return 'פתוח לגרעין';
  if (r.audience === 'all') return 'פתוח לכל המועדון';
  const names = r.audienceIds.map((id) => people[id]?.name?.split(' ')[0]).filter(Boolean) as string[];
  return `פתוח רק ל-${names.length}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` ועוד ${names.length - 4}` : ''}`;
}

/**
 * חנות, on the admin's ניהול (Ofer 10-26): every store in one section, each with whether it's open
 * and to whom. Today Podium is the only open one; the club store is closed to members (STORE_OPEN).
 * Under Podium: what waits for the admin — approvals, unmatched products, the stage's next step.
 */
export function StoreAdminSection() {
  const { data } = useApi<Resp>('/api/admin/podium');
  const r = data?.round ?? null;
  const sent = (data?.orders ?? []).filter((o) => o.submittedAt);
  const pending = sent.filter((o) => o.approval === 'pending').length;
  const items = sent.reduce((s, o) => s + itemCount(o.items), 0);
  const total = sent.reduce((s, o) => s + orderTotal(o.items, data?.products ?? []), 0);
  const unmatched = (data?.products ?? []).filter((p) => p.price == null && !p.hidden).length;
  const admin = '/dashboard/store/podium/admin';
  const live = r && r.state !== 'sent';
  const todo = [
    pending > 0 && { text: `${pending} מעל התקציב מחכים לאישור`, href: admin, tone: 'text-[#9A3412]' },
    r?.state === 'locked' && { text: 'ההזמנה נסגרה: להוריד קובץ ולסמן "נשלח לפודיום"', href: admin, tone: 'text-[#9A3412]' },
    r?.state === 'sent' && { text: r.receivedAt ? 'לחלק ולסמן "נמסר" לכל אחד' : 'כשהסחורה מגיעה: לסמן מה הגיע', href: admin, tone: 'text-brand-700' },
    unmatched > 0 && { text: `${unmatched} מוצרים לא נמצאו באתר: רצים לא רואים אותם`, href: `${admin}?tab=catalog`, tone: 'text-ink-600' },
  ].filter(Boolean) as Array<{ text: string; href: string; tone: string }>;

  return (
    <InsetSection header="חנות">
      {/* ── פודיום ── */}
      <div className="p-4">
        <Link href={admin} className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FF5A1F] text-white"><ShoppingBag className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <b className="text-[15px] text-ink-900">פודיום</b>
              {r ? <span className="flex items-center gap-1 rounded-pill bg-page px-2 py-0.5 text-3xs font-extrabold text-ink-700"><i className={cn('h-1.5 w-1.5 rounded-full', STATE[r.state].dot)} />{STATE[r.state].label}</span>
                : <span className="rounded-pill bg-page px-2 py-0.5 text-3xs font-extrabold text-ink-400">סגור</span>}
            </span>
            <span className="block truncate text-2xs text-ink-500">{!data ? '…' : r ? (live ? audienceLine(r, data.people) : r.title) : 'אין הזמנה פתוחה'}</span>
          </span>
          <ChevronLeft className="h-4 w-4 text-ink-300" />
        </Link>

        {r && (
          <>
            <p className="mt-2 text-2xs text-ink-400">{r.title} · {r.state === 'upcoming' ? `נפתח ${whenIL(r.opensAt)}` : r.state === 'open' ? `נסגר ${whenIL(r.locksAt)}` : `נסגר ${whenIL(r.locksAt)}`}</p>
            <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
              {[[`${sent.length}/${data!.core.length}`, 'שלחו'], [String(items), 'פריטים'], [shekelRound(total), 'משוער'], [String(pending), 'לאישור']].map(([n, l], i) => (
                <div key={l} className={cn('rounded-xl py-2', i === 3 && pending ? 'bg-[#FFF1EA] text-[#9A3412]' : 'bg-page')}>
                  <b className="block text-[15px] font-black tabular-nums"><bdi dir="ltr">{n}</bdi></b><small className="text-3xs text-ink-500">{l}</small>
                </div>
              ))}
            </div>
          </>
        )}

        {todo.length > 0 && (
          <div className="mt-3 rounded-2xl bg-page p-1">
            <p className="px-2.5 pt-1.5 text-3xs font-extrabold text-ink-400">מה מחכה לך</p>
            {todo.map((t) => (
              <Link key={t.text} href={t.href} className={cn('flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-13 font-bold', t.tone)}>
                <span>{t.text}</span><ChevronLeft className="h-4 w-4 shrink-0 opacity-50" />
              </Link>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          {r && live
            ? <Link href={admin} className="rounded-2xl bg-ink-900 py-3 text-center text-13 font-extrabold text-white">ניהול הסבב</Link>
            : <Link href={admin} className="flex items-center justify-center gap-1 rounded-2xl bg-brand-600 py-3 text-13 font-extrabold text-white">{r ? '📦 קבלה וחלוקה' : <><Plus className="h-4 w-4" />סבב חדש</>}</Link>}
          {r && (r.state === 'locked' || r.state === 'sent')
            ? <a href={`/api/admin/podium/csv?round=${r.id}`} className="flex items-center justify-center gap-1 rounded-2xl bg-page py-3 text-13 font-extrabold text-ink-700"><Download className="h-4 w-4" />קובץ לפודיום</a>
            : <Link href={`${admin}?tab=catalog`} className="rounded-2xl bg-page py-3 text-center text-13 font-extrabold text-ink-700">קטלוג ומחירים</Link>}
        </div>
      </div>

      {/* ── חנות המועדון ── */}
      <Link href="/dashboard/settings?tab=store" className="flex items-center gap-3 border-t border-page px-4 py-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-band-2 text-white"><Store className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><b className="text-[15px] text-ink-900">חנות המועדון</b>
            <span className="rounded-pill bg-page px-2 py-0.5 text-3xs font-extrabold text-ink-400">{STORE_OPEN ? 'פתוחה' : 'סגורה לחברים'}</span></span>
          <span className="block text-2xs text-ink-500">חולצות וציוד · מוצרים והזמנות</span>
        </span>
        <ChevronLeft className="h-4 w-4 text-ink-300" />
      </Link>
    </InsetSection>
  );
}
