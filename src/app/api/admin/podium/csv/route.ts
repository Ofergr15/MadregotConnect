import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { podiumCsv, roundTotals } from '@/lib/podium/model';
import { loadOrders, loadProducts, loadRound } from '@/lib/podium/server';
import { packingCsv } from '@/lib/podium/receive';
import { receiveView } from '@/lib/podium/receive-server';

export const dynamic = 'force-dynamic';

/** GET ?round= — the file for Podium (lib/podium/model podiumCsv): sent orders, rejected ones out.
 *  &kind=packing — the packing list after receiving: per runner, ordered / gets / missing. */
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('round');
  const db = createServerClient();
  const round = id ? await loadRound(db, id) : null;
  if (!round) return NextResponse.json({ error: 'no round' }, { status: 404 });
  const [orders, products] = await Promise.all([loadOrders(db, round.id), loadProducts(db)]);
  const packing = new URL(request.url).searchParams.get('kind') === 'packing';
  let csv: string;
  if (packing) {
    const view = await receiveView(db, round, { orders, products });
    const ids = orders.filter((o) => view.shares[o.id] && o.athleteId).map((o) => o.athleteId as string);
    const { data: ppl } = ids.length ? await db.from('athletes').select('id, name').in('id', ids) : { data: [] };
    const nm = new Map(((ppl ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
    // A group order is packed under its own name (migration 175).
    const rows = orders.filter((o) => view.shares[o.id]).map((o) => ({ name: o.athleteId ? nm.get(o.athleteId) ?? '' : `👥 ${o.label ?? ''}`, items: o.items, got: view.shares[o.id].got }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
    csv = packingCsv(rows, products);
  } else {
    csv = podiumCsv(roundTotals(orders), products, `מדרגות · ${round.title}`);
  }
  const file = `madregot-podium-${packing ? 'packing-' : ''}${round.opensAt.slice(0, 10)}.csv`;
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}"` } });
}
