'use client';

import Link from 'next/link';
import { useApi } from '@/lib/api';
import { AUDIENCE_TAG, itemCount, orderTotal, type Approval, type PodiumProduct, type PodiumRound, type RoundState } from '@/lib/podium/model';
import { shekelRound, timeLeft, whenIL } from '@/components/podium/parts';

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
