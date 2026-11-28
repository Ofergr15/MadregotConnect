import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { toHistory } from '@/lib/store/order-history';

export const dynamic = 'force-dynamic';

// GET /api/admin/store/orders/[id]/history → { history: [{ from, to, by: { id, name }, at, reason }] }, newest first.
// Staff only. 503 until migration 231 is applied.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  try {
    const { id } = await params;
    const read = (cols: string) => createServerClient()
      .from('store_order_status_events')
      .select(cols)
      .eq('order_id', id)
      .order('changed_at', { ascending: false })
      .limit(200);
    const base = 'from_status, to_status, changed_by, changed_by_name, changed_at';
    // `reason` is migration 250; before it, read without.
    let { data, error } = await read(`${base}, reason`);
    if (error && isMissingColumn(error, 'reason')) ({ data, error } = await read(base));
    if (error && isMissingTable(error)) return NextResponse.json({ error: 'history not migrated yet (231)', migrated: false }, { status: 503 });
    if (error) throw error;
    return NextResponse.json({ history: toHistory((data ?? []) as unknown as Parameters<typeof toHistory>[0]) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Failed to read order history:', error);
    return NextResponse.json({ error: 'Failed to read order history' }, { status: 500 });
  }
}
