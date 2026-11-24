/**
 * כספים — the manager's money screen (design/b22/finance/mockup-v3.html, direction C, owner "מעולה").
 *
 * One number (collected this month), a 6-month trend with the expected point, three streams
 * (academy / store / podium), and "לטפל": what needs a hand, oldest first. Pure: the route reads
 * the rows, this shapes them, so the screen can never show a count that disagrees with its list.
 *
 * Nothing here moves money. The money stays in GO (academy) and in cash / transfer (store, podium).
 * The only write next to it is the reminder (route /api/admin/finance/remind), an in-app note.
 */
import { LINK_STALE_DAYS, type PaymentBoard, type PaymentRowView } from '@/lib/academy/payments';

export const TREND_MONTHS = 6;

/** Payment states a reminder may go out for — never a month already paid, never a cancelled order. */
export const REMINDABLE: ReadonlySet<string> = new Set(['unpaid', 'link_pending', 'link_overdue', 'awaiting_link', 'failed']);

/** 'YYYY-MM' of a Date in Israel. */
export function monthKey(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(d);
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

/** The n months ending at `month` ('YYYY-MM'), oldest first. */
export function monthsEnding(month: string, n = TREND_MONTHS): string[] {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

const r0 = (n: number) => Math.round(n);
const days = (from: string | null | undefined, now: Date): number | null => {
  if (!from) return null;
  const t = new Date(from).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
};

export interface StoreOrderIn { id: string; athleteId: string; name: string; status: string; total: number; createdAt: string }
export interface PodiumOrderIn {
  id: string; athleteId: string | null; name: string; roundTitle: string; lockMonth: string;
  submitted: boolean; approval: 'none' | 'pending' | 'approved' | 'rejected'; total: number; budget: number; updatedAt: string;
}
export interface AcademyMonthIn { month: string; collectedIls: number }

export interface FinanceInput {
  month: string;                         // 'YYYY-MM'
  now: Date;
  /** The academy board for `month` (lib/academy/payments buildPaymentBoard); null when migration 115 isn't there. */
  board: PaymentBoard | null;
  /** academy_payments summed per month for the trend (the current month too). */
  academyByMonth: AcademyMonthIn[];
  storeOrders: StoreOrderIn[];           // every non-cancelled order of the trend window + every open one
  podiumOrders: PodiumOrderIn[];         // submitted orders of rounds locking inside the trend window
}

export type TodoKind = 'go_links' | 'go_failed' | 'store_unpaid' | 'store_undelivered' | 'podium_pending';

export interface TodoItem {
  id: string;                 // athlete id (academy) / order id
  athleteId: string | null;
  name: string;
  amountIls: number | null;
  days: number | null;
  detail: string;             // "אקדמיה · נובמבר" / "#a1b2" / round title
  sentAt: string | null;      // academy: when the link went out
  sentBy: string | null;      // academy: the mentor
  /** Academy only: the reminder can be sent (manager → the trainee, in-app). */
  remindable: boolean;
}

export interface TodoGroup {
  kind: TodoKind;
  title: string;
  subtitle: string;
  count: number;
  amountIls: number;
  oldestDays: number;
  /** The oldest is past the stale line (academy: LINK_STALE_DAYS; the rest: the same 3 days). */
  stale: boolean;
  items: TodoItem[];
}

export interface FinanceSummary {
  month: string;
  collectedIls: number;
  expectedIls: number;
  missingIls: number;
  /** vs the previous month's collected; null when that month had nothing. */
  changePct: number | null;
  trend: Array<{ month: string; collectedIls: number }>;
  streams: {
    academy: { collectedIls: number; paid: number; trainees: number; tableMissing: boolean };
    store: { collectedIls: number; paidOrders: number };
    podium: { collectedIls: number; exceptions: number; clubFundsIls: number };
  };
  todo: TodoGroup[];
  todoCount: number;
  todoAmountIls: number;
  allClosed: boolean;
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
const shortName = (n: string) => {
  const p = n.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}׳` : p[0] || n;
};

function storeMonthIls(orders: StoreOrderIn[], month: string, tz: (d: Date) => string): { ils: number; n: number } {
  let ils = 0, n = 0;
  for (const o of orders) {
    if ((o.status === 'paid' || o.status === 'fulfilled') && tz(new Date(o.createdAt)) === month) { ils += o.total; n += 1; }
  }
  return { ils, n };
}

/** The runner's own share of an approved over-budget podium order — the club's income from podium. */
function podiumMonth(orders: PodiumOrderIn[], month: string) {
  let ils = 0, exceptions = 0, club = 0;
  for (const o of orders) {
    if (!o.submitted || o.lockMonth !== month) continue;
    const over = Math.max(0, o.total - o.budget);
    club += Math.min(o.total, o.budget);
    if (over > 0) { exceptions += 1; if (o.approval === 'approved') ils += over; }
  }
  return { ils, exceptions, club };
}

function group(kind: TodoKind, title: string, items: TodoItem[], subtitle: (items: TodoItem[]) => string, staleAfter = LINK_STALE_DAYS): TodoGroup | null {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  const oldest = sorted[0].days ?? 0;
  return {
    kind, title, subtitle: subtitle(sorted), count: sorted.length,
    amountIls: r0(sorted.reduce((s, i) => s + (i.amountIls ?? 0), 0)),
    oldestDays: oldest, stale: oldest > staleAfter, items: sorted,
  };
}

export function buildFinance(input: FinanceInput): FinanceSummary {
  const { month, now, board } = input;
  const months = monthsEnding(month);
  const academyOf = new Map(input.academyByMonth.map((a) => [a.month, a.collectedIls]));

  const trend = months.map((m) => {
    const s = storeMonthIls(input.storeOrders, m, monthKey);
    const p = podiumMonth(input.podiumOrders, m);
    return { month: m, collectedIls: r0((academyOf.get(m) ?? 0) + s.ils + p.ils) };
  });

  const s = storeMonthIls(input.storeOrders, month, monthKey);
  const p = podiumMonth(input.podiumOrders, month);
  const academyCollected = board ? board.kpi.collectedIls : (academyOf.get(month) ?? 0);
  const collected = r0(academyCollected + s.ils + p.ils);

  // Expected: the academy's all-paid month (standing orders) + what the store and podium already
  // have on the books (paid or still owed) — never a forecast of orders nobody placed.
  const storeOwed = input.storeOrders.filter((o) => o.status === 'pending_payment' && monthKey(new Date(o.createdAt)) === month)
    .reduce((t, o) => t + o.total, 0);
  const podiumOwed = input.podiumOrders.filter((o) => o.submitted && o.lockMonth === month && o.approval === 'pending')
    .reduce((t, o) => t + Math.max(0, o.total - o.budget), 0);
  const academyExpected = board ? Math.max(board.kpi.expectedIls, academyCollected) : academyCollected;
  const expected = r0(academyExpected + s.ils + storeOwed + p.ils + podiumOwed);

  const prev = trend[trend.length - 2]?.collectedIls ?? 0;
  const changePct = prev > 0 ? Math.round(((collected - prev) / prev) * 100) : null;

  const todo: TodoGroup[] = [];
  if (board) {
    const monthHe = new Intl.DateTimeFormat('he-IL', { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
    const toItem = (r: PaymentRowView): TodoItem => ({
      id: r.athleteId, athleteId: r.athleteId, name: r.name, amountIls: r.monthlyAmountIls, days: r.daysSinceLink,
      detail: `אקדמיה · ${monthHe}`, sentAt: null, sentBy: r.coachName, remindable: true,
    });
    const links = board.rows.filter((r) => r.state === 'link_overdue' || r.state === 'link_pending').map(toItem);
    const g = group('go_links', `${links.length} קישורי GO בלי מענה`, links, (it) => it.slice(0, 3).map((i) => shortName(i.name)).join(', '));
    if (g) todo.push(g);
    const failed = board.rows.filter((r) => r.state === 'failed').map(toItem);
    const f = group('go_failed', failed.length === 1 ? 'הוראת קבע אחת נכשלה' : `${failed.length} הוראות קבע נכשלו`, failed,
      (it) => it.slice(0, 3).map((i) => shortName(i.name)).join(', '), -1);
    if (f) todo.push(f);
  }
  const unpaid = input.storeOrders.filter((o) => o.status === 'pending_payment').map<TodoItem>((o) => ({
    id: o.id, athleteId: o.athleteId, name: o.name, amountIls: o.total, days: days(o.createdAt, now),
    detail: `#${o.id.slice(0, 4)}`, sentAt: null, sentBy: null, remindable: false,
  }));
  const u = group('store_unpaid', unpaid.length === 1 ? 'הזמנה אחת שלא שולמה' : `${unpaid.length} הזמנות שלא שולמו`, unpaid,
    (it) => it.slice(0, 2).map((i) => `${shortName(i.name)} ${i.detail}`).join(' · '));
  if (u) todo.push(u);
  const undelivered = input.storeOrders.filter((o) => o.status === 'paid').map<TodoItem>((o) => ({
    id: o.id, athleteId: o.athleteId, name: o.name, amountIls: o.total, days: days(o.createdAt, now),
    detail: `#${o.id.slice(0, 4)}`, sentAt: null, sentBy: null, remindable: false,
  }));
  const d = group('store_undelivered', undelivered.length === 1 ? 'הזמנה אחת לחלוקה' : `${undelivered.length} הזמנות לחלוקה`, undelivered,
    () => 'שולמו, עוד לא נמסרו');
  if (d) todo.push(d);
  const pending = input.podiumOrders.filter((o) => o.submitted && o.approval === 'pending').map<TodoItem>((o) => ({
    id: o.id, athleteId: o.athleteId, name: o.name, amountIls: r0(Math.max(0, o.total - o.budget)), days: days(o.updatedAt, now),
    detail: o.roundTitle, sentAt: null, sentBy: null, remindable: false,
  }));
  const pp = group('podium_pending', pending.length === 1 ? 'חריגת פודיום אחת לאישור' : `${pending.length} חריגות פודיום לאישור`, pending,
    (it) => it.slice(0, 3).map((i) => shortName(i.name)).join(', '));
  if (pp) todo.push(pp);
  todo.sort((a, b) => b.oldestDays - a.oldestDays);

  // Every name above is first-name + initial only — the screen is the manager's own, but a cut-down
  // name is all the row needs and all a shoulder-surfer gets.
  void firstName;

  const todoCount = todo.reduce((t, g) => t + g.count, 0);
  const todoAmount = todo.reduce((t, g) => t + g.amountIls, 0);
  return {
    month, collectedIls: collected, expectedIls: Math.max(expected, collected), missingIls: Math.max(0, Math.max(expected, collected) - collected),
    changePct, trend,
    streams: {
      academy: { collectedIls: r0(academyCollected), paid: board?.paid.length ?? 0, trainees: board?.rows.length ?? 0, tableMissing: !board },
      store: { collectedIls: r0(s.ils), paidOrders: s.n },
      podium: { collectedIls: r0(p.ils), exceptions: p.exceptions, clubFundsIls: r0(p.club) },
    },
    todo, todoCount, todoAmountIls: r0(todoAmount), allClosed: todoCount === 0,
  };
}
