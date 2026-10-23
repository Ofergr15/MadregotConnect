/**
 * Where partner orders come from: one entry per email that a partner's system sends the club for
 * every purchase made with the club's code. A new partner = a new entry (its sender + a parser).
 */
export interface OrderSource {
  id: string;
  partner: string;
  via: string | null;
  /** Gmail search for that partner's order emails. */
  query: string;
  parse: (text: string) => { orderNumber: string | null; amount: number; commission: number | null } | null;
}

const money = (s: string | undefined) => (s == null ? null : Number(s.replace(/,/g, '')));

/** GoAffPro "New referral order": "Order Number 30000263543 Amount ₪712.43 Commission ₪0". */
export function parseGoaffpro(text: string) {
  const t = text.replace(/\s+/g, ' ');
  const amount = money(t.match(/Amount\s*₪?\s*([\d,]+(?:\.\d+)?)/i)?.[1]);
  if (amount == null || Number.isNaN(amount)) return null;
  return {
    orderNumber: t.match(/Order Number\s*([\w-]+)/i)?.[1] ?? null,
    amount,
    commission: money(t.match(/Commission\s*₪?\s*([\d,]+(?:\.\d+)?)/i)?.[1]),
  };
}

export const ORDER_SOURCES: OrderSource[] = [
  // HOKA's deal runs through the WeShoes store, whose affiliate program is on GoAffPro.
  { id: 'goaffpro', partner: 'HOKA', via: 'WeShoes', query: 'from:goaffpro.com subject:referral', parse: parseGoaffpro },
];
