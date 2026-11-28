import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { buildFinance, monthKey } from '@/lib/finance/summary';
import { loadFinanceInput } from '@/lib/finance/load';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/finance?month=YYYY-MM — כספים (design/b22/finance/mockup-v3.html): this month's
 * income, a 6-month trend, the three streams and "לטפל" with ageing.
 *
 * MANAGER ONLY, exactly like /api/academy/payments (what a trainee pays is not a colleague's to
 * see), so a coach — staff for the store and the podium — still gets 403 here.
 *
 * Read-only. Every source degrades on its own: a missing table (academy 115, podium 172) drops that
 * stream to zero with a flag instead of failing the screen.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.role === 'admin')) {
      return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
    }
    const now = new Date();
    const asked = new URL(request.url).searchParams.get('month');
    const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : monthKey(now);
    const db = createServerClient();
    return NextResponse.json(buildFinance(await loadFinanceInput(db, month, now)));
  } catch (err) {
    console.error('GET /api/admin/finance failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
