'use client';

import Link from 'next/link';
import { ChevronLeft, Download, Plus, ShoppingBag, Store } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { InsetSection, InsetRow } from '@/components/ui';
import { AUDIENCE_TAG, itemCount, orderTotal, type Approval, type PodiumProduct, type PodiumRound, type RoundState } from '@/lib/podium/model';
import { shekelRound, whenIL } from '@/components/podium/parts';

type Round = PodiumRound & { state: RoundState };
interface Resp { round: Round | null; products: PodiumProduct[]; orders: Array<{ items: Record<string, number>; submittedAt: string | null; approval: Approval }>; core: string[]; error?: string }

const STATE: Record<RoundState, { label: string; tone: string; next: string }> = {
  upcoming: { label: 'עוד לא נפתח', tone: 'bg-page text-ink-600', next: 'ייפתח לבד בזמן שנקבע' },
  open: { label: 'פתוח להזמנות', tone: 'bg-accent-600/10 text-accent-900', next: 'רצים מזמינים · ייסגר לבד' },
  locked: { label: 'נסגר · מוכן לשליחה', tone: 'bg-[#FFF1EA] text-[#9A3412]', next: 'להוריד קובץ ולסמן "נשלח לפודיום"' },
  sent: { label: 'נשלח לפודיום', tone: 'bg-brand-600/10 text-brand-700', next: 'כשהסחורה מגיעה: קבלה וחלוקה' },
};

/**
 * "חנות" on the admin's ניהול page: the Podium round's status at a glance — where it stands,
 * who ordered, what waits for the admin — and the doors into everything (round, receiving,
 * file, the club store). Reads /api/admin/podium, the admin screen's own key.
 */
export function StoreAdminSection() {
  const { data } = useApi<Resp>('/api/admin/podium');
  const r = data?.round ?? null;
  const sent = (data?.orders ?? []).filter((o) => o.submittedAt);
  const pending = sent.filter((o) => o.approval === 'pending').length;
  const items = sent.reduce((s, o) => s + itemCount(o.items), 0);
  const total = sent.reduce((s, o) => s + orderTotal(o.items, data?.products ?? []), 0);
  const missingPrice = (data?.products ?? []).filter((p) => p.price == null && !p.hidden).length;
  const admin = '/dashboard/store/podium/admin';
  return (
    <InsetSection header="חנות">
      <div className="p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#FF5A1F] text-white"><ShoppingBag className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <b className="block text-[15px] text-ink-900">הזמנת פודיום</b>
            <span className="block truncate text-2xs text-ink-400">{r ? `${r.title} · ${AUDIENCE_TAG[r.audience]}` : data?.error ? 'לא זמין' : 'אין סבב פתוח'}</span>
          </div>
        </div>

        {!data ? <div className="mt-3 h-24 animate-pulse rounded-2xl bg-page" /> : !r ? (
          <Link href={admin} className="mt-3 flex items-center justify-center gap-1.5 rounded-2xl bg-brand-600 py-3 text-sm font-extrabold text-white"><Plus className="h-4 w-4" />פתיחת סבב חדש</Link>
        ) : (
          <>
            <div className={cn('mt-3 rounded-2xl px-3.5 py-2.5', STATE[r.state].tone)}>
              <b className="block text-13">{STATE[r.state].label}</b>
              <span className="text-2xs opacity-80">{r.state === 'upcoming' ? `נפתח ${whenIL(r.opensAt)}` : r.state === 'open' ? `נסגר ${whenIL(r.locksAt)}` : STATE[r.state].next}</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
              {[
                [`${sent.length}/${data.core.length}`, 'שלחו'],
                [String(items), 'פריטים'],
                [shekelRound(total), 'משוער'],
                [String(pending), 'לאישור'],
              ].map(([n, l], i) => (
                <div key={l} className={cn('rounded-xl py-2', i === 3 && pending ? 'bg-[#FFF1EA] text-[#9A3412]' : 'bg-page')}>
                  <b className="block text-[15px] font-black tabular-nums"><bdi dir="ltr">{n}</bdi></b><small className="text-3xs text-ink-500">{l}</small>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href={admin} className="flex items-center justify-center gap-1 rounded-2xl bg-ink-900 py-3 text-13 font-extrabold text-white">
                {r.state === 'sent' ? '📦 קבלה וחלוקה' : pending ? `לאשר ${pending}` : 'ניהול הסבב'}<ChevronLeft className="h-4 w-4" />
              </Link>
              {r.state === 'locked' || r.state === 'sent'
                ? <a href={`/api/admin/podium/csv?round=${r.id}`} className="flex items-center justify-center gap-1 rounded-2xl bg-page py-3 text-13 font-extrabold text-ink-700"><Download className="h-4 w-4" />קובץ לפודיום</a>
                : <Link href="/dashboard/store/podium" className="flex items-center justify-center rounded-2xl bg-page py-3 text-13 font-extrabold text-ink-700">איך שרצים רואים</Link>}
            </div>
          </>
        )}
        {missingPrice > 0 && <Link href={admin} className="mt-2 block text-center text-2xs font-bold text-brand-600">{missingPrice} מוצרים בלי מחיר מהאתר · להוסיף קישור ›</Link>}
      </div>
      <InsetRow icon={Store} iconBg="bg-band-2" label="חנות המועדון" sublabel="מוצרי המועדון והזמנות" href="/dashboard/settings?tab=store" />
    </InsetSection>
  );
}
