'use client';

import Link from 'next/link';
import { useApi } from '@/lib/api';
import { AUDIENCE_TAG, itemCount, orderTotal, type Approval, type PodiumProduct, type PodiumRound, type RoundState } from '@/lib/podium/model';
import { shekelRound, whenIL } from '@/components/podium/parts';

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
  const show = round.state === 'open' || (where === 'store' && round.state !== 'sent') || (round.state === 'locked' && !!mine?.submittedAt);
  if (!show) return null;
  const pics = (data?.products ?? []).filter((p) => p.imageUrl).filter((_, i, a) => i === 0 || i === Math.floor(a.length / 2) || i === a.length - 1).slice(0, 3);
  const total = mine ? orderTotal(mine.items, data?.products ?? []) : 0;
  const line = round.state === 'upcoming' ? `נפתחת ${whenIL(round.opensAt)}`
    : round.state === 'locked' ? 'נסגרה · ההזמנה שלך בדרך לפודיום'
    : mine?.submittedAt ? (mine.approval === 'pending' ? 'נשלח · מחכה לאישור חריגה' : `נשלח ✓ אפשר לשנות עד ${whenIL(round.locksAt)}`)
    : n > 0 ? `יש לך סל שעוד לא נשלח · עד ${whenIL(round.locksAt)}`
    : `ג׳לים, וופלים ומשקאות · עד ${whenIL(round.locksAt)}`;
  return (
    <Link href="/dashboard/store/podium" className="relative block overflow-hidden rounded-card bg-[#0E0F2E] p-4 text-white">
      <div className="pointer-events-none absolute top-5 left-7 flex">
        {pics.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={p.id} src={p.imageUrl!} alt="" className="-ms-4 h-[54px] w-[54px] rounded-2xl bg-white object-contain p-1 shadow-[0_8px_18px_rgb(0_0_0/0.45)]"
            style={{ transform: `rotate(${[-8, 5, -3][i]}deg)` }} />
        ))}
      </div>
      <span className="inline-flex rounded-pill bg-white/15 px-2.5 py-0.5 text-3xs font-extrabold">{AUDIENCE_TAG[round.audience] ?? AUDIENCE_TAG.core}</span>
      <h3 className="mt-2 max-w-[52%] text-lg font-black leading-tight">{round.title}</h3>
      <p className="mt-0.5 max-w-[52%] text-xs leading-snug text-white/75">{line}</p>
      <span className="mt-3 inline-flex rounded-xl bg-white px-3.5 py-2 text-13 font-extrabold text-ink-900">
        <span>{n > 0 ? <>ההזמנה שלי · <bdi>{n}</bdi> פריטים · <bdi dir="ltr">{shekelRound(total)}</bdi> ›</> : 'להזמנה ›'}</span>
      </span>
    </Link>
  );
}
