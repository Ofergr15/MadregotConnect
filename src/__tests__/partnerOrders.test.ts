import { describe, expect, it } from 'vitest';
import { parseGoaffpro } from '@/lib/partner-orders/sources';
import { summarize, toCsv } from '@/lib/partner-orders/summary';

describe('partner orders', () => {
  it('reads a GoAffPro "New referral order" email', () => {
    const text = 'Dear מדרגות\n\nYou have made a new referral sale\n\nOrder Number    30000263543\nAmount    ₪712.43\nCommission    ₪0\n';
    expect(parseGoaffpro(text)).toEqual({ orderNumber: '30000263543', amount: 712.43, commission: 0 });
    expect(parseGoaffpro('Amount ₪1,950.00 Commission ₪18.75')?.amount).toBe(1950);
    expect(parseGoaffpro('You have been invited to join our partner program')).toBeNull();
  });

  it('sums by Israel month, keeps empty months, and never exports commission', () => {
    const rows = [
      { partner: 'HOKA', via: 'WeShoes', order_number: '1', amount: 100, ordered_at: '2026-08-31T22:30:00Z' }, // 1.9 in Israel
      { partner: 'HOKA', via: 'WeShoes', order_number: '2', amount: 300, ordered_at: '2026-10-22T14:26:00Z' },
    ];
    const s = summarize(rows, new Date('2026-10-23T08:00:00Z'));
    expect(s.months.map((m) => [m.month, m.count, m.amount])).toEqual([['2026-09', 1, 100], ['2026-10', 1, 300]]);
    expect(s.total).toBe(400);
    expect(s.avg).toBe(200);
    const csv = toCsv(rows);
    expect(csv).toContain('2026-09-01,HOKA,WeShoes,1,100.00');
    expect(csv.toLowerCase()).not.toContain('commission');
  });
});
