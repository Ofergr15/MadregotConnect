import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayViewNumbers } from '@/lib/club-numbers/access';
import { summarize, toCsv, type PartnerOrderRow } from '@/lib/partner-orders/summary';

export const dynamic = 'force-dynamic';

// GET /api/admin/partner-orders — "מדרגות במספרים › שותפויות", for whoever may see the numbers.
// `?format=csv` downloads every order. Commission is never selected (Ofer: internal and sensitive).
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const supabase = createServerClient();
  if (!(await mayViewNumbers(supabase, caller))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const { data, error } = await supabase.from('partner_orders').select('partner, via, order_number, amount, ordered_at').order('ordered_at', { ascending: false });
  if (error) { console.error('[partner-orders] read failed:', error); return NextResponse.json({ error: 'Failed to load' }, { status: 500 }); }
  const rows = (data ?? []) as PartnerOrderRow[];
  if (new URL(request.url).searchParams.get('format') === 'csv') {
    return new NextResponse(toCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="madregot-partner-orders.csv"' } });
  }
  return NextResponse.json(summarize(rows));
}
