/**
 * הזמנת פודיום — the core squad's nutrition order from Podium (podiumsport.co.il), Ofer 10-26.
 * Mockup: ~/.cache/madregot/mockups/podium-order/index.html.
 *
 * A ROUND is one club order. It opens at `opens_at`, runners add products and send, and at
 * `locks_at` nothing can change any more; the admin then downloads the CSV for Podium and marks
 * it sent. Every runner has a budget (600 by default). Above it the order needs an admin's yes,
 * because the runner transfers the difference themselves — the app takes no payment.
 *
 * Prices are the site's (lib/podium/site), estimates only: Podium sets the final price.
 */

export const DEFAULT_BUDGET = 600;
/** The reminder before the lock: this many hours ahead. */
export const REMIND_HOURS = 24;

export interface PodiumProduct {
  id: string;
  sku: number;
  barcode: string;
  name: string;
  dept: string;
  url: string | null;
  imageUrl: string | null;
  price: number | null;
  regularPrice: number | null;
  deal: string | null;
  hidden: boolean;
  checkedAt: string | null;
  sort: number;
}

/** Who a round is for. 'me' = only the admin who opened it (a dry run before the club sees it).
 *  A core-squad feature (Ofer 10-26): the widest choice offered is the core; 'all' is kept only
 *  for a round saved before that. */
export type Audience = 'me' | 'admins' | 'people' | 'core' | 'all';
export const AUDIENCES: Array<{ key: Audience; label: string; hint: string }> = [
  { key: 'me', label: 'רק אני', hint: 'בדיקה. אף אחד אחר לא רואה' },
  { key: 'admins', label: 'אדמינים', hint: 'הצוות בלבד' },
  { key: 'people', label: 'אנשים מסוימים', hint: 'בוחרים מהרשימה' },
  { key: 'core', label: 'הגרעין 🌰', hint: 'כל רצי הגרעין' },
];

/** The small label on the card and the page: who this round is for. */
export const AUDIENCE_TAG: Record<Audience, string> = { me: '🔒 רק אני · בדיקה', admins: '🛡️ צוות', people: '✉️ בהזמנה', core: '🌰 לגרעין', all: '🏃 לכל המועדון' };

export interface Viewer { athleteId: string | null; isCore: boolean; isStaff: boolean }

/** May this person see and order in this round? */
export function audienceAllows(r: Pick<PodiumRound, 'audience' | 'audienceIds' | 'createdBy'>, v: Viewer): boolean {
  if (!v.athleteId) return false;
  switch (r.audience) {
    case 'me': return r.createdBy === v.athleteId;
    case 'admins': return v.isStaff;
    case 'people': return r.audienceIds.includes(v.athleteId) || r.createdBy === v.athleteId;
    case 'core': return v.isCore;
    case 'all': return true;
    default: return false;
  }
}

export interface PodiumRound {
  id: string;
  title: string;
  audience: Audience;
  audienceIds: string[];
  createdBy: string | null;
  opensAt: string;
  locksAt: string;
  budget: number;
  sentAt: string | null;
  /** Receiving finished (lib/podium/receive). */
  receivedAt?: string | null;
  /** The "it's open" notification (migration 174): automatic or by hand only, its text, who has had it. */
  autoNotify?: boolean;
  notifyTitle?: string | null;
  notifyBody?: string | null;
  notifiedCount?: number;
  /** Who has had "it's open" (the per-person ledger). */
  notifiedIds?: string[];
  /** This round's own budget for these people, in place of `budget` (migration 175; the admin's "קרדיט"). */
  budgets?: Record<string, number>;
  /** How many orders the round should end with — the core's and the group ones (migration 175); null = its audience. */
  expectedCount?: number | null;
}

export type RoundState = 'upcoming' | 'open' | 'locked' | 'sent';
export type Approval = 'none' | 'pending' | 'approved' | 'rejected';

export interface PodiumOrder {
  id: string;
  roundId: string;
  /** Null on a GROUP order ("אקסטרות", migration 175): it belongs to no runner. */
  athleteId: string | null;
  /** A group order's name; null on a runner's own. */
  label?: string | null;
  /** A group order's own budget; null = the round's. */
  budget?: number | null;
  /** Null while a draft; the moment the runner pressed "send". */
  submittedAt: string | null;
  approval: Approval;
  items: Record<string, number>;
  updatedAt: string;
}

export function roundState(r: Pick<PodiumRound, 'opensAt' | 'locksAt' | 'sentAt'>, now = new Date()): RoundState {
  if (r.sentAt) return 'sent';
  const t = now.getTime();
  if (t < new Date(r.opensAt).getTime()) return 'upcoming';
  if (t < new Date(r.locksAt).getTime()) return 'open';
  return 'locked';
}

/** Products a runner may order: on the site with a price, and not hidden by the admin. */
export function orderable(p: PodiumProduct): boolean {
  return !p.hidden && p.price != null && p.price > 0;
}

export function orderTotal(items: Record<string, number>, products: Map<string, PodiumProduct> | PodiumProduct[]): number {
  const byId = products instanceof Map ? products : new Map(products.map((p) => [p.id, p]));
  let sum = 0;
  for (const [id, q] of Object.entries(items)) {
    const p = byId.get(id);
    if (p?.price && q > 0) sum += p.price * q;
  }
  return Math.round(sum * 100) / 100;
}

/** What the site's own regular price would have cost — for "חסכת" next to the total. */
export function orderRegularTotal(items: Record<string, number>, products: PodiumProduct[]): number {
  const byId = new Map(products.map((p) => [p.id, p]));
  let sum = 0;
  for (const [id, q] of Object.entries(items)) {
    const p = byId.get(id);
    const unit = p?.regularPrice ?? p?.price;
    if (unit && q > 0) sum += unit * q;
  }
  return Math.round(sum * 100) / 100;
}

