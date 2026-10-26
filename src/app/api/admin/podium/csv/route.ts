import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { podiumCsv, roundTotals } from '@/lib/podium/model';
import { loadOrders, loadProducts, loadRound } from '@/lib/podium/server';

export const dynamic = 'force-dynamic';

/** GET ?round= — the file for Podium (lib/podium/model podiumCsv): sent orders, rejected ones out. */
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('round');
  const db = createServerClient();
  const round = id ? await loadRound(db, id) : null;
  if (!round) return NextResponse.json({ error: 'no round' }, { status: 404 });
  const [orders, products] = await Promise.all([loadOrders(db, round.id), loadProducts(db)]);
  const csv = podiumCsv(roundTotals(orders), products, `מדרגות · ${round.title}`);
  const file = `madregot-podium-${round.opensAt.slice(0, 10)}.csv`;
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}"` } });
}
