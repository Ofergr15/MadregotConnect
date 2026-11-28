import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { monthKey } from '@/lib/finance/summary';
import { loadFinanceInput } from '@/lib/finance/load';
import { unpaidCsv, unpaidRows } from '@/lib/finance/unpaid';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/finance/unpaid?month=YYYY-MM[&format=csv] — who hasn't paid (task 188):
 * academy trainees whose month is not settled + store orders waiting for payment.
 *
 * MANAGER ONLY, the same gate as /api/admin/finance (what a trainee pays is not a coach's
 * to see) — a coach gets 403 before anything is read. Read-only; nothing is sent.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.role === 'admin')) {
      return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
    }
    const url = new URL(request.url);
    const now = new Date();
    const asked = url.searchParams.get('month');
    const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : monthKey(now);
    const input = await loadFinanceInput(createServerClient(), month, now);
    const rows = unpaidRows(input);
    if (url.searchParams.get('format') === 'csv') {
      return new NextResponse(unpaidCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="madregot-unpaid-${month}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json({
      month,
      academyTableMissing: !input.board,
      count: rows.length,
      amountIls: Math.round(rows.reduce((t, r) => t + (r.amountIls ?? 0), 0)),
      rows,
    });
  } catch (err) {
    console.error('GET /api/admin/finance/unpaid failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