export function itemCount(items: Record<string, number>): number {
  return Object.values(items).reduce((s, q) => s + (q > 0 ? q : 0), 0);
}

/**
 * One order's budget (Ofer, 10-29: "I can edit the default and give someone a specific amount"):
 * a group order's own, else this person's in the round, else the round's default.
 */
export function budgetOf(round: Pick<PodiumRound, 'budget' | 'budgets'>, o: { athleteId?: string | null; budget?: number | null } | null | undefined, athleteId?: string | null): number {
  if (o?.budget != null && Number.isFinite(o.budget)) return o.budget;
  const id = o?.athleteId ?? athleteId ?? null;
  const own = id ? round.budgets?.[id] : undefined;
  return own != null && Number.isFinite(Number(own)) && Number(own) >= 0 ? Number(own) : round.budget;
}

/** Over the budget by this much (0 when within it). */
export function overBy(total: number, budget: number): number {
  return Math.max(0, Math.round((total - budget) * 100) / 100);
}

/** The approval an order needs after a change: within budget → none; over → pending (a yes given
 *  for a smaller overage does not carry over to a bigger one). */
export function approvalAfter(total: number, budget: number, prev: Approval, prevTotal: number): Approval {
  if (total <= budget) return 'none';
  if (prev === 'approved' && total <= prevTotal) return 'approved';
  return 'pending';
}

/** Clean an items map from a request: known products only, integer 0..99, zeros dropped. */
export function cleanItems(raw: unknown, products: PodiumProduct[], { allowUnorderable = false } = {}): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = byId.get(id);
    if (!p || (!allowUnorderable && !orderable(p))) continue;
    const q = Math.floor(Number(v));
    if (Number.isFinite(q) && q > 0) out[id] = Math.min(99, q);
  }
  return out;
}

/** "קנו 10 קבלו 1 חינם" → 10 (buy N get 1). Null for any other kind of deal. */
export function buyNGetOne(deal: string | null | undefined): number | null {
  const m = deal?.match(/קנו\s*(\d+)\s*קבלו\s*1/);
  return m ? Number(m[1]) : null;
}

/**
 * The nudge for a buy-N-get-1 deal, read as "every N+1 in the cart, one is free":
 * 4 of a "קנו 10" → "עוד 7 ואחד מהם חינם"; 11 → "1 חינם במבצע". Null when there's no such deal.
 */
export function dealNudge(deal: string | null | undefined, qty: number): string | null {
  const n = buyNGetOne(deal);
  if (!n || qty <= 0) return null;
  const pack = n + 1;
  const free = Math.floor(qty / pack);
  const rest = qty % pack;
  if (rest === 0) return `${free} חינם במבצע`;
  return free > 0 ? `${free} חינם · עוד ${pack - rest} ועוד אחד חינם` : `עוד ${pack - rest} ואחד מהם חינם`;
}

/** Club totals per product for the round (only orders that were sent count). */
export function roundTotals(orders: Pick<PodiumOrder, 'items' | 'submittedAt' | 'approval'>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of orders) {
    if (!o.submittedAt || o.approval === 'rejected') continue;
    for (const [id, q] of Object.entries(o.items)) if (q > 0) m.set(id, (m.get(id) ?? 0) + q);
  }
  return m;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The file for Podium, in the exact shape of the club's "order April 2026" sheet:
 * פריט · ברקוד · שם · שם מחלקה · כמות — one line per product, in catalog order. A BOM so
 * Excel opens the Hebrew correctly.
 */
export function podiumCsv(totals: Map<string, number>, products: PodiumProduct[], title = 'מדרגות'): string {
  const lines = [csvCell(title), ['פריט', 'ברקוד', 'שם', 'שם מחלקה', 'כמות'].join(',')];
  for (const p of [...products].sort((a, b) => a.sort - b.sort)) {
    const q = totals.get(p.id);
    if (q) lines.push([p.sku, p.barcode, p.name, p.dept, q].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** The English half of a catalog name ("ג'ל אנרגיה GU Gel Vanilla" → "GU Gel Vanilla"). */
export function englishName(name: string): string {
  const m = name.match(/[A-Za-z].*/);
  return m ? m[0].trim() : name;
}

/** The Hebrew half ("ג'ל אנרגיה"), or '' when the name is English only. */
export function hebrewName(name: string): string {
  const i = name.search(/[A-Za-z]/);
  return i > 0 ? name.slice(0, i).trim() : i === 0 ? '' : name;
}

/** The catalog's departments folded into the chips a runner sees. */
export const GROUPS: Array<{ key: string; label: string; depts: string[] }> = [
  { key: 'gels', label: "ג'לים", depts: ["ג'ל אנרגיה", 'רוקטאן', 'POWERGEL FUEL GEL'] },
  { key: 'waffles', label: 'וופלים', depts: ['וואפלים'] },
  { key: 'bars', label: 'חטיפים', depts: ['Powerbar Bars'] },
  { key: 'chews', label: 'סוכריות', depts: ['סוכריות אנרגיה', 'Powerbar shots'] },
  { key: 'drinks', label: 'משקאות', depts: ['אבקה להכנת משקה', 'Powerbar Drinks'] },
  { key: 'tabs', label: 'טבליות', depts: ['טבליות מתמוססות'] },
  { key: 'beet', label: 'סלק', depts: ['BEET IT'] },
  { key: 'bottles', label: 'בקבוקים', depts: ["פאוצ'ים ובקבוקים לריצה"] },
];

export function groupOf(dept: string): string {
  return GROUPS.find((g) => g.depts.includes(dept))?.key ?? 'other';
}
