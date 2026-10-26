import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyAthlete } from '@/lib/push';
import { notifyStaff } from '@/lib/notifications/staff';
import { REMIND_HOURS, itemCount, orderTotal, roundState, type PodiumProduct, type PodiumRound } from '@/lib/podium/model';
import { audienceOf, loadOrders, loadProducts, toRound } from '@/lib/podium/server';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;

export const PODIUM_URL = '/dashboard/store/podium';
export const PODIUM_ADMIN_URL = '/dashboard/store/podium/admin';

const when = (iso: string) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const shekel = (n: number) => `₪${Math.round(n)}`;

/**
 * The round's three pushes, from cron/tick: "the order is open" to the round's audience when it opens,
 * "closes tomorrow" to whoever hasn't sent REMIND_HOURS before the lock, and "closed — N orders"
 * to staff at the lock. The notified_* columns are the ledger: each goes out once (per person, for "open"). Returns what fired.
 */
export async function runPodiumPushes(db: Db, now = new Date()): Promise<string[]> {
  const { data, error } = await db.from('podium_rounds').select('*').is('sent_at', null)
    .gte('locks_at', new Date(now.getTime() - 6 * 3600_000).toISOString());
  if (error || !data?.length) return [];
  const fired: string[] = [];
  for (const r of data as any[]) {
    const round: PodiumRound = toRound(r);
    const state = roundState(round, now);
    const stamp = async (col: string) => {
      // Claim first, so two ticks never both send: only the one that flips NULL proceeds.
      const { data: got } = await db.from('podium_rounds').update({ [col]: now.toISOString() }).eq('id', round.id).is(col, null).select('id');
      return !!got?.length;
    };
    // "It's open": to everyone in the audience not told yet — so a wider audience later reaches
    // only the newcomers. The ledger is written before the send, so a slow send never doubles.
    if (state === 'open') {
      const toldList: string[] = r.notified_open_ids ?? [];
      const told = new Set<string>(toldList);
      const due = (await audienceOf(db, round)).filter((a) => !told.has(a.id));
      if (due.length) {
        const { data: got } = await db.from('podium_rounds').update({ notified_open_ids: [...toldList, ...due.map((a) => a.id)] })
          .eq('id', round.id).filter('notified_open_ids', 'eq', `{${toldList.join(',')}}`).select('id');
        if (got?.length) {
          await Promise.all(due.map((a) => notifyAthlete({
            athleteId: a.id, kind: 'podium_round', url: PODIUM_URL, tag: `podium-open-${round.id}`, category: 'news',
            title: `🛒 ${round.title} פתוחה`,
            body: `ג׳לים, וופלים ומשקאות מפודיום, עד ${shekel(round.budget)} לכל אחד. אפשר להזמין עד ${when(round.locksAt)}.`,
          })));
          fired.push(`podiumOpen → ${due.length}`);
        }
      }
    }
    const remindAt = new Date(round.locksAt).getTime() - REMIND_HOURS * 3600_000;
    if (state === 'open' && now.getTime() >= remindAt && !r.notified_remind_at && (await stamp('notified_remind_at'))) {
      const [core, orders] = await Promise.all([audienceOf(db, round), loadOrders(db, round.id)]);
      const sent = new Set(orders.filter((o) => o.submittedAt).map((o) => o.athleteId));
      const drafts = new Set(orders.filter((o) => !o.submittedAt && itemCount(o.items) > 0).map((o) => o.athleteId));
      const due = core.filter((a) => !sent.has(a.id));
      await Promise.all(due.map((a) => notifyAthlete({
        athleteId: a.id, kind: 'podium_reminder', url: PODIUM_URL, tag: `podium-remind-${round.id}`, category: 'news',
        title: drafts.has(a.id) ? '⏰ ההזמנה שלך מפודיום עוד לא נשלחה' : `⏰ ${round.title} נסגרת מחר`,
        body: drafts.has(a.id) ? `יש לך סל שמחכה. צריך ללחוץ "שליחה" עד ${when(round.locksAt)}.` : `מי שרוצה ג׳לים ותזונה מפודיום, אפשר להזמין עד ${when(round.locksAt)}.`,
      })));
      fired.push(`podiumRemind → ${due.length}`);
    }
    if (state === 'locked' && !r.notified_lock_at && (await stamp('notified_lock_at'))) {
      const [orders, products] = await Promise.all([loadOrders(db, round.id), loadProducts(db)]);
      const sent = orders.filter((o) => o.submittedAt);
      const items = sent.reduce((s, o) => s + itemCount(o.items), 0);
      const total = sent.reduce((s, o) => s + orderTotal(o.items, products), 0);
      const pending = sent.filter((o) => o.approval === 'pending').length;
      await notifyStaff({
        kind: 'podium_locked', url: PODIUM_ADMIN_URL, tag: `podium-lock-${round.id}`, category: 'management',
        copy: () => ({
          title: `🔒 ${round.title} נסגרה`,
          body: `${sent.length} הזמנות · ${items} פריטים · ≈${shekel(total)}.${pending ? ` ${pending} מחכות לאישור חריגה.` : ''} הקובץ לפודיום מוכן.`,
        }),
      });
      fired.push(`podiumLocked → ${sent.length}`);
    }
  }
  return fired;
}

/** A runner sent an order over the budget: the staff are asked. */
export async function askApproval(opts: { round: PodiumRound; athleteId: string; name: string; total: number; orderId: string }) {
  await notifyStaff({
    kind: 'podium_approval', url: `${PODIUM_ADMIN_URL}?order=${opts.orderId}`, tag: `podium-approval-${opts.orderId}`, category: 'management',
    actorAthleteId: opts.athleteId,
    copy: () => ({
      title: `💳 ${opts.name} מעל התקציב בפודיום`,
      body: `${shekel(opts.total)} מתוך ${shekel(opts.round.budget)}. ההפרש ${shekel(opts.total - opts.round.budget)} עליו/ה. צריך לאשר.`,
    }),
  });
}

/** The answer to the runner, and an admin's edit of their order. */
export async function tellRunner(opts: { athleteId: string; kind: 'approved' | 'rejected' | 'edited'; round: PodiumRound; total: number; actorId: string | null }) {
  const over = Math.max(0, opts.total - opts.round.budget);
  const copy = {
    approved: { title: '✅ ההזמנה שלך מפודיום אושרה', body: over > 0 ? `סה״כ ${shekel(opts.total)}. נשאר להעביר את ההפרש: ${shekel(over)}.` : `סה״כ ${shekel(opts.total)}.` },
    rejected: { title: 'ההזמנה שלך מפודיום מעל התקציב', body: `צריך להוריד ל-${shekel(opts.round.budget)} או לדבר עם המועדון.` },
    edited: { title: '✏️ ההזמנה שלך מפודיום עודכנה', body: `המועדון עדכן את ההזמנה. סה״כ עכשיו ${shekel(opts.total)}.` },
  }[opts.kind];
  await notifyAthlete({ athleteId: opts.athleteId, kind: 'podium_update', url: PODIUM_URL, tag: `podium-${opts.kind}-${opts.round.id}`, category: 'news', actorAthleteId: opts.actorId, ...copy });
}

export type { PodiumProduct };
