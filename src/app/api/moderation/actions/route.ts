import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { LIST_PAGE_DEFAULT, LIST_PAGE_MAX, cursorOf, parseCursor } from '@/lib/moderation/actions';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/moderation/actions[?targetType=&targetId=&cursor=&limit=] → { actions, nextCursor, migrated }
 *
 * The moderation audit trail (task 185, migration 348): who dismissed, resolved or hid what, and
 * when. Staff only. Narrow to one target with targetType + targetId. Newest first, keyset-paged.
 */
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const rawCursor = q.get('cursor');
  const cursor = parseCursor(rawCursor);
  if (rawCursor && !cursor) return NextResponse.json({ error: 'invalid cursor' }, { status: 400 });
  const n = Number(q.get('limit'));
  const limit = Number.isInteger(n) && n > 0 ? Math.min(n, LIST_PAGE_MAX) : LIST_PAGE_DEFAULT;
  const targetType = q.get('targetType');
  const targetId = q.get('targetId');
  if (!!targetType !== !!targetId) return NextResponse.json({ error: 'targetType and targetId go together' }, { status: 400 });
  try {
    let sel = createServerClient().from('moderation_actions')
      .select('id, report_id, target_type, target_id, action, outcome, actor_athlete_id, note, reports_closed, created_at');
    if (targetType && targetId) sel = sel.eq('target_type', targetType).eq('target_id', targetId);
    if (cursor) sel = sel.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const { data, error } = await sel.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (error && isMissingTable(error)) return NextResponse.json({ actions: [], nextCursor: null, migrated: false });
    if (error) return NextResponse.json(internalErrorBody(), { status: 500 });
    const rows = (data || []) as Array<{ id: string; created_at: string }>;
    const page = rows.slice(0, limit);
    return NextResponse.json({
      actions: page, nextCursor: rows.length > limit ? cursorOf(page[page.length - 1]) : null, migrated: true,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('GET /api/moderation/actions failed:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}
