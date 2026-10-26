'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { englishName } from '@/lib/podium/model';
import { useApi } from '@/lib/api';
import { AUDIENCE_TAG, itemCount, orderTotal, type Approval, type PodiumProduct, type PodiumRound, type RoundState } from '@/lib/podium/model';
import { shekelRound, timeLeft, whenIL } from '@/components/podium/parts';

const HIDE_KEY = 'mc:podium-card-hidden';

interface Resp { round: (PodiumRound & { state: RoundState }) | null; products?: PodiumProduct[]; order?: { items: Record<string, number>; submittedAt: string | null; approval: Approval } | null }

/**
 * "🌰 הזמנת פודיום" — the door into the core squad's order, on the feed and atop the store.
 * Whoever the round is for (lib/podium/model audienceAllows), and only while it is open — or locked with this runner's
 * order in it, until the club marks it sent. Three of the catalog's own photos.
 */
export function PodiumCard({ where = 'feed' }: { where?: 'feed' | 'store' }) {
  // The server answers only rounds open to this person (their audience), so no gate here.
  const { data } = useApi<Resp>('/api/podium');
  const round = data?.round;
  // ✕ on the feed once it's done (Ofer 10-26): hidden for THIS stage only, so "closed" or
  // "it's with you" still comes back once. Read after mount — no localStorage in SSR.
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => { try { setHidden(JSON.parse(localStorage.getItem(HIDE_KEY) ?? '[]')); } catch { /* private mode */ } }, []);
  if (!round) return null;
  const mine = data?.order;
  const n = mine ? itemCount(mine.items) : 0;
  // Open: everyone it's for. Closed / sent: only someone with an order in it, until it's handed over.
  const show = round.state === 'open' || (where === 'store' && round.state === 'upcoming') || ((round.state === 'locked' || round.state === 'sent') && n > 0);
  if (!show) return null;
  const pics = (data?.products ?? []).filter((p) => p.imageUrl).filter((_, i, a) => i === 0 || i === Math.floor(a.length / 2) || i === a.length - 1).slice(0, 3);
  const total = mine ? orderTotal(mine.items, data?.products ?? []) : 0;
  const left = timeLeft(round.locksAt);
  // The three moments Ofer named (10-26): in progress → done, with the time left to edit → closed.
  const stage = round.state === 'upcoming' ? { tag: '⏳ בקרוב', line: `נפתחת ${whenIL(round.opensAt)}`, tone: 'bg-white/15' }
    : round.state === 'sent' ? { tag: '📦 נשלחה לפודיום', line: 'ההזמנה בדרך. נעדכן כשהיא אצלך.', tone: 'bg-white/15' }
    : round.state === 'locked' ? { tag: '🔒 נסגרה', line: mine?.submittedAt ? 'ההזמנה נסגרה ונשלחת לפודיום. אי אפשר לשנות.' : 'ההזמנה נסגרה. הסל לא נשלח.', tone: 'bg-white/15' }
    : mine?.submittedAt ? { tag: '✓ בוצע', line: `${mine.approval === 'pending' ? 'מחכה לאישור חריגה · ' : ''}אפשר לערוך עד ${whenIL(round.locksAt)}${left ? ` (${left})` : ''}`, tone: 'bg-[#16A34A]' }
    : n > 0 ? { tag: '🛒 ההזמנה בתהליך', line: `עוד לא נשלחה · נסגרת ${whenIL(round.locksAt)}${left ? ` (${left})` : ''}`, tone: 'bg-[#FF5A1F]' }
    : { tag: AUDIENCE_TAG[round.audience] ?? AUDIENCE_TAG.core, line: `אפשר להזמין עד ${whenIL(round.locksAt)}${left ? ` (${left})` : ''}`, tone: 'bg-white/15' };
  const done = !!mine?.submittedAt || round.state === 'locked' || round.state === 'sent';
  const hideKey = `${round.id}:${round.state === 'open' ? 'done' : round.state}`;
  if (where === 'feed' && done && hidden.includes(hideKey)) return null;
  const hide = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const next = [...hidden, hideKey].slice(-20);
    setHidden(next);
    try { localStorage.setItem(HIDE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const byId = new Map((data?.products ?? []).map((p) => [p.id, p]));
  const lines = Object.entries(mine?.items ?? {}).filter(([id, q]) => q > 0 && byId.has(id)).sort((a, b) => b[1] - a[1]);

  // With an order: a summary to check at a glance — every product's photo and count, the total.
  if (n > 0) {
    return (
      <Link href="/dashboard/store/podium" className="relative block overflow-hidden rounded-card bg-[#0E0F2E] p-4 text-white">
        {where === 'feed' && done && (
          <button type="button" aria-label="להסתיר" onClick={hide} className="absolute top-3 left-3 z-[1] grid h-8 w-8 place-items-center rounded-full bg-white/15 text-white/80 active:bg-white/25"><X className="h-4 w-4" /></button>
        )}
        <span className={`inline-flex rounded-pill px-2.5 py-0.5 text-3xs font-extrabold ${stage.tone}`}>{stage.tag}</span>
        <h3 className="mt-2 pe-10 text-lg font-black leading-tight">{round.title}</h3>
        <p className="mt-0.5 text-xs leading-snug text-white/75">{stage.line}</p>
        <div className="mt-3 rounded-2xl bg-white/[0.07] p-2.5">
          <div className="grid grid-cols-4 gap-2">
            {lines.slice(0, lines.length > 8 ? 7 : 8).map(([id, q]) => {
              const p = byId.get(id)!;
              return (
                <div key={id} className="min-w-0 text-center">
                  <div className="relative mx-auto aspect-square w-full rounded-xl bg-white p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="h-full w-full object-contain" />}
                    <bdi className="absolute -bottom-1.5 -left-1.5 min-w-[24px] rounded-pill bg-brand-600 px-1.5 text-[11px] font-black leading-5 text-white">×{q}</bdi>
                  </div>
                  <span dir="ltr" className="mt-1.5 block truncate text-[10px] leading-tight text-white/70">{englishName(p.name).replace(/^(GU|Powerbar|PowerBar|POWERBAR|Beet It)\s+/, '')}</span>
                </div>
              );
            })}
            {lines.length > 8 && (
              <div className="grid aspect-square place-items-center rounded-xl bg-white/10 text-sm font-black">+<bdi>{lines.length - 7}</bdi></div>
            )}
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-white/10 pt-2 text-13">
            <span className="text-white/75"><bdi>{n}</bdi> פריטים · <bdi>{lines.length}</bdi> מוצרים</span>
            <b className="text-base font-black"><bdi dir="ltr">{shekelRound(total)}</bdi></b>
          </div>
        </div>
        <span className="mt-3 flex items-center justify-center rounded-xl bg-white py-2.5 text-13 font-extrabold text-ink-900">
          {round.state === 'open' ? (mine?.submittedAt ? 'לצפייה ועריכה ›' : 'להמשיך להזמנה ›') : 'לפרטים ›'}
        </span>
      </Link>
    );
  }

  return (
    <Link href="/dashboard/store/podium" className="relative block overflow-hidden rounded-card bg-[#0E0F2E] p-4 text-white">
      <div className="pointer-events-none absolute top-5 left-7 flex">
        {pics.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={p.id} src={p.imageUrl!} alt="" className="-ms-4 h-[54px] w-[54px] rounded-2xl bg-white object-contain p-1 shadow-[0_8px_18px_rgb(0_0_0/0.45)]"
            style={{ transform: `rotate(${[-8, 5, -3][i]}deg)` }} />
        ))}
      </div>
      <span className={`inline-flex rounded-pill px-2.5 py-0.5 text-3xs font-extrabold ${stage.tone}`}>{stage.tag}</span>
      <h3 className="mt-2 max-w-[52%] text-lg font-black leading-tight">{round.title}</h3>
      <p className="mt-0.5 max-w-[52%] text-xs leading-snug text-white/75">{stage.line}</p>
      <span className="mt-3 inline-flex rounded-xl bg-white px-3.5 py-2 text-13 font-extrabold text-ink-900">
        <span>{n > 0 ? <>ההזמנה שלי · <bdi>{n}</bdi> פריטים · <bdi dir="ltr">{shekelRound(total)}</bdi> ›</> : 'להזמנה ›'}</span>
      </span>
    </Link>
  );
}
